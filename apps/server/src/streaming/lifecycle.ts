import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Message, Provider, Model, AttachmentMeta } from '@my-copilot/shared';
import { createMessage, updateMessage, updateMessageContent } from '../repo/message.js';
import { updateSession } from '../repo/session.js';
import { createJob } from '../repo/job.js';
import { getAdapter } from '../llm/index.js';
import { listEnabledTools } from '../repo/tool.js';
import { listRegisteredTools } from '../tools/registry.js';
import { runAgentLoop } from '../agent-loop/runner.js';
import type { AgentLoopEvent } from '../agent-loop/runner.js';
import type { AttachmentText } from '../prompt/assembler.js';
import { buildSkillInjections } from '../prompt/skill-injections.js';
import { filterDemoTools } from '../demo/tools.js';
import { applyVisionLearningLoop } from '../capability/learning.js';
import { hasImageParts } from '../attachment/resolve.js';
import {
  registerStream,
  unregisterStream,
  appendRunEvent,
  setRunWaiting,
  isRunWaiting,
  type RunEventFrame,
} from './registry.js';
import { handleAgentEvent, writeRunResultEvent } from './agent-event.js';

// Agent 事件 → SSE 桥接已抽取至 agent-event.ts，保持既有导出路径。
export { handleAgentEvent };

/** Parameters for the stream message handler. */
interface StreamMessageParams {
  sessionId: string;
  userMessage: Message;
  provider: Provider;
  model: Model;
  attachments?: AttachmentText[];
  history: Message[];
  /** / 命令携带的手动激活 skill 名（经 buildSkillInjections 合并为 always 注入）。 */
  enforcedSkillIds?: string[];
  /** `@会话` 引用的目标会话 id（透传 runAgentLoop：注入摘要 + 追加 read_session）。 */
  referencedSessionIds?: string[];
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
  const { sessionId, userMessage, provider, model, attachments, history, enforcedSkillIds, referencedSessionIds } = params;

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
        // 学习闭环：最终生效模型（worker 侧 runAgentLoopAsJob 消费）。
        modelId: model.id,
        userContent: userMessage.content,
        // History is JSON-serialised by createJob; plain message objects.
        history,
        attachments: attachments ?? [],
        currentUserParts: userMessage.parts ?? [],
        // / 与 @ 的按轮参数：worker 执行期消费（skills 集合本身仍是执行期解析，
        // 只有用户意图随 payload 快照——与 tools 的重解析语义一致）。
        enforcedSkillIds: enforcedSkillIds ?? [],
        referencedSessionIds: referencedSessionIds ?? [],
        adapterType: provider.type,
        adapterConfig,
        enabledTools,
      },
      sessionId,
      maxAttempts: 1,
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

    /**
     * 统一出口：每个 SSE 事件先入 registry 缓冲（供重连重放），再写主连接。
     * 主连接已断开时写失败被吞掉——Run 在等待期豁免下会继续运行，
     * 事件仍进缓冲、由重连客户端消费。
     */
    const writeEvent = async (
      event: string,
      data: string,
    ): Promise<void> => {
      appendRunEvent(sessionId, { event, data } satisfies RunEventFrame);
      try {
        await stream.writeSSE({ event, data });
      } catch {
        // 主连接已断开；等待期豁免下 Run 继续，缓冲继续供重连
      }
    };

    // Send placeholder event so client can create local message UI
    await writeEvent('placeholder', JSON.stringify({ msgId: assistantMsg.id }));

    // Hono-level abort: client disconnected.
    // 等待期豁免（问答卡片刷新存活设计）：Run 挂起等用户输入时断连不中止，
    // 事件留在缓冲供重连；活跃生成期维持原 abort 语义。
    stream.onAbort(() => {
      if (!isRunWaiting(sessionId)) {
        ac.abort();
      }
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
          // 等待期标志先行：事件写入前端前就进入豁免窗口，避免
          // 「确认事件已发但断连竞态落在标志置位前」的窗口期 abort。
          if (event.type === 'tool_confirmation_required') {
            setRunWaiting(sessionId, true);
          } else if (event.type === 'tool_confirmation_settled') {
            setRunWaiting(sessionId, false);
          }
          await handleAgentEvent(event, {
            write: writeEvent,
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
      await writeRunResultEvent(result, {
        write: writeEvent,
        assistantMsgId: assistantMsg.id,
        title,
      });
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
          await writeEvent(
            'aborted',
            JSON.stringify({
              messageId: assistantMsg.id,
              partialContent: fullContent,
            }),
          );
        } else {
          await writeEvent('error', JSON.stringify({ code: 'stream_error', message: errMsg }));
        }
      } catch {
        // stream already closed, ignore
      }
    } finally {
      unregisterStream(sessionId);
    }
  });
}
