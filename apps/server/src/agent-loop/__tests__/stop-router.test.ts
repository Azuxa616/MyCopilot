import { describe, it, expect } from 'vitest';
import type { StopReason, StreamEvent } from '@my-copilot/shared';
import { STOP_REASON_ROUTING, routeStopReason, extractReasoning } from '../stop-router.js';
import type { NextAction } from '../stop-router.js';

// ---------------------------------------------------------------------------
// 路由表（RFC §6 的完整枚举，与实现独立声明以做交叉验证）
// ---------------------------------------------------------------------------

const ROUTING_TABLE: { reason: StopReason; action: NextAction }[] = [
  { reason: 'end_turn', action: 'terminate_completed' },
  { reason: 'tool_use', action: 'continue' },
  { reason: 'max_steps', action: 'terminate_incomplete' },
  { reason: 'max_tokens', action: 'compress_context' },
  { reason: 'user_interrupt', action: 'terminate_cancelled' },
  { reason: 'error', action: 'error' },
];

describe('STOP_REASON_ROUTING / routeStopReason', () => {
  it.each(ROUTING_TABLE)('$reason → $action', ({ reason, action }) => {
    expect(STOP_REASON_ROUTING[reason]).toBe(action);
    expect(routeStopReason(reason)).toBe(action);
  });

  it('未知 stop_reason 抛错', () => {
    expect(() => routeStopReason('unknown' as StopReason)).toThrow(/unknown/);
  });
});

describe('extractReasoning', () => {
  it('reasoning 事件返回推理文本', () => {
    const event: StreamEvent = { type: 'reasoning', text: '思考片段' };
    expect(extractReasoning(event)).toBe('思考片段');
  });

  it('content 事件返回 null', () => {
    const event: StreamEvent = { type: 'content', text: '正文' };
    expect(extractReasoning(event)).toBeNull();
  });

  it('tool_call_done 事件返回 null', () => {
    const event: StreamEvent = {
      type: 'tool_call_done',
      index: 0,
      id: 'call-1',
      name: 'calc',
      arguments: '{}',
    };
    expect(extractReasoning(event)).toBeNull();
  });
});
