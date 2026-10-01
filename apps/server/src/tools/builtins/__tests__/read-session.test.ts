import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message, Tool } from '@my-copilot/shared';

const mockGetSession = vi.fn();
const mockListMessagesBySession = vi.fn();

vi.mock('../../../repo/session.js', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));
vi.mock('../../../repo/message.js', () => ({
  listMessagesBySession: (...args: unknown[]) => mockListMessagesBySession(...args),
}));

const { readSessionExecutor, appendReadSessionTool } = await import('../read-session.js');

function msg(id: string, role: Message['role'], content: string): Message {
  return {
    id, sessionId: 's1', role, content, attachments: [], status: 'sent', createdAt: 1000,
  };
}

describe('readSessionExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('describe：safe 级、单参数 sessionId 的 built-in 形态', () => {
    const tool = readSessionExecutor.describe();
    expect(tool).toMatchObject({
      name: 'read_session',
      type: 'built-in',
      safetyLevel: 'safe',
      enabled: true,
      sourceMcpId: null,
    });
    expect(tool.inputSchema.fields).toEqual([
      { name: 'sessionId', type: 'string', description: expect.any(String), required: true },
    ]);
  });

  it('会话不存在 → isError 且中文错误信息', async () => {
    mockGetSession.mockReturnValue(undefined);
    const result = await readSessionExecutor.execute(
      { sessionId: 'ctx' },
      { sessionId: 'ctx' },
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('不存在');
  });

  it('缺失/非字符串 sessionId → isError（参数校验）', async () => {
    const result = await readSessionExecutor.execute({}, { sessionId: 'ctx' });
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('sessionId');
  });

  it('正常输出：标题 + 总数 + 每条消息的角色标记', async () => {
    mockGetSession.mockReturnValue({
      id: 's1', title: '旧会话', modelId: null, createdAt: 1, updatedAt: 1,
    });
    mockListMessagesBySession.mockReturnValue([
      msg('m1', 'user', '问个问题'),
      msg('m2', 'assistant', '这是回答'),
    ]);

    const result = await readSessionExecutor.execute(
      { sessionId: 's1' },
      { sessionId: 'other' },
    );
    expect(result.isError).toBeUndefined();
    const text = result.content[0]!.text;
    expect(text).toContain('《旧会话》');
    expect(text).toContain('共 2 条');
    expect(text).toContain('[用户]');
    expect(text).toContain('问个问题');
    expect(text).toContain('[助手]');
    expect(text).toContain('这是回答');
  });

  it('超长输出截断并追加 truncated 标记（64k 安全阀）', async () => {
    mockGetSession.mockReturnValue({
      id: 's1', title: '长会话', modelId: null, createdAt: 1, updatedAt: 1,
    });
    mockListMessagesBySession.mockReturnValue([
      msg('m1', 'user', 'x'.repeat(80_000)),
    ]);

    const result = await readSessionExecutor.execute(
      { sessionId: 's1' },
      { sessionId: 'other' },
    );
    const text = result.content[0]!.text;
    expect(text.length).toBeLessThanOrEqual(64_000 + '\n…[truncated]'.length);
    expect(text.endsWith('…[truncated]')).toBe(true);
  });
});

describe('appendReadSessionTool', () => {
  it('未携带 referencedSessionIds：原样返回（同一引用）', () => {
    const tools: Tool[] = [];
    expect(appendReadSessionTool(tools)).toBe(tools);
    expect(appendReadSessionTool(tools, [])).toBe(tools);
    expect(appendReadSessionTool(tools, undefined)).toBe(tools);
  });

  it('携带 referencedSessionIds：追加 read_session 描述符', () => {
    const appended = appendReadSessionTool([], ['s1', 's2']);
    expect(appended).toHaveLength(1);
    expect(appended[0]!.name).toBe('read_session');
    expect(appended[0]!.safetyLevel).toBe('safe');
  });
});
