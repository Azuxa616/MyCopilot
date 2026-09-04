import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { MemoryRecord, Message, StreamEvent } from '@my-copilot/shared';
import type {
  AdapterConfig,
  ProviderAdapter,
} from '../../llm/base.js';
import {
  assembleMessages,
  assembleMessagesV2,
  DEFAULT_SYSTEM_PROMPT,
  type AttachmentText,
  type SkillInjection,
} from '../assembler.js';
import { listMemories } from '../../repo/memory.js';

// Memory 仓储整体 mock：assembleMessagesV2 只消费 listMemories。
vi.mock('../../repo/memory.js', () => ({
  listMemories: vi.fn(),
}));

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'Hello',
    attachments: [],
    status: 'sent',
    createdAt: Date.now(),
    ...overrides,
  };
}

const adapterConfig: AdapterConfig = {
  baseUrl: 'http://localhost',
  apiKey: 'key',
  model: 'test-model',
};

/** 构造一个 chatCompletionStream 产出单段文本的 mock adapter（真跑 summarizeHistory）。 */
function summaryAdapter(text: string): {
  adapter: ProviderAdapter;
  streamSpy: ReturnType<typeof vi.fn>;
} {
  const streamSpy = vi.fn(() => {
    const events: StreamEvent[] = [
      { type: 'content', text },
      { type: 'finish', reason: 'stop' },
    ];
    return (async function* () {
      for (const e of events) yield e;
    })();
  });
  return {
    adapter: { type: 'openai', chatCompletionStream: streamSpy },
    streamSpy,
  };
}

function memoryRecord(partials: Partial<MemoryRecord> = {}): MemoryRecord {
  return {
    id: 'mem-1',
    sessionId: 's1',
    key: 'preference.lang',
    value: '用中文回复',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...partials,
  };
}

describe('assembleMessagesV2', () => {
  beforeEach(() => {
    vi.mocked(listMemories).mockReset();
    vi.mocked(listMemories).mockReturnValue([]);
  });

  // ===== happy path：短 history 未超预算 =====

  it('短 history 不超预算：degraded=false，messages = system + history + user，budget 数值正确', async () => {
    const history: Message[] = [
      createMessage({ id: '1', role: 'user', content: 'Hi' }),
      createMessage({ id: '2', role: 'assistant', content: 'Hello!' }),
    ];

    const ctx = await assembleMessagesV2({
      history,
      userContent: 'New question',
      totalContextTokens: 8000,
    });

    expect(ctx.degraded).toBe(false);
    expect(ctx.messages).toHaveLength(4);
    expect(ctx.messages[0]).toEqual({
      role: 'system',
      content: DEFAULT_SYSTEM_PROMPT,
    });
    expect(ctx.messages[1]).toEqual({ role: 'user', content: 'Hi' });
    expect(ctx.messages[2]).toEqual({ role: 'assistant', content: 'Hello!' });
    expect(ctx.messages[3]).toEqual({ role: 'user', content: 'New question' });
    // budget 与 computeBudget(8000) 的分摊一致（默认六桶比例）
    expect(ctx.budget).toEqual({
      system: 480,
      tools: 1120,
      history: 2720,
      toolOutputs: 2240,
      working: 800,
      headroom: 640,
      total: 8000,
    });
  });

  // ===== 降级链第一级：策略截断（正常调度，不算降级） =====

  it('超预算触发第一级滑窗截断：messages 减少、degraded=false（一级是正常调度）', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 每条 'x'.repeat(3200) ≈ 802 tokens + 4 开销 = 806 tokens；
    // 6 条共 ≈ 4836 > history 预算 2720（8000 × 0.34）→ 触发截断。
    // 截断内部预算 = 2720 - 2000(预留) = 720，任何单链（806）都装不下 → 全部丢弃。
    const big = 'x'.repeat(3200);
    const history: Message[] = [
      createMessage({ id: 'm0', role: 'user', content: `OLD_Q1-${big}` }),
      createMessage({ id: 'm1', role: 'assistant', content: `OLD_A1-${big}` }),
      createMessage({ id: 'm2', role: 'user', content: `OLD_Q2-${big}` }),
      createMessage({ id: 'm3', role: 'assistant', content: `NEW_A2-${big}` }),
      createMessage({ id: 'm4', role: 'user', content: `NEW_Q3-${big}` }),
      createMessage({ id: 'm5', role: 'assistant', content: `NEW_A3-${big}` }),
    ];

    const ctx = await assembleMessagesV2({
      history,
      userContent: '当前问题',
      totalContextTokens: 8000,
    });

    // 历史全部被截掉：只剩 system + 当前 user
    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages[0].role).toBe('system');
    expect(ctx.messages[ctx.messages.length - 1]).toEqual({
      role: 'user',
      content: '当前问题',
    });
    const contents = ctx.messages.map((m) => m.content);
    expect(contents).not.toContain(`OLD_Q1-${big}`);
    expect(contents).not.toContain(`NEW_A3-${big}`);
    // 第一级截断后预算恢复 → 不降级、不告警
    expect(ctx.degraded).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // ===== 降级链第二级：LLM 摘要注入 =====

  it('第二级触发：超预算 + mock adapter 返回 SUMMARY_TEXT → messages 含 [Previous conversation summary]，degraded=true', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 巨大 skills 文本撑爆 system 桶（480 tokens），使一级截断后仍超预算 → 进二级。
    const big = 'x'.repeat(3200);
    const history: Message[] = [
      createMessage({ id: 'm0', role: 'user', content: `Q1-${big}` }),
      createMessage({ id: 'm1', role: 'assistant', content: `A1-${big}` }),
      createMessage({ id: 'm2', role: 'user', content: `Q2-${big}` }),
      createMessage({ id: 'm3', role: 'assistant', content: `A2-${big}` }),
    ];
    const skills: SkillInjection[] = [
      { name: 'big-skill', body: 'S'.repeat(4000) },
    ];
    const { adapter, streamSpy } = summaryAdapter('SUMMARY_TEXT');

    const ctx = await assembleMessagesV2({
      history,
      userContent: '当前问题',
      skills,
      totalContextTokens: 8000,
      adapter,
      adapterConfig,
    });

    // 二级真实调用了 summarizeHistory（通过 mock adapter 的流）
    expect(streamSpy).toHaveBeenCalledTimes(1);
    // 摘要以 [Previous conversation summary] 消息注入
    const summaryMsg = ctx.messages.find((m) =>
      m.content?.includes('[Previous conversation summary]'),
    );
    expect(summaryMsg).toBeDefined();
    expect(summaryMsg!.content).toBe(
      '[Previous conversation summary]\n\nSUMMARY_TEXT',
    );
    // 前缀顺序：system → skills → 摘要消息 → user
    const summaryIdx = ctx.messages.indexOf(summaryMsg!);
    expect(ctx.messages[0].role).toBe('system');
    expect(ctx.messages[summaryIdx - 1].content).toContain('# Skill: big-skill');
    expect(ctx.messages[ctx.messages.length - 1]).toEqual({
      role: 'user',
      content: '当前问题',
    });
    // 第二级触发 → 降级
    expect(ctx.degraded).toBe(true);
    warnSpy.mockRestore();
  });

  it('第二级跳过（summarizeHistory 无 adapter 可用）→ 不注入摘要', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const big = 'x'.repeat(3200);
    const history: Message[] = [
      createMessage({ id: 'm0', role: 'user', content: `Q1-${big}` }),
      createMessage({ id: 'm1', role: 'assistant', content: `A1-${big}` }),
    ];
    const skills: SkillInjection[] = [
      { name: 'big-skill', body: 'S'.repeat(4000) },
    ];

    // 无 adapter + 无 adapterConfig → 二级被跳过，messages 不含摘要消息
    const ctx = await assembleMessagesV2({
      history,
      userContent: '当前问题',
      skills,
      totalContextTokens: 8000,
    });

    expect(
      ctx.messages.some((m) =>
        m.content?.includes('[Previous conversation summary]'),
      ),
    ).toBe(false);
    // system 桶持续超限 → 走到降级终点：degraded=true + 中文告警
    expect(ctx.degraded).toBe(true);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // ===== 降级链第三级：tool 输出截断 =====

  it('第二级跳过（无 adapter）→ 直接第三级：tool 消息被截到 ≤ 2000 字符并带截断标记', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // totalContextTokens=40000 → history 预算 13600、toolOutputs 预算 11200。
    // tool 输出 46000 字符 ≈ 11504 tokens：整体 11508 ≤ 13600 → 一级快速路径
    // 原样保留（不丢消息），但 toolOutputs 桶 11506 > 11200 → 持续超预算；
    // 无 adapter → 二级跳过 → 三级把 tool 输出截到 2000 字符 + 标记。
    const hugeToolOutput = 'T'.repeat(46_000);
    const history: Message[] = [
      createMessage({
        id: 'a1',
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'search', arguments: '{"q":"x"}' },
        ],
      }),
      createMessage({
        id: 't1',
        role: 'tool',
        content: hugeToolOutput,
        toolCallId: 'call_1',
      }),
    ];

    const ctx = await assembleMessagesV2({
      history,
      userContent: '总结一下',
      totalContextTokens: 40_000,
    });

    const toolMsg = ctx.messages.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect(toolMsg!.content).toBe('T'.repeat(2000) + '…[truncated]');
    expect(toolMsg!.content!.length).toBeLessThanOrEqual(
      2000 + '…[truncated]'.length,
    );
    // 链完整性：assistant 工具调用轮次仍在 tool 消息之前
    const toolIdx = ctx.messages.indexOf(toolMsg!);
    expect(ctx.messages[toolIdx - 1].role).toBe('assistant');
    // 第三级触发 → 降级；三级后预算恢复 → 不进终点告警
    expect(ctx.degraded).toBe(true);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // ===== Memory 注入（RFC §4） =====

  it('Memory 注入：sessionId + repo 有记忆 → skills 之后出现 [Persistent memory] system 消息', async () => {
    vi.mocked(listMemories).mockReturnValue([
      memoryRecord({ key: 'preference.lang', value: '用中文回复' }),
      memoryRecord({
        id: 'mem-2',
        key: 'fact.city',
        value: 'Lives in Beijing',
      }),
    ]);
    const skills: SkillInjection[] = [{ name: 's1-skill', body: 'Be concise.' }];

    const ctx = await assembleMessagesV2({
      history: [],
      userContent: 'Hi',
      sessionId: 's1',
      skills,
    });

    expect(vi.mocked(listMemories)).toHaveBeenCalledWith('s1');
    const memoryMsg = ctx.messages.find((m) =>
      m.content?.includes('[Persistent memory]'),
    );
    expect(memoryMsg).toBeDefined();
    expect(memoryMsg!.role).toBe('system');
    expect(memoryMsg!.content).toBe(
      '[Persistent memory]\n\n- preference.lang: 用中文回复\n- fact.city: Lives in Beijing',
    );
    // 插在 skills 之后（稳定前缀：system → skills → memory）
    const memoryIdx = ctx.messages.indexOf(memoryMsg!);
    expect(ctx.messages[memoryIdx - 1].content).toContain('# Skill: s1-skill');
    expect(ctx.degraded).toBe(false);
  });

  it('无 sessionId → 不读取记忆也不注入；repo 无记忆 → 同样不注入', async () => {
    const noSession = await assembleMessagesV2({
      history: [],
      userContent: 'Solo',
    });
    expect(vi.mocked(listMemories)).not.toHaveBeenCalled();
    expect(
      noSession.messages.some((m) =>
        m.content?.includes('[Persistent memory]'),
      ),
    ).toBe(false);

    const emptyMemory = await assembleMessagesV2({
      history: [],
      userContent: 'Solo',
      sessionId: 's-empty',
    });
    expect(vi.mocked(listMemories)).toHaveBeenCalledWith('s-empty');
    expect(
      emptyMemory.messages.some((m) =>
        m.content?.includes('[Persistent memory]'),
      ),
    ).toBe(false);
  });

  // ===== 空 history：不触发任何降级 =====

  it('空 history：不触发任何降级，messages = system + user', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const ctx = await assembleMessagesV2({
      history: [],
      userContent: 'Solo message',
    });

    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages[0].role).toBe('system');
    expect(ctx.messages[1]).toEqual({ role: 'user', content: 'Solo message' });
    expect(ctx.degraded).toBe(false);
    expect(warnSpy).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  // ===== 与原 assembleMessages 的一致性（RFC C6） =====

  it('与原 assembleMessages 一致：无预算压力时两者 messages 深度相等', async () => {
    const history: Message[] = [
      createMessage({ id: '1', role: 'user', content: 'Prior question' }),
      createMessage({ id: '2', role: 'assistant', content: 'Prior answer' }),
      createMessage({
        id: 'a1',
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'calc', arguments: '{"x":1}' },
        ],
      }),
      createMessage({
        id: 't1',
        role: 'tool',
        content: '42',
        toolCallId: 'call_1',
      }),
      // 非 sent 状态被两者同等过滤
      createMessage({
        id: 'x1',
        role: 'assistant',
        content: 'aborted...',
        status: 'aborted',
      }),
    ];
    const skills: SkillInjection[] = [
      { name: 'skill-a', body: 'A instructions.' },
    ];
    const summary = { text: 'Earlier the user greeted the assistant.' };
    const attachments: AttachmentText[] = [{ name: 'note.txt', content: 'NOTE' }];

    const v1 = assembleMessages({
      history,
      userContent: 'Now',
      skills,
      summary,
      attachments,
    });
    const v2 = await assembleMessagesV2({
      history,
      userContent: 'Now',
      skills,
      summary,
      attachments,
    });

    expect(v2.messages).toEqual(v1);
    expect(v2.degraded).toBe(false);
  });
});
