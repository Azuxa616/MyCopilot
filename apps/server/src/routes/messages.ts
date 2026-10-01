import { Hono } from 'hono';
import type { MessagePart } from '@my-copilot/shared';
import { getSession } from '../repo/session.js';
import { getModel } from '../repo/model.js';
import { getProvider } from '../repo/provider.js';
import { listMessagesBySession, deleteMessage } from '../repo/message.js';
import { successResponse } from '../utils/response.js';
import { HttpError } from '../middleware/error.js';
import {
  resolveAssetsFromFiles,
  resolveAssetsFromIds,
  type SendAttachmentOutcome,
} from '../attachment/send-pipeline.js';
import { projectPartsToText } from '../attachment/projection.js';
import { streamMessageHandler } from '../streaming/lifecycle.js';
import { stopStreamHandler } from '../streaming/stop.js';

export const messagesApp = new Hono();

messagesApp.post('/', async (c) => {
  const sessionId = c.req.param('sessionId');
  if (!sessionId) {
    throw new HttpError(400, 'Missing sessionId');
  }

  // 1. Verify session exists
  const session = getSession(sessionId);
  if (!session) {
    throw new HttpError(404, 'Session not found');
  }

  // 2. 解析请求体：JSON（新管道：assetIds 引用已上传资产）或 multipart
  //    （兼容通道：文件在服务端资产化——文本附件一并走持久化资产层）。
  const emptyOutcome: SendAttachmentOutcome = {
    attachmentsMeta: [],
    attachmentTexts: [],
    imageParts: [],
    warnings: [],
  };
  let content = '';
  let outcome = emptyOutcome;

  const contentTypeHeader = c.req.header('content-type') ?? '';
  if (contentTypeHeader.includes('application/json')) {
    const body =
      (await c.req.json().catch(() => null)) as { content?: unknown; assetIds?: unknown } | null;
    if (!body || typeof body.content !== 'string') {
      throw new HttpError(400, 'Missing content');
    }
    content = body.content;
    const assetIds = Array.isArray(body.assetIds)
      ? body.assetIds.filter((v): v is string => typeof v === 'string')
      : [];
    if (assetIds.length > 0) {
      outcome = await resolveAssetsFromIds(assetIds);
    }
  } else {
    const form = await c.req.formData();
    content = (form.get('content') as string) || '';

    const files: Array<{ name: string; type: string; data: Buffer }> = [];
    for (const entry of form.getAll('files[]')) {
      if (entry && typeof entry !== 'string') {
        const file = entry as unknown as { name: string; type: string; arrayBuffer(): Promise<ArrayBuffer> };
        const data = Buffer.from(await file.arrayBuffer());
        files.push({ name: file.name, type: file.type, data });
      }
    }

    // Enforce attachment size limit (multipart 兼容通道保留原语义)
    const maxSizeMb = Number(process.env.MAX_ATTACHMENT_SIZE_MB) || 10;
    const maxBytes = maxSizeMb * 1024 * 1024;
    const totalBytes = files.reduce((sum, f) => sum + f.data.length, 0);
    if (totalBytes > maxBytes) {
      throw new HttpError(413, `Attachment total size exceeds ${maxSizeMb}MB limit`);
    }

    if (files.length > 0) {
      outcome = await resolveAssetsFromFiles(files);
    }
  }

  if (content.length > 100000) {
    throw new HttpError(400, 'Message content must be 100,000 characters or less');
  }

  // 3. 解析失败保持既有 422 契约
  if (outcome.warnings.length > 0) {
    throw new HttpError(422, `Attachment parsing failed: ${outcome.warnings.join('; ')}`);
  }

  // 4. 图片 parts → content 纯文本投影（[图片: name] 占位 + 用户文本）
  let finalContent = content;
  let currentUserParts: MessagePart[] | undefined;
  if (outcome.imageParts.length > 0) {
    const nameOf = (assetId: string): string =>
      outcome.attachmentsMeta.find((m) => m.assetId === assetId)?.name ?? assetId;
    const projection = projectPartsToText(outcome.imageParts, nameOf);
    finalContent = content.length > 0 ? `${projection}\n${content}` : projection;
    currentUserParts = outcome.imageParts;
  }

  // 5. Resolve provider and model
  if (!session.modelId) {
    throw new HttpError(400, 'No model configured for this session');
  }

  const model = getModel(session.modelId);
  if (!model) {
    throw new HttpError(400, 'Model not found');
  }

  const provider = getProvider(model.providerId);
  if (!provider) {
    throw new HttpError(400, 'Provider not found');
  }
  if (!provider.enabled) {
    throw new HttpError(400, 'Provider is disabled');
  }

  // 6. Build history
  const history = listMessagesBySession(sessionId);

  // 7. Stream (lifecycle handler persists both user and assistant messages)
  return streamMessageHandler(c, {
    sessionId,
    userMessage: {
      id: '',
      sessionId,
      role: 'user',
      content: finalContent,
      attachments: outcome.attachmentsMeta,
      ...(currentUserParts ? { parts: currentUserParts } : {}),
      status: 'sent',
      createdAt: Date.now(),
    },
    provider,
    model,
    attachments: outcome.attachmentTexts.length > 0 ? outcome.attachmentTexts : undefined,
    history,
  });
});

messagesApp.post('/stop', (c) => {
  const sessionId = c.req.param('sessionId');
  if (!sessionId) {
    throw new HttpError(400, 'Missing sessionId');
  }
  return stopStreamHandler(c, { sessionId });
});

messagesApp.delete('/:id', (c) => {
  const id = c.req.param('id');
  if (!id) {
    throw new HttpError(400, 'Missing message id');
  }
  const deleted = deleteMessage(id);
  if (!deleted) {
    throw new HttpError(404, 'Message not found');
  }
  return successResponse(c, { deleted });
});
