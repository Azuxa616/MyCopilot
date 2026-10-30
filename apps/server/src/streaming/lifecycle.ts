import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { AttachmentMeta } from '@my-copilot/shared';
import { createMessage, updateMessage, updateMessageContent } from '../repo/message.js';
import { updateSession } from '../repo/session.js';
import { getAdapter } from '../llm/index.js';
import { listEnabledTools } from '../repo/tool.js';
import { listRegisteredTools } from '../tools/registry.js';
import { runAgentLoop } from '../agent-loop/runner.js';
import type { AgentLoopEvent } from '../agent-loop/runner.js';
import { buildSkillInjections } from '../prompt/skill-injections.js';
import { filterDemoTools } from '../demo/tools.js';
import { applyVisionLearningLoop } from '../capability/learning.js';
import { hasImageParts } from '../attachment/resolve.js';
import { registerStream, unregisterStream } from './registry.js';
import { enqueueAgentLoop } from '../jobs/enqueue-agent-loop.js';
import type { StreamMessageParams } from '../jobs/enqueue-agent-loop.js';

export type { StreamMessageParams } from '../jobs/enqueue-agent-loop.js';

/**
 * Full SSE streaming lifecycle:
 * 1. Save user message
 * 2. Create placeholder assistant message
 * 3. Hand off to the agent loop runner (LLM call ↔ tool execution)
 * 4. Bridge agent-loop events to SSE via the onEvent callback
 * 5. Write final done/error/aborted event + title auto-generation
 */
export function streamMessageHandler(c: Context, params: StreamMessageParams): Response {
  const { sessionId, userMessage, provider, model, attachments, history, enforcedSkillIds, referencedSessionIds } = params;

  if (process.env.AGENT_ASYNC_MODE === 'true') {
    const { job, assistantMessage } = enqueueAgentLoop(params);
    return c.json({
      data: {
        jobId: job.id,
        status: 'pending',
        message: 'Job created',
        assistantMessageId: assistantMessage.id,
      },
    }, 200);
  }

  // 1. Save user message
  createMessage({
    sessionId,
    role: 'user',
    content: userMessage.content,
    attachments: userMessage.attachments as AttachmentMeta[] | undefined,
    parts: userMessage.parts,
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
  // Filter out orphan mcp-provided tools (source_mcp_id=null): they have no
  // live MCP server to execute against, so resolveExecutionTarget would throw
  // "Unknown tool" on every call, triggering endless model retries. Such rows
  // are typically legacy test data — the API forbids manual create/delete of
  // tools, and syncMcpTools always writes a non-null source_mcp_id, so a null
  // source on a mcp-provided row is a data-integrity violation.
  const enabledTools = filterDemoTools([
    ...listRegisteredTools(),
    ...listEnabledTools().filter(
      (tool) =>
        tool.type === 'mcp-provided' && tool.sourceMcpId !== null,
    ),
  ]);

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
        currentUserParts: userMessage.parts,
        // Skills 注入（修复死路径）：enabled skills 在执行期从 DB 解析进 prompt；
        // / 命令的 enforcedSkillIds 在此合并（always 语义）。
        skills: buildSkillInjections(enforcedSkillIds),
        referencedSessionIds,
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

      // ─── 学习闭环（同步链路；capability/learning.ts 单点，manual 锁由 repo 保证）───
      applyVisionLearningLoop({
        modelId: model.id,
        outboundHasImage: hasImageParts(userMessage.parts),
        result,
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
          data: JSON.stringify({
            messageId: assistantMsg.id,
            title,
            // Authoritative final content from the runner (last iteration's
            // text only). The client uses this to override the locally-
            // accumulated SSE deltas, which would otherwise concatenate
            // text from every agent-loop iteration into the placeholder
            // message (e.g. "好的，我来调用一下…好的，我再调用一次…").
            content: result.content,
          }),
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
export async function handleAgentEvent(
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
      } else if (e.type === 'reasoning') {
        await deps.stream.writeSSE({
          event: 'reasoning',
          data: JSON.stringify({ text: e.text }),
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
    case 'tool_confirmation_required': {
      await deps.stream.writeSSE({
        event: 'confirmation_required',
        data: JSON.stringify({
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
      });
      break;
    }
    case 'scheduled_task_draft':
      await deps.stream.writeSSE({
        event: 'scheduled_task_draft',
        data: JSON.stringify({ draftId: event.draft.id }),
      });
      break;
    case 'tool_confirmation_settled':
      break;
    case 'agent_loop_end':
      // Terminal — handled in the main flow after runAgentLoop returns.
      break;
  }
}
