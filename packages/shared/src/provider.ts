import type { ModelCapabilities } from './capability.js';

export type ProviderType = 'openai' | 'ollama';

export interface Provider {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Model {
  id: string;
  providerId: string;
  name: string;
  displayName?: string;
  enabled: boolean;
  /** 三态能力标记（图片输入等）。缺省 = 全 unknown（存量数据零迁移）。 */
  capabilities?: ModelCapabilities;
  createdAt: number;
  updatedAt: number;
}

export interface ProviderTestResult {
  success: boolean;
  errorClass?: 'network' | 'auth' | 'notfound' | 'unknown';
  message?: string;
  latencyMs?: number;
}

export interface CreateProviderParams {
  name: string;
  type: ProviderType;
  baseUrl: string;
  apiKey: string;
  enabled?: boolean;
}

export interface UpdateProviderParams {
  name?: string;
  type?: ProviderType;
  baseUrl?: string;
  apiKey?: string;
  enabled?: boolean;
}

export interface CreateModelParams {
  providerId: string;
  name: string;
  displayName?: string;
  enabled?: boolean;
}

export interface UpdateModelParams {
  name?: string;
  displayName?: string;
  enabled?: boolean;
}
