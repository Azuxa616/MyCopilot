import { Hono } from 'hono';
import {
  listProviders,
  getProvider,
  createProvider,
  updateProvider,
  deleteProvider,
} from '../repo/provider.js';
import { testProvider } from '../llm/tester.js';
import { successResponse } from '../utils/response.js';
import { maskApiKey, isMaskedApiKey } from '../utils/mask.js';
import { HttpError } from '../middleware/error.js';
import type { CreateProviderParams, Provider } from '@my-copilot/shared';

export const providersApp = new Hono();

function maskProvider(provider: Provider): Provider {
  return { ...provider, apiKey: maskApiKey(provider.apiKey) };
}

providersApp.get('/', (c) => {
  const data = listProviders();
  return successResponse(c, data.map(maskProvider));
});

providersApp.post('/', async (c) => {
  const body = await c.req.json<CreateProviderParams>();

  if (!body.name || !body.type || !body.baseUrl) {
    throw new HttpError(400, 'Missing required fields: name, type, baseUrl');
  }
  if (body.name.length > 100) {
    throw new HttpError(400, 'Name must be 100 characters or less');
  }
  if (body.baseUrl.length > 500) {
    throw new HttpError(400, 'Base URL must be 500 characters or less');
  }

  const data = createProvider(body);
  return successResponse(c, maskProvider(data), 201);
});

providersApp.get('/:id', (c) => {
  const id = c.req.param('id');
  const data = getProvider(id);
  if (!data) {
    throw new HttpError(404, 'Provider not found');
  }
  return successResponse(c, maskProvider(data));
});

providersApp.patch('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json();
  // Masked/empty apiKey round-trip → keep the stored key
  if (typeof body.apiKey === 'string' && isMaskedApiKey(body.apiKey)) {
    delete body.apiKey;
  }
  const data = updateProvider(id, body);
  if (!data) {
    throw new HttpError(404, 'Provider not found');
  }
  return successResponse(c, maskProvider(data));
});

providersApp.delete('/:id', (c) => {
  const id = c.req.param('id');
  const deleted = deleteProvider(id);
  if (!deleted) {
    throw new HttpError(404, 'Provider not found');
  }
  return successResponse(c, { deleted });
});

providersApp.post('/:id/test', async (c) => {
  const id = c.req.param('id');
  const provider = getProvider(id);
  if (!provider) {
    throw new HttpError(404, 'Provider not found');
  }

  const result = await testProvider(provider.type, provider.baseUrl, provider.apiKey);
  return successResponse(c, result);
});
