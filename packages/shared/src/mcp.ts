export type McpTransport = 'stdio' | 'sse' | 'http';

export interface McpConfig {
  transport: McpTransport;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
}

export interface Mcp {
  id: string;
  name: string;
  description: string;
  config: McpConfig;
  enabled: boolean;
  lastConnectedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface CreateMcpParams {
  name: string;
  description: string;
  config: McpConfig;
  enabled?: boolean;
}

export interface UpdateMcpParams {
  name?: string;
  description?: string;
  config?: McpConfig;
  enabled?: boolean;
}
