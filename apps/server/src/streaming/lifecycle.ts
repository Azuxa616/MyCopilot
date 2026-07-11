import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Message, Provider, Model, AttachmentMeta } from '@my-copilot/shared';
import { createMessage, updateMessage, updateMessageContent } from '../repo/message.js';
import { updateSession } from '../repo/session.js';
import { createJob } from '../repo/job.js';
import { getAdapter } from '../llm/index.js';
import { listEnabledTools } from '../repo/tool.js';
import { runAgentLoop } from '../agent-loop/runner.js';
import type { AgentLoopEvent } from '../agent-loop/runner.js';
import type { AttachmentText } from '../prompt/assembler.js';
import { registerStream, unregisterStream } from './registry.js';

/** Parameters for the stream message handler. */
export interface StreamMessageParams {
  sessionId: string;
  userMessage: Message;
  provider: Provider;
  model: Model;
  attachments?: AttachmentText[];
  history: Message[];
}

/**
 * Full SSE streaming lifecycle:
 * 1. Save user message
 * 2. Create placeholder assistant message
 * 3. Hand off to the agent loop runner (LLM call ↔ tool execution)
 * 4. Bridge agent-loop events to SSE via the onEvent callback
 * 5. Write final done/error/aborted event + title auto-generation
 */
export function streamMessageHandler(c: Context, params: StreamMessageParams): Response {
  const { sessionId, userMessage, provider, model, attachments, history } = params;

  // 1. Save user message
  createMessage({
    sessionId,
    role: 'user',
    content: userMessage.content,
    attachments: userMessage.attachments as AttachmentMeta[] | undefined,
    status: 'sent',
  });

  // 2. Create placeholder assistant message
  const assistantMsg = createMessage({
    sessionId,
    role: 'assistant',
    content: '',
    status: 'sending',
  });

  // 3. Get adapter and config
  const adapter = getAdapter(provider.type);
  const adapterConfig = {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: model.name,
  };

  // Advertise enabled tools to the LLM (empty list in Phase 1).
  const enabledTools = listEnabledTools();

  // ─── Async mode (Step B): enqueue a job and return immediately ───
  // When AGENT_ASYNC_MODE=true the client does not hold an SSE connection;
  // we persist a `agent-loop` job and the background worker runs the loop.
  // The client polls /api/jobs/:id (or /api/jobs/:id/stream) for progress.
  // Sync mode (default) falls through to the SSE path below.
  if (process.env.AGENT_ASYNC_MODE === 'true') {
    const job = createJob({
      type: 'agent-loop',
      payload: {
        sessionId,
        // Placeholder assistant message created above; the worker fills it.
        userMessageId: assistantMsg.id,
        userContent: userMessage.content,
        // History is JSON-serialised by createJob; plain message objects.
        history,
        attachments: attachments ?? [],
        adapterType: provider.type,
        adapterConfig,
        enabledTools,
      },
      sessionId,
    });

    // Confirm placeholder is in `sending` state (no-op if already sending).
    // The worker's runAgentLoop will transition it to sent/aborted/failed.
    updateMessage(assistantMsg.id, { content: '', status: 'sending' });

    return c.json(
      {
        data: {
          jobId: job.id,
          status: 'pending',
          message: 'Job created',
          assistantMessageId: assistantMsg.id,
        },
      },
      200,
    );
  }

  // Register this user-facing stream for abort tracking.
  const ac = registerStream(sessionId);

  return streamSSE(c, async (stream) => {
    let fullContent = '';
    let lastFlush = Date.now();

    // Send placeholder event so client can create local message UI
    await stream.writeSSE({
      event: 'placeholder',
      data: JSON.stringify({ msgId: assistantMsg.id }),
    });

    // Hono-level abort: client disconnected
    stream.onAbort(() => {
      ac.abort();
    });

    try {
      const result = await runAgentLoop({
        sessionId,
        userMessageId: assistantMsg.id,
        // Pass a shallow copy so the caller's history array is untouched.
        history: [...history],
        userContent: userMessage.content,
        attachments,
        tools: enabledTools,
        adapter,
        adapterConfig,
        abortSignal: ac.signal,
        onEvent: async (event: AgentLoopEvent) => {
          await handleAgentEvent(event, {
            stream,
            assistantMsgId: assistantMsg.id,
            onContent: (text) => {
              fullContent += text;
              const now = Date.now();
              if (now - lastFlush > 1000) {
                updateMessageContent(assistantMsg.id, fullContent);
                lastFlush = now;
              }
            },
          });
        },
      });

      // Auto-generate title from first user message (only when there's no
      // prior history).
      let title = '';
      if (history.length === 0) {
        const trimmed = userMessage.content.replace(/\n/g, ' ').trim();
        if (trimmed.length > 0) {
          title = trimmed.length > 30 ? trimmed.slice(0, 30) + '...' : trimmed;
          updateSession(sessionId, { title });
        }
      }

      // Map loop status → terminal SSE event.
      if (result.status === 'aborted') {
        try {
          await stream.writeSSE({
            event: 'aborted',
            data: JSON.stringify({
              messageId: assistantMsg.id,
              partialContent: result.content,
            }),
          });
        } catch {
          // stream already closed, ignore
        }
      } else if (result.status === 'error') {
        try {
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({
              code: 'stream_error',
              message: result.error ?? 'unknown',
            }),
          });
        } catch {
          // stream already closed, ignore
        }
      } else {
        await stream.writeSSE({
          event: 'done',
          data: JSON.stringify({ messageId: assistantMsg.id, title }),
        });
      }
    } catch (err) {
      // Errors thrown by runAgentLoop itself (not caught internally).
      const errMsg = err instanceof Error ? err.message : String(err);
      updateMessage(assistantMsg.id, {
        content: fullContent,
        status: 'failed',
        error: errMsg,
      });
      try {
        if (ac.signal.aborted) {
          await stream.writeSSE({
            event: 'aborted',
            data: JSON.stringify({
              messageId: assistantMsg.id,
              partialContent: fullContent,
            }),
          });
        } else {
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({ code: 'stream_error', message: errMsg }),
          });
        }
      } catch {
        // stream already closed, ignore
      }
    } finally {
      unregisterStream(sessionId);
    }
  });
}

// ---------------------------------------------------------------------------
// Agent event → SSE bridge
// ---------------------------------------------------------------------------

interface HandlerDeps {
  stream: {
    writeSSE: (evt: { event: string; data: string }) => Promise<void>;
  };
  assistantMsgId: string;
  onContent: (text: string) => void;
}

/**
 * Translate an AgentLoopEvent into the SSE wire format.
 *
 * Kept as a free function (not a method) so it can be unit-tested in isolation
 * once we add direct tests for the SSE mapping.
 */
async function handleAgentEvent(
  event: AgentLoopEvent,
  deps: HandlerDeps,
): Promise<void> {
  switch (event.type) {
    case 'llm_event': {
      const e = event.event;
      if (!e) return;

      if (e.type === 'content') {
        deps.onContent(e.text);
        await deps.stream.writeSSE({
          event: 'delta',
          data: JSON.stringify({ content: e.text }),
        });
      } else if (e.type === 'tool_call_start') {
        await deps.stream.writeSSE({
          event: 'tool_call_start',
          data: JSON.stringify({ messageId: deps.assistantMsgId, index: e.index }),
        });
      } else if (e.type === 'tool_call_delta') {
        await deps.stream.writeSSE({
          event: 'tool_call_delta',
          data: JSON.stringify({ messageId: deps.assistantMsgId, ...e }),
        });
      } else if (e.type === 'tool_call_done') {
        await deps.stream.writeSSE({
          event: 'tool_call_done',
          data: JSON.stringify({ messageId: deps.assistantMsgId, ...e }),
        });
      }
      // 'finish' events drive loop termination; nothing to forward to the client.
      break;
    }
    case 'tool_result': {
      if (!event.toolResult) return;
      await deps.stream.writeSSE({
        event: 'tool_result',
        data: JSON.stringify({
          messageId: deps.assistantMsgId,
          toolCallId: event.toolResult.callId,
          result: event.toolResult.result,
          isError: event.toolResult.isError,
        }),
      });
      break;
    }
    case 'agent_loop_end':
      // Terminal — handled in the main flow after runAgentLoop returns.
      break;
  }
}
