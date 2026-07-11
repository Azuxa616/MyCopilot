export type ToolType = 'built-in' | 'mcp-provided';

export type DangerLevel = 'low' | 'medium' | 'high';

export interface ToolInputSchemaField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
}

export interface ToolInputSchema {
  fields: ToolInputSchemaField[];
}

export interface Tool {
  id: string;
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  type: ToolType;
  dangerLevel: DangerLevel;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateToolParams {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  type: ToolType;
  dangerLevel: DangerLevel;
  enabled?: boolean;
}

export interface UpdateToolParams {
  name?: string;
  description?: string;
  inputSchema?: ToolInputSchema;
  type?: ToolType;
  dangerLevel?: DangerLevel;
  enabled?: boolean;
}
