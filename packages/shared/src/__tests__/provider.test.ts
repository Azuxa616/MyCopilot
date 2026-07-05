import { describe, it, expect } from 'vitest';
import type {
  ProviderType,
  Provider,
  Model,
  ProviderTestResult,
  CreateProviderParams,
  UpdateProviderParams,
  CreateModelParams,
  UpdateModelParams,
} from '../provider.js';

describe('Provider types', () => {
  it('ProviderType should be openai or ollama', () => {
    const openai: ProviderType = 'openai';
    const ollama: ProviderType = 'ollama';
    expect(openai).toBe('openai');
    expect(ollama).toBe('ollama');
  });

  it('should create a valid Provider object', () => {
    const provider: Provider = {
      id: 'provider-1',
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-...',
      enabled: true,
      createdAt: 1000,
      updatedAt: 1000,
    };
    expect(provider.name).toBe('OpenAI');
    expect(provider.type).toBe('openai');
  });

  it('should create a valid Model object', () => {
    const model: Model = {
      id: 'model-1',
      providerId: 'provider-1',
      name: 'gpt-4',
      displayName: 'GPT-4',
      enabled: true,
      createdAt: 1000,
      updatedAt: 1000,
    };
    expect(model.name).toBe('gpt-4');
  });

  it('should create valid ProviderTestResult for success', () => {
    const result: ProviderTestResult = {
      success: true,
      latencyMs: 100,
    };
    expect(result.success).toBe(true);
  });

  it('should create valid ProviderTestResult for failure', () => {
    const result: ProviderTestResult = {
      success: false,
      errorClass: 'auth',
      message: 'Invalid API key',
    };
    expect(result.success).toBe(false);
    expect(result.errorClass).toBe('auth');
  });

  it('should create valid CreateProviderParams', () => {
    const params: CreateProviderParams = {
      name: 'OpenAI',
      type: 'openai',
      baseUrl: 'https://api.openai.com',
      apiKey: 'sk-...',
    };
    expect(params.name).toBe('OpenAI');
  });

  it('should create valid UpdateProviderParams', () => {
    const params: UpdateProviderParams = {
      name: 'Updated OpenAI',
    };
    expect(params.name).toBe('Updated OpenAI');
  });

  it('should create valid CreateModelParams', () => {
    const params: CreateModelParams = {
      providerId: 'provider-1',
      name: 'gpt-4',
    };
    expect(params.name).toBe('gpt-4');
  });

  it('should create valid UpdateModelParams', () => {
    const params: UpdateModelParams = {
      name: 'gpt-4-turbo',
    };
    expect(params.name).toBe('gpt-4-turbo');
  });
});
