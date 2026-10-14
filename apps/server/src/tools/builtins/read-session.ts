import type { Tool } from '@my-copilot/shared';
import type { ToolExecutor } from '../registry.js';
import {
  builtinTool,
  executeLocalTool,
  textResult,
  errorResult,
  requiredString,
} from './helpers.js';
import { getSession } from '../../repo/session.js';
import { listMessagesBySession } from '../../repo/message.js';

/**
 * read_session — `@会话` 引用的第二层（模型自主查阅完整记录）。
 *
 * 注册形态：boot 时以 `advertised: false` 注册（可执行、不进常驻广告列表）；
 * 仅当某轮携带 referencedSessionIds 时由 runner 经 {@link appendReadSessionTool}
 * 追加进该轮工具目录（设计：动态注册，避免目录常驻膨胀）。
 *
 * 输出：全量格式化消息日志（v1 无分页，设计开放问题 1 采纳"降级链兜底"）。
 * 64k 安全阀截断；进入 history 后再由 context-management-v2 降级链第三级
 * （单条 tool 输出 ≤ 2000 字符）按预算继续降级——两级配合。
 */

/** 单次工具输出字符上限（安全阀，对齐 read_skill 的 64k 约定）。 */
const READ_SESSION_MAX_CHARS = 64_000;

const ROLE_LABELS: Record<string, string> = {
  user: '用户',
  assistant: '助手',
  system: '系统',
  tool: '工具结果',
};

export const readSessionExecutor: ToolExecutor = {
  describe: () =>
    builtinTool({
      id: 'read-session',
      name: 'read_session',
      description:
        'Read the full message log of a session the user referenced with @. ' +
        'Use it when the injected summary is not enough to answer; ' +
        'pass the sessionId given in the reference block.',
      fields: [
        {
          name: 'sessionId',
          type: 'string',
          description: "Session id from the injected '[用户引用了会话…]' block",
          required: true,
        },
      ],
    }),
  async execute(args, context) {
    return executeLocalTool(context, () => {
      const sessionId = requiredString(args, 'sessionId', 200);
      const session = getSession(sessionId);
      if (!session) {
        return errorResult(`会话 ${sessionId} 不存在或已被删除。`);
      }

      const messages = listMessagesBySession(sessionId);
      if (messages.length === 0) {
        return textResult(`会话《${session.title}》暂无消息记录。`);
      }

      let text = `# 会话《${session.title}》完整记录（共 ${messages.length} 条）\n\n`;
      for (const m of messages) {
        const label = ROLE_LABELS[m.role] ?? m.role;
        const time = new Date(m.createdAt).toISOString();
        text += `## [${label}] ${time}\n${m.content}\n\n`;
      }

      if (text.length > READ_SESSION_MAX_CHARS) {
        text = text.slice(0, READ_SESSION_MAX_CHARS) + '\n…[truncated]';
      }
      return textResult(text);
    });
  },
};

/**
 * 仅当本轮携带 `@会话` 引用时，把 read_session 的描述符追加进工具列表。
 * 无引用时原样返回同一数组引用（零分配、零行为变化）。
 */
export function appendReadSessionTool(
  tools: Tool[],
  referencedSessionIds?: string[],
): Tool[] {
  if (!referencedSessionIds || referencedSessionIds.length === 0) return tools;
  return [...tools, readSessionExecutor.describe()];
}
