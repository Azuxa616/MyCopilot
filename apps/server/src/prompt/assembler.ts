import type { ChatMessage } from '../llm/base.js';
import type { Message, MessageStatus } from '@my-copilot/shared';

/** Parsed attachment text (full content, not metadata). */
export interface AttachmentText {
  name: string;
  content: string;
}

/** Phase 1 default system prompt — fixed Chinese instruction. */
const DEFAULT_SYSTEM_PROMPT = '你是一个乐于助人的 AI 助手,请用中文回答用户问题。';

/**
 * Assemble a complete message list for the LLM API call.
 *
 * Assembly order:
 * 1. Default system prompt
 * 2. History messages (skip `aborted`, include only `sent`)
 * 3. Attachment text blocks (prepended to user message)
 * 4. Current user message
 *
 * Phase 1: no truncation, no skills, no tool definitions.
 */
export function assembleMessages(params: {
  history: Message[];
  userContent: string;
  attachments?: AttachmentText[];
}): ChatMessage[] {
  const messages: ChatMessage[] = [];

  // 1. Default system prompt
  messages.push({ role: 'system', content: DEFAULT_SYSTEM_PROMPT });

  // 2. History — only include messages with status 'sent'
  const validStatus: MessageStatus = 'sent';
  for (const msg of params.history) {
    if (msg.status === 'aborted') continue;
    if (msg.status !== validStatus) continue;
    messages.push({ role: msg.role, content: msg.content });
  }

  // 3 & 4. Attachments + user message (in same user message)
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
