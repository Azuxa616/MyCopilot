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
  createdAt: number;
  updatedAt: number;
}
