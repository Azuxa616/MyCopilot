import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Message } from '@my-copilot/shared';

// ---------------------------------------------------------------------------
// Mock repo layer BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockGetSession = vi.fn();
const mockListMessagesBySession = vi.fn();
const mockGetLatestSummary = vi.fn();

vi.mock('../../repo/session.js', () => ({
  getSession: (...args: unknown[]) => mockGetSession(...args),
}));
vi.mock('../../repo/message.js', () => ({
  listMessagesBySession: (...args: unknown[]) => mockListMessagesBySession(...args),
}));
vi.mock('../../repo/summary.js', () => ({
  getLatestSummary: (...args: unknown[]) => mockGetLatestSummary(...args),
}));

const { buildReferencedSessionsText } = await import('../referenced-sessions.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msg(id: string, role: Message['role'], content: string): Message {
  return {
    id,
    sessionId: 's1',
    role,
    content,
    attachments: [],
    status: 'sent',
    createdAt: 1,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildReferencedSessionsText', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有摘要：按设计固定格式输出并提示 read_session', () => {
    mockGetSession.mockReturnValue({
      id: 's1', title: '旧会话', modelId: null, createdAt: 1, updatedAt: 1,
    });
    mockGetLatestSummary.mockReturnValue({
      id: 'sum-1', sessionId: 's1', summary: '讨论了 A 与 B',
      summarizedUpToMessageId: 'm5', tokenCount: 100, createdAt: 1,
    });

    expect(buildReferencedSessionsText(['s1'])).toBe(
      '[用户引用了会话《旧会话》的摘要]\n' +
        '讨论了 A 与 B\n' +
        '如需完整记录，可调用 read_session 工具（传入 sessionId "s1"）查阅。',
    );
  });

  it('无摘要：fail-soft 降级为消息数 + 首尾片段拼接（首条优先取 user）', () => {
    mockGetSession.mockReturnValue({
      id: 's1', title: '调研记录', modelId: null, createdAt: 1, updatedAt: 1,
    });
    mockGetLatestSummary.mockReturnValue(undefined);
    mockListMessagesBySession.mockReturnValue([
      msg('m1', 'user', '第一条用户消息'),
      msg('m2', 'assistant', '中间回复'),
      msg('m3', 'assistant', '最后一条回复'),
    ]);

    const text = buildReferencedSessionsText(['s1']);
    expect(text).toContain('[用户引用了会话《调研记录》的摘要]');
    expect(text).toContain('共 3 条消息');
    expect(text).toContain('首条（用户）：第一条用户消息');
    expect(text).toContain('末条（助手）：最后一条回复');
    expect(text).toContain('如需完整记录，可调用 read_session 工具（传入 sessionId "s1"）查阅。');
  });

  it('无摘要且无消息：降级为"暂无消息记录"（不抛错）', () => {
    mockGetSession.mockReturnValue({
      id: 's1', title: '空会话', modelId: null, createdAt: 1, updatedAt: 1,
    });
    mockGetLatestSummary.mockReturnValue(undefined);
    mockListMessagesBySession.mockReturnValue([]);

    const text = buildReferencedSessionsText(['s1']);
    expect(text).toContain('《空会话》');
    expect(text).toContain('暂无消息记录');
  });

  it('会话不存在：占位块，不抛错', () => {
    mockGetSession.mockReturnValue(undefined);

    const text = buildReferencedSessionsText(['gone']);
    expect(text).toBe('[用户引用了会话《未知会话》（id: gone），但该会话已不存在]');
  });

  it('id 去重（保序）与空入参返回空串', () => {
    expect(buildReferencedSessionsText([])).toBe('');
    expect(buildReferencedSessionsText(['', 's1', 's1'])).toBe(
      buildReferencedSessionsText(['s1']),
    );
  });

  it('多个引用块之间以空行分隔', () => {
    mockGetSession.mockImplementation((id: string) => ({
      id, title: `会话${id}`, modelId: null, createdAt: 1, updatedAt: 1,
    }));
    mockGetLatestSummary.mockReturnValue(undefined);
    mockListMessagesBySession.mockReturnValue([]);

    const text = buildReferencedSessionsText(['a', 'b']);
    expect(text.split('\n\n')).toHaveLength(2);
  });

  it('超长首/尾消息片段截断到 200 字符', () => {
    mockGetSession.mockReturnValue({
      id: 's1', title: '长会话', modelId: null, createdAt: 1, updatedAt: 1,
    });
    mockGetLatestSummary.mockReturnValue(undefined);
    mockListMessagesBySession.mockReturnValue([
      msg('m1', 'user', 'x'.repeat(500)),
    ]);

    const text = buildReferencedSessionsText(['s1']);
    expect(text).toContain(`${'x'.repeat(200)}…`);
  });
});
