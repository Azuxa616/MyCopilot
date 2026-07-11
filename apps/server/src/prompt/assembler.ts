import type { ChatMessage } from '../llm/base.js';
import type { Message, MessageStatus } from '@my-copilot/shared';
import { truncateHistory } from './truncator.js';

/** Parsed attachment text (full content, not metadata). */
export interface AttachmentText {
  name: string;
  content: string;
}

/** Skill body to inject into the system prompt. */
export interface SkillInjection {
  name: string;
  body: string;
}

/** Prior conversation summary to inject as a third system message (T26). */
export interface SummaryInjection {
  text: string;
}

/** Phase 1 default system prompt — fixed Chinese instruction. */
const DEFAULT_SYSTEM_PROMPT = '你是一个乐于助人的 AI 助手,请用中文回答用户问题。';

/**
 * Assemble a complete message list for the LLM API call.
 *
 * Assembly order:
 * 1. Default system prompt
 * 2. Enabled skills (as additional system message, sorted by createdAt upstream)
 * 3. Prior conversation summary (T26, optional third system message)
 * 4. History messages:
 *    a. filter to `status === 'sent'`
 *    b. truncate to `maxTokens` budget when provided (T24, preserves tool chains)
 *    c. convert to ChatMessage (tool-role handling)
 * 5. Attachment text blocks (prepended to user message)
 * 6. Current user message
 *
 * Skills are pre-sorted (by createdAt) by the caller. The assembler only
 * filters out empty bodies and joins them into a single system message.
 *
 * `summary` and `maxTokens` are optional. When omitted, behavior is
 * byte-identical to the pre-T26 assembler (backward compatible).
 */
export function assembleMessages(params: {
  history: Message[];
  userContent: string;
  attachments?: AttachmentText[];
  skills?: SkillInjection[];
  summary?: SummaryInjection;
  maxTokens?: number;
}): ChatMessage[] {
  const messages: ChatMessage[] = [];

  // 1. Default system prompt
  messages.push({ role: 'system', content: DEFAULT_SYSTEM_PROMPT });

  // 2. Inject enabled skills (if provided) as an additional system message.
  if (params.skills && params.skills.length > 0) {
    const skillBlocks = params.skills
      .filter((s) => s.body.trim().length > 0)
      .map((s) => `# Skill: ${s.name}\n\n${s.body.trim()}`)
      .join('\n\n---\n\n');
    if (skillBlocks) {
      messages.push({
        role: 'system',
        content: `The following skills are available. Follow their instructions when relevant:\n\n${skillBlocks}`,
      });
    }
  }

  // 3. Inject prior conversation summary (T26) as a third system message.
  //    Placed AFTER default prompt and skills so the LLM reads framing →
  //    capabilities → recent context. Backward-compatible: omitted when no summary.
  if (params.summary && params.summary.text.trim().length > 0) {
    messages.push({
      role: 'system',
      content: `[Previous conversation summary]\n\n${params.summary.text}`,
    });
  }

  // 4a. History — filter to only `status === 'sent'` messages first. Splitting
  //     filtering from conversion (T26) lets truncateHistory run on a clean
  //     Message[] view, before role/toolCallId reshaping.
  const validStatus: MessageStatus = 'sent';
  const validMessages: Message[] = params.history.filter(
    (msg) => msg.status !== 'aborted' && msg.status === validStatus,
  );

  // 4b. Truncate to the token budget when provided. truncateHistory operates
  //     on DB Message[] and preserves assistant+tool chains.
  const finalHistory =
    typeof params.maxTokens === 'number' && params.maxTokens > 0
      ? truncateHistory({ history: validMessages, maxTokens: params.maxTokens }).truncated
      : validMessages;

  // 4c. Convert filtered (and possibly truncated) Message[] → ChatMessage[].
  //     Tool-role messages keep their toolCallId; others forward toolCalls.
  for (const msg of finalHistory) {
    if (msg.role === 'tool') {
      // Tool-result messages must reference their parent tool call.
      if (!msg.toolCallId) continue;
      messages.push({
        role: 'tool',
        content: msg.content,
        toolCallId: msg.toolCallId,
      });
    } else {
      // user / assistant / system — forward toolCalls when present
      messages.push({
        role: msg.role,
        content: msg.content,
        ...(msg.toolCalls ? { toolCalls: msg.toolCalls } : {}),
      });
    }
  }

  // 5 & 6. Attachments + user message (in same user message)
  let userContent = '';
  if (params.attachments && params.attachments.length > 0) {
    for (const att of params.attachments) {
      userContent += `[附件:${att.name}]\n${att.content}\n[/附件]\n`;
    }
  }
  userContent += params.userContent;
  messages.push({ role: 'user', content: userContent });

  return messages;
}
