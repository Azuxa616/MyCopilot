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
  /** 非空表示该 MCP 由插件贡献（值为插件 id），其增删改由插件生命周期管理。 */
  sourcePluginId?: string;
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

export interface TestMcpConfigParams {
  config: McpConfig;
}

export interface TestMcpConfigResult {
  success: boolean;
  tools?: string[];
  error?: string;
}
