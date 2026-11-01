import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import {
  attachRunSink,
  detachRunSink,
  hasActiveRun,
  type RunEventSink,
} from './registry.js';

/** GET /api/sessions/:sessionId/events 的参数。 */
export interface AttachEventsParams {
  sessionId: string;
}

/**
 * SSE 重连端点（问答卡片刷新存活设计，docs/2026-10-31-question-card-design.md §5）：
 * - 无活动 Run：发一个 `idle` 事件后关闭（前端视为无事发生）。
 * - 有活动 Run：先重放缓冲帧，再作为实时 sink 挂接，直至 Run 终态或客户端断开。
 */
export function attachEventsHandler(c: Context, params: AttachEventsParams): Response {
  const { sessionId } = params;

  if (!hasActiveRun(sessionId)) {
    return streamSSE(c, async (stream) => {
      await stream.writeSSE({ event: 'idle', data: '{}' });
    });
  }

  return streamSSE(c, async (stream) => {
    let closed = false;
    let finish: () => void = () => {};
    const sink: RunEventSink = {
      write: async (frame) => {
        if (closed) return;
        try {
          await stream.writeSSE(frame);
        } catch {
          closed = true;
          finish();
        }
      },
      close: () => {
        if (closed) return;
        closed = true;
        finish();
        try {
          stream.close();
        } catch {
          // stream 已被框架关闭
        }
      },
    };

    const replay = attachRunSink(sessionId, sink);
    for (const frame of replay) {
      if (closed) break;
      try {
        await stream.writeSSE(frame);
      } catch {
        closed = true;
        break;
      }
    }

    // 重放期间 Run 已结束（缓冲被清空且无活动 Run）：直接收尾，
    // 避免客户端面对一个永远不关闭的空流。
    if (!closed && !hasActiveRun(sessionId)) {
      closed = true;
      detachRunSink(sessionId, sink);
      try {
        stream.close();
      } catch {
        // stream 已被框架关闭
      }
      return;
    }

    await new Promise<void>((resolve) => {
      finish = () => {
        detachRunSink(sessionId, sink);
        resolve();
      };
      stream.onAbort(() => {
        closed = true;
        finish();
      });
    });
  });
}
