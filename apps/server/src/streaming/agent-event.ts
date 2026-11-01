import type { AgentLoopEvent, AgentLoopResult } from '../agent-loop/runner.js';

/** Agent 事件桥接的最小写出依赖（由 lifecycle 注入）。 */
export interface AgentEventDeps {
  write: (event: string, data: string) => Promise<void>;
  assistantMsgId: string;
  onContent: (text: string) => void;
}

/** Run 终态事件的写出依赖。 */
export interface RunResultEventDeps {
  write: (event: string, data: string) => Promise<void>;
  assistantMsgId: string;
  title: string;
}

/**
 * Translate an AgentLoopEvent into the SSE wire format.
 *
 * Kept as a free function (not a method) so it can be unit-tested in isolation
 * once we add direct tests for the SSE mapping.
 */
export async function handleAgentEvent(
  event: AgentLoopEvent,
  deps: AgentEventDeps,
): Promise<void> {
  switch (event.type) {
    case 'llm_event': {
      const e = event.event;
      if (!e) return;

      if (e.type === 'content') {
        deps.onContent(e.text);
        await deps.write('delta', JSON.stringify({ content: e.text }));
      } else if (e.type === 'tool_call_start') {
        await deps.write(
          'tool_call_start',
          JSON.stringify({ messageId: deps.assistantMsgId, index: e.index }),
        );
      } else if (e.type === 'tool_call_delta') {
        await deps.write(
          'tool_call_delta',
          JSON.stringify({ messageId: deps.assistantMsgId, ...e }),
        );
      } else if (e.type === 'tool_call_done') {
        await deps.write(
          'tool_call_done',
          JSON.stringify({ messageId: deps.assistantMsgId, ...e }),
        );
      } else if (e.type === 'reasoning') {
        await deps.write('reasoning', JSON.stringify({ text: e.text }));
      }
      // 'finish' events drive loop termination; nothing to forward to the client.
      break;
    }
    case 'tool_result': {
      if (!event.toolResult) return;
      await deps.write(
        'tool_result',
        JSON.stringify({
          messageId: deps.assistantMsgId,
          toolCallId: event.toolResult.callId,
          result: event.toolResult.result,
          isError: event.toolResult.isError,
        }),
      );
      break;
    }
    case 'tool_confirmation_required': {
      await deps.write(
        'confirmation_required',
        JSON.stringify({
          approvalId: event.approval.approvalId,
          messageId: deps.assistantMsgId,
          toolCallId: event.approval.toolCallId,
          toolName: event.approval.tool.name,
          arguments: event.approval.arguments,
          resourceScope: event.approval.resourceScope,
          source: event.approval.tool.source,
          sourceMcpId: event.approval.tool.sourceMcpId,
          safetyLevel: event.approval.safetyLevel,
          expiresAt: event.approval.expiresAt,
        }),
      );
      break;
    }
    case 'tool_confirmation_settled':
      break;
    case 'agent_loop_end':
      // Terminal — handled in the main flow after runAgentLoop returns.
      break;
  }
}

/** Run 终态（completed / error / aborted）→ 终态 SSE 事件。 */
export async function writeRunResultEvent(
  result: AgentLoopResult,
  deps: RunResultEventDeps,
): Promise<void> {
  if (result.status === 'aborted') {
    try {
      await deps.write(
        'aborted',
        JSON.stringify({
          messageId: deps.assistantMsgId,
          partialContent: result.content,
        }),
      );
    } catch {
      // stream already closed, ignore
    }
  } else if (result.status === 'error') {
    try {
      await deps.write(
        'error',
        JSON.stringify({
          code: 'stream_error',
          message: result.error ?? 'unknown',
        }),
      );
    } catch {
      // stream already closed, ignore
    }
  } else {
    await deps.write(
      'done',
      JSON.stringify({
        messageId: deps.assistantMsgId,
        title: deps.title,
        // Authoritative final content from the runner (last iteration's
        // text only). The client uses this to override the locally-
        // accumulated SSE deltas, which would otherwise concatenate
        // text from every agent-loop iteration into the placeholder
        // message (e.g. "好的，我来调用一下…好的，我再调用一次…”).
        content: result.content,
      }),
    );
  }
}
