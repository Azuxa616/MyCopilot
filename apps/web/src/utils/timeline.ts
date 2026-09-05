// timeline.ts（utils）— 刷新后从服务端消息重建过程时间线。
//
// 服务端落库结构：每轮 = assistant(toolCalls) 前导消息 + role='tool' 结果消息，
// 终态 = 无 toolCalls 的 assistant。注意 streaming/lifecycle.ts 在 run 开始时
// 就创建终态占位消息（created_at 与 user 消息同毫秒/仅 +1ms），中间轮在其后
// 落库——因此 ORDER BY created_at 下终态永远排在中间轮之前，聚组不能依赖
// 消息顺序：两条 user 消息之间视为一个 run，run 内「无 toolCalls 的
// assistant」即终态，全部中间轮聚为它的时间线，输出时终态紧跟其 user 消息。
//
// 已知限制：reasoning 不持久化（服务端未落库），刷新后思考条目不回放；
// tool 消息不含 isError 标记，重建条目一律 status='done'。
import type { Message } from '@my-copilot/shared';
import type { MessageWithTimeline, TimelineEntry } from '../types/timeline';

/**
 * 重建各 assistant 终态消息的时间线并剔除中间消息。
 * 纯函数：不修改输入数组中的任何对象。
 */
export function attachTimelines(
  messages: MessageWithTimeline[],
): MessageWithTimeline[] {
  const out: MessageWithTimeline[] = [];
  // 当前 run（两条 user 消息之间）的累积状态
  let entries: TimelineEntry[] = [];
  let terminals: MessageWithTimeline[] = [];
  let runMessages: MessageWithTimeline[] = [];

  const flushRun = () => {
    const [terminal] = terminals;
    if (terminals.length === 1 && terminal !== undefined) {
      const attached: MessageWithTimeline = { ...terminal };
      if (entries.length > 0 && attached.timeline === undefined) {
        attached.timeline = entries;
      }
      out.push(attached);
    } else {
      // 防御：run 内无终态（数据不完整）或多个终态（非预期形状）——
      // 原样输出全部消息，绝不静默吞数据。
      out.push(...runMessages);
    }
    entries = [];
    terminals = [];
    runMessages = [];
  };

  for (const msg of messages) {
    // user 消息开启新 run：先落盘上一个 run
    if (msg.role === 'user') {
      flushRun();
      out.push({ ...msg });
      continue;
    }

    runMessages.push(msg);

    // 中间轮：assistant 带 toolCalls → lead 条目（content 非空时）+ 工具条目
    if (msg.role === 'assistant') {
      if (msg.toolCalls && msg.toolCalls.length > 0) {
        if (msg.content.trim().length > 0) {
          entries.push({
            kind: 'lead',
            id: `lead-${msg.id}`,
            text: msg.content,
          });
        }
        for (const call of msg.toolCalls) {
          entries.push({
            kind: 'tool',
            id: call.id,
            name: call.name,
            status: 'done',
            args: call.arguments,
            startedAt: msg.createdAt,
            endedAt: msg.createdAt,
          });
        }
      } else {
        // 终态（无 toolCalls 的 assistant，含 aborted/failed 占位）
        terminals.push(msg);
      }
      continue;
    }

    // 工具结果：按 toolCallId 回填结果，并把结束时间修正为结果落库时刻
    if (msg.role === 'tool' && msg.toolCallId) {
      entries = entries.map((e) =>
        e.kind === 'tool' && e.id === msg.toolCallId
          ? { ...e, result: msg.content, endedAt: msg.createdAt }
          : e,
      );
    }
    // 其他角色：留在 runMessages 中原样透传（防御性兜底）
  }
  flushRun();

  return out;
}

/** 仅供测试与调用方类型收窄使用：Message 数组的直通转换。 */
export function asTimelineMessages(messages: Message[]): MessageWithTimeline[] {
  return messages as MessageWithTimeline[];
}
