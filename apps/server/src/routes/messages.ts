import { Hono } from 'hono';
import { getSession } from '../repo/session.js';
import { getModel } from '../repo/model.js';
import { getProvider } from '../repo/provider.js';
import { listMessagesBySession, deleteMessage } from '../repo/message.js';
import { successResponse } from '../utils/response.js';
import { HttpError } from '../middleware/error.js';
import { parseAllAttachments } from '../attachment/index.js';
import { streamMessageHandler } from '../streaming/lifecycle.js';
import { stopStreamHandler } from '../streaming/stop.js';
import type { AttachmentText } from '../prompt/assembler.js';

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

  // 2. Parse multipart form
  const form = await c.req.formData();
  const content = (form.get('content') as string) || '';
  if (content.length > 100000) {
    throw new HttpError(400, 'Message content must be 100,000 characters or less');
  }

  const files: Array<{ name: string; type: string; data: Buffer }> = [];
  for (const entry of form.getAll('files[]')) {
    if (entry && typeof entry !== 'string') {
      const file = entry as unknown as { name: string; type: string; arrayBuffer(): Promise<ArrayBuffer> };
      const data = Buffer.from(await file.arrayBuffer());
      files.push({ name: file.name, type: file.type, data });
    }
  }

  // 3. Enforce attachment size limit
  const maxSizeMb = Number(process.env.MAX_ATTACHMENT_SIZE_MB) || 10;
  const maxBytes = maxSizeMb * 1024 * 1024;
  const totalBytes = files.reduce((sum, f) => sum + f.data.length, 0);
  if (totalBytes > maxBytes) {
    throw new HttpError(413, `Attachment total size exceeds ${maxSizeMb}MB limit`);
  }

  // 4. Parse attachments
  const { results } = await parseAllAttachments(files);
  const attachmentTexts: AttachmentText[] = results
    .filter((r): r is typeof r & { success: true; meta: { name: string }; text: string } => r.success)
    .map((r) => ({ name: r.meta!.name, content: r.text! }));

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
      content,
      attachments: results.filter((r) => r.success).map((r) => r.meta!),
      status: 'sent',
      createdAt: Date.now(),
    },
    provider,
    model,
    attachments: attachmentTexts,
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
