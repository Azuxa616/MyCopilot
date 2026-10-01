import { getSession } from '../repo/session.js';
import { listMessagesBySession } from '../repo/message.js';
import { getLatestSummary } from '../repo/summary.js';

/**
 * `@会话` 引用的第一层注入（input-commands 设计）：把用户点名的会话按固定
 * 格式构建为摘要注入块，由 runner 在本轮装配时拼入最终 user 消息前缀。
 *
 * 两层引用的第一层是"自动注入摘要"；第二层（模型自主调 read_session 查阅
 * 完整记录）的提示语写在本块尾部。fail-soft：单会话查询失败降级、不抛错。
 */

/** 降级拼接时首/尾消息片段的字符上限。 */
const SNIPPET_MAX_CHARS = 200;

/** 注入块中的角色中文名（面向模型的固定格式约定）。 */
const ROLE_LABELS: Record<string, string> = {
  user: '用户',
  assistant: '助手',
  system: '系统',
  tool: '工具',
};

function snippet(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > SNIPPET_MAX_CHARS
    ? `${trimmed.slice(0, SNIPPET_MAX_CHARS)}…`
    : trimmed;
}

/** 无摘要时的降级块：标题已在外层《》行，此处拼消息数 + 首尾片段。 */
function buildFallbackText(sessionId: string): string {
  const messages = listMessagesBySession(sessionId);
  if (messages.length === 0) {
    return '（该会话暂无摘要，暂无消息记录。）';
  }
  const first = messages.find((m) => m.role === 'user') ?? messages[0]!;
  const last = messages[messages.length - 1]!;
  const label = (role: string): string => ROLE_LABELS[role] ?? role;
  return [
    '（该会话暂无摘要，以下为简易拼接）',
    `共 ${messages.length} 条消息`,
    `首条（${label(first.role)}）：${snippet(first.content)}`,
    `末条（${label(last.role)}）：${snippet(last.content)}`,
  ].join('\n');
}

/**
 * 构建 `@会话` 注入文本。id 去重（保序）；不存在的会话输出占位块。
 * 空入参返回 ''（调用方据此跳过注入）。
 */
export function buildReferencedSessionsText(sessionIds: string[]): string {
  const seen = new Set<string>();
  const blocks: string[] = [];

  for (const id of sessionIds) {
    if (!id || seen.has(id)) continue;
    seen.add(id);

    const session = getSession(id);
    if (!session) {
      blocks.push(`[用户引用了会话《未知会话》（id: ${id}），但该会话已不存在]`);
      continue;
    }

    const summary = getLatestSummary(id);
    const body =
      summary && summary.summary.trim().length > 0
        ? summary.summary
        : buildFallbackText(id);

    blocks.push(
      `[用户引用了会话《${session.title}》的摘要]\n` +
        `${body}\n` +
        `如需完整记录，可调用 read_session 工具（传入 sessionId "${id}"）查阅。`,
    );
  }

  return blocks.join('\n\n');
}
