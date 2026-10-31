import type { AttachmentMeta, Job, Message } from '@my-copilot/shared';
import { createMessage, updateMessage } from '../repo/message.js';
import { createJob } from '../repo/job.js';
import { listEnabledTools } from '../repo/tool.js';
import { listRegisteredTools } from '../tools/registry.js';
import { filterDemoTools } from '../demo/tools.js';
import type { AttachmentText } from '../prompt/assembler.js';
import type { Provider, Model } from '@my-copilot/shared';

export interface StreamMessageParams {
  sessionId: string;
  userMessage: Message;
  provider: Provider;
  model: Model;
  attachments?: AttachmentText[];
  history: Message[];
  enforcedSkillIds?: string[];
  referencedSessionIds?: string[];
}

/** 创建一轮用户/Assistant 消息并把完整 Agent 执行意图持久化为 Job。 */
export function enqueueAgentLoop(params: StreamMessageParams): {
  job: Job;
  userMessage: Message;
  assistantMessage: Message;
} {
  const { sessionId, userMessage, provider, model, attachments, history, enforcedSkillIds, referencedSessionIds } = params;
  const persistedUser = createMessage({
    sessionId,
    role: 'user',
    content: userMessage.content,
    attachments: userMessage.attachments as AttachmentMeta[] | undefined,
    parts: userMessage.parts,
    status: 'sent',
  });
  const assistantMessage = createMessage({ sessionId, role: 'assistant', content: '', status: 'sending' });
  const enabledTools = filterDemoTools([
    ...listRegisteredTools(),
    ...listEnabledTools().filter((tool) => tool.type === 'mcp-provided' && tool.sourceMcpId !== null),
  ]);
  const job = createJob({
    type: 'agent-loop',
    payload: {
      sessionId,
      userMessageId: assistantMessage.id,
      modelId: model.id,
      userContent: userMessage.content,
      history,
      attachments: attachments ?? [],
      currentUserParts: userMessage.parts ?? [],
      enforcedSkillIds: enforcedSkillIds ?? [],
      referencedSessionIds: referencedSessionIds ?? [],
      adapterType: provider.type,
      adapterConfig: { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: model.name },
      enabledTools,
    },
    sessionId,
    maxAttempts: 1,
  });
  updateMessage(assistantMessage.id, { content: '', status: 'sending' });
  return { job, userMessage: persistedUser, assistantMessage };
}
