import { describe, it, expect } from 'vitest';
import { ProviderError } from '../base.js';
import { getAdapter } from '../index.js';
import { OpenAIAdapter } from '../openai.js';
import { OllamaAdapter } from '../ollama.js';

describe('ProviderError', () => {
  it('should store message, statusCode, and details', () => {
    const details = { type: 'auth_error', retryAfter: 30 };
    const error = new ProviderError('Auth failed', 401, details);

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.name).toBe('ProviderError');
    expect(error.message).toBe('Auth failed');
    expect(error.statusCode).toBe(401);
    expect(error.details).toBe(details);
  });

  it('should work without details', () => {
    const error = new ProviderError('Unknown error', 502);

    expect(error.message).toBe('Unknown error');
    expect(error.statusCode).toBe(502);
    expect(error.details).toBeUndefined();
  });
});

describe('getAdapter', () => {
  it("returns OpenAIAdapter for 'openai'", () => {
    const adapter = getAdapter('openai');
    expect(adapter).toBeInstanceOf(OpenAIAdapter);
    expect(adapter.type).toBe('openai');
  });

  it("returns OllamaAdapter for 'ollama'", () => {
    const adapter = getAdapter('ollama');
    expect(adapter).toBeInstanceOf(OllamaAdapter);
    expect(adapter.type).toBe('ollama');
  });
});
