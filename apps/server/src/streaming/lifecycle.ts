import type { Context } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Message, Provider, Model, AttachmentMeta } from '@my-copilot/shared';
import { createMessage, updateMessage, updateMessageContent } from '../repo/message.js';
import { updateSession } from '../repo/session.js';
import { getAdapter } from '../llm/index.js';
import type { ChatMessage } from '../llm/base.js';
import { assembleMessages } from '../prompt/assembler.js';
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
 * 3. Assemble prompt
 * 4. Stream from LLM adapter
 * 5. Write SSE delta/done/error/aborted events
 * 6. Incremental persist (1s flush)
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

  // 3. Assemble prompt messages
  const chatMessages: ChatMessage[] = assembleMessages({
    history,
    userContent: userMessage.content,
    attachments,
  });

  // 4. Get adapter and config
  const adapter = getAdapter(provider.type);
  const adapterConfig = {
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey,
    model: model.name,
  };

  // Register this stream for abort tracking
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
      const generator = adapter.chatCompletionStream(chatMessages, adapterConfig, {
        signal: ac.signal,
      });

      for await (const chunk of generator) {
        fullContent += chunk;
        await stream.writeSSE({
          event: 'delta',
          data: JSON.stringify({ content: chunk }),
        });

        // Incremental persist: flush to DB every 1 second
        const now = Date.now();
        if (now - lastFlush > 1000) {
          updateMessageContent(assistantMsg.id, fullContent);
          lastFlush = now;
        }
      }

      // Final persist — success
      updateMessage(assistantMsg.id, {
        content: fullContent,
        status: 'sent',
      });

      // Auto-generate title from first user message
      let title = '';
      if (history.length === 0) {
        const trimmed = userMessage.content.replace(/\n/g, ' ').trim();
        if (trimmed.length > 0) {
          title = trimmed.length > 30 ? trimmed.slice(0, 30) + '...' : trimmed;
          updateSession(sessionId, { title });
        }
      }

      await stream.writeSSE({
        event: 'done',
        data: JSON.stringify({ messageId: assistantMsg.id, title }),
      });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);

      if (ac.signal.aborted) {
        // Aborted (client disconnect or /stop endpoint)
        updateMessage(assistantMsg.id, {
          content: fullContent,
          status: 'aborted',
        });
        // Best-effort: write aborted event (works for /stop, no-op for disconnect)
        try {
          await stream.writeSSE({
            event: 'aborted',
            data: JSON.stringify({
              messageId: assistantMsg.id,
              partialContent: fullContent,
            }),
          });
        } catch {
          // stream already closed, ignore
        }
      } else {
        // Real error
        updateMessage(assistantMsg.id, {
          content: fullContent,
          status: 'failed',
          error: errMsg,
        });
        try {
          await stream.writeSSE({
            event: 'error',
            data: JSON.stringify({ code: 'stream_error', message: errMsg }),
          });
        } catch {
          // stream already closed, ignore
        }
      }
    } finally {
      unregisterStream(sessionId);
    }
  });
}
