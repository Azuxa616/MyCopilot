export { ProviderError, type ChatMessage, type AdapterConfig, type AdapterStreamOptions, type ProviderAdapter } from './base.js';
export { OpenAIAdapter } from './openai.js';
export { OllamaAdapter } from './ollama.js';
import type { ProviderAdapter } from './base.js';
import type { ProviderType } from '@my-copilot/shared';
import { OpenAIAdapter } from './openai.js';
import { OllamaAdapter } from './ollama.js';

/**
 * Factory to get the appropriate adapter for a provider type.
 *
 * @param type - The provider type ('openai' or 'ollama')
 * @returns The adapter instance for the given provider type
 * @throws Error if the provider type is not supported
 */
export function getAdapter(type: ProviderType): ProviderAdapter {
  switch (type) {
    case 'openai':
      return new OpenAIAdapter();
    case 'ollama':
      return new OllamaAdapter();
  }
}
