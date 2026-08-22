// apps/server/src/demo/seed.ts
import { listProviders, createProvider } from '../repo/provider.js';
import { createModel } from '../repo/model.js';

export interface DemoSeedResult {
  seeded: boolean;
}

/**
 * Seed the demo instance with one provider + model from env vars.
 * Idempotent: skipped entirely when any provider already exists.
 * Called at startup when DEMO_MODE=1 (spec §5).
 */
export function seedDemoData(): DemoSeedResult {
  if (listProviders().length > 0) {
    return { seeded: false };
  }

  const baseUrl = process.env.DEMO_PROVIDER_BASE_URL;
  const apiKey = process.env.DEMO_PROVIDER_API_KEY;
  const modelName = process.env.DEMO_PROVIDER_MODEL;
  if (!baseUrl || !apiKey || !modelName) {
    throw new Error(
      'DEMO_MODE=1 with an empty providers table requires DEMO_PROVIDER_BASE_URL, DEMO_PROVIDER_API_KEY and DEMO_PROVIDER_MODEL',
    );
  }

  const provider = createProvider({
    name: process.env.DEMO_PROVIDER_NAME || 'Demo Provider',
    type: 'openai',
    baseUrl,
    apiKey,
    enabled: true,
  });
  createModel(provider.id, {
    name: modelName,
    displayName: modelName,
    enabled: true,
  });

  return { seeded: true };
}
