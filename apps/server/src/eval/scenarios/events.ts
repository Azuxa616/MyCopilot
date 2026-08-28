/**
 * 场景脚本共用的 StreamEvent 构造器（纯数据，无运行时逻辑）。
 *
 * runner 只消费 tool_call_done / content / finish 三类事件累积状态
 * （runner.ts:431-455）；tool_call_start 仅为流形状真实性保留。
 */
import type { StreamEvent } from '@my-copilot/shared';

/** 一次工具调用的最小描述（id 唯一即可，arguments 为普通对象）。 */
export interface ScriptedCall {
  id: string;
  name: string;
  args: unknown;
}

/** 构造一轮「可选文本 + 若干工具调用」的回放事件（finish=tool_calls，循环继续）。 */
export function toolRound(options: {
  content?: string;
  calls: readonly ScriptedCall[];
}): StreamEvent[] {
  const events: StreamEvent[] = [];
  if (options.content !== undefined) {
    events.push({ type: 'content', text: options.content });
  }
  options.calls.forEach((call, index) => {
    events.push({ type: 'tool_call_start', index });
    events.push({
      type: 'tool_call_done',
      index,
      id: call.id,
      name: call.name,
      arguments: JSON.stringify(call.args),
    });
  });
  events.push({ type: 'finish', reason: 'tool_calls' });
  return events;
}

/** 构造一轮纯文本收尾事件（finish=stop）。摘要降级轮（被 L2 消耗）也用它。 */
export function finalRound(text: string): StreamEvent[] {
  return [
    { type: 'content', text },
    { type: 'finish', reason: 'stop' },
  ];
}

/**
 * 生成恰好指定字符数的确定性填充文本（repeat + slice 截齐）。
 *
 * token 估算口径为 ceil(chars/4)（token-counter.ts），场景按精确字符数
 * 设计阈值边界（如 summarization-trigger 的每轮 1700 字符）。
 */
export function fillerText(length: number, sentence: string): string {
  if (sentence.length === 0) throw new Error('fillerText 需要非空句子');
  return sentence.repeat(Math.ceil(length / sentence.length)).slice(0, length);
}
