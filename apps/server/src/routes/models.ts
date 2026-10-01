import { Hono } from 'hono';
import {
  listModelsByProvider,
  getModel,
  createModel,
  updateModel,
  deleteModel,
  setModelVisionCapability,
  clearModelVisionCapability,
} from '../repo/model.js';
import { getProvider } from '../repo/provider.js';
import { successResponse } from '../utils/response.js';
import { HttpError } from '../middleware/error.js';
import { ProviderError } from '../llm/index.js';
import { probeVisionByChat } from '../capability/probe.js';
import { resolveAndPersistVision } from '../capability/resolve.js';
import { isVisionCapabilityError } from '../capability/classify.js';
import type { CreateModelParams, ProbeVisionResponse } from '@my-copilot/shared';

export const modelsApp = new Hono();

modelsApp.get('/', (c) => {
  const providerId = c.req.param('providerId');
  if (!providerId) {
    throw new HttpError(400, 'Missing providerId');
  }
  const data = listModelsByProvider(providerId);
  return successResponse(c, data);
});

modelsApp.post('/', async (c) => {
  const providerId = c.req.param('providerId');
  if (!providerId) {
    throw new HttpError(400, 'Missing providerId');
  }
  const body = await c.req.json<CreateModelParams>();

  if (!body.name) {
    throw new HttpError(400, 'Missing required field: name');
  }
  if (body.name.length > 100) {
    throw new HttpError(400, 'Name must be 100 characters or less');
  }
  if (body.displayName && body.displayName.length > 100) {
    throw new HttpError(400, 'Display name must be 100 characters or less');
  }

  const data = createModel(providerId, body);
  return successResponse(c, data, 201);
});

modelsApp.get('/:id', (c) => {
  const id = c.req.param('id');
  const data = getModel(id);
  if (!data) {
    throw new HttpError(404, 'Model not found');
  }
  return successResponse(c, data);
});

modelsApp.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  const data = updateModel(id, body);
  if (!data) {
    throw new HttpError(404, 'Model not found');
  }
  return successResponse(c, data);
});

modelsApp.delete('/:id', (c) => {
  const id = c.req.param('id');
  const deleted = deleteModel(id);
  if (!deleted) {
    throw new HttpError(404, 'Model not found');
  }
  return successResponse(c, { deleted });
});

// ---------------------------------------------------------------------------
// Model capability endpoints — 挂载于 /api/models（见 index.ts）：
//   POST  /:id/probe-vision   设置页"测试图片输入"（设计 L4）
//   PATCH /:id/capabilities   手动设置/清除能力（source=manual 锁）
// ---------------------------------------------------------------------------

export const modelCapabilitiesApp = new Hono();

modelCapabilitiesApp.post('/:id/probe-vision', async (c) => {
  const id = c.req.param('id');
  const model = getModel(id);
  if (!model) {
    throw new HttpError(404, 'Model not found');
  }
  const provider = getProvider(model.providerId);
  if (!provider) {
    throw new HttpError(404, 'Provider not found');
  }

  // manual 锁：手动是最终仲裁，探测不覆盖（locked 标记供 UI 提示）。
  if (model.capabilities?.sources?.vision === 'manual') {
    const payload: ProbeVisionResponse = {
      model,
      probe: {
        method: 'skipped',
        vision: model.capabilities.vision ?? 'unknown',
        source: 'manual',
        locked: true,
      },
    };
    return successResponse(c, payload);
  }

  // ollama：provider 原生 /api/show 即确定性判定（chat 消息格式不支持 content array）。
  if (provider.type === 'ollama') {
    const updated = (await resolveAndPersistVision(model, provider)) ?? model;
    const caps = updated.capabilities;
    const payload: ProbeVisionResponse = {
      model: updated,
      probe: {
        method: 'provider-show',
        vision: caps?.vision ?? 'unknown',
        ...(caps?.sources?.vision ? { source: caps.sources.vision } : {}),
      },
    };
    return successResponse(c, payload);
  }

  // openai 兼容：真实小图请求 + 答案验证（设计 L4；判定标准见 capability/probe.ts）。
  try {
    const verdict = await probeVisionByChat(provider, model.name);
    const updated = setModelVisionCapability(id, verdict, 'probe') ?? model;
    const payload: ProbeVisionResponse = {
      model: updated,
      probe: {
        method: 'chat',
        vision: verdict,
        source: 'probe',
        ...(verdict === 'no'
          ? { message: '模型未能正确说出探测图片的颜色（不支持图片输入或为降级占位）' }
          : {}),
      },
    };
    return successResponse(c, payload);
  } catch (err) {
    if (
      err instanceof ProviderError &&
      isVisionCapabilityError({ statusCode: err.statusCode, message: err.message, details: err.details })
    ) {
      const updated = setModelVisionCapability(id, 'no', 'probe') ?? model;
      const payload: ProbeVisionResponse = {
        model: updated,
        probe: { method: 'chat', vision: 'no', source: 'probe', message: err.message },
      };
      return successResponse(c, payload);
    }
    throw new HttpError(502, `探测失败：${err instanceof Error ? err.message : String(err)}`);
  }
});

modelCapabilitiesApp.patch('/:id/capabilities', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ vision: 'yes' | 'no' | null }>();

  if (body.vision !== 'yes' && body.vision !== 'no' && body.vision !== null) {
    throw new HttpError(400, "vision must be 'yes', 'no' or null");
  }

  const updated =
    body.vision === null
      ? clearModelVisionCapability(id)
      : setModelVisionCapability(id, body.vision, 'manual');
  if (!updated) {
    throw new HttpError(404, 'Model not found');
  }
  return successResponse(c, updated);
});
