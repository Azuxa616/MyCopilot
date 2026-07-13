export type ToolType = 'built-in' | 'mcp-provided';

export type SafetyLevel = 'safe' | 'restricted' | 'danger';

export type ToolSource = 'built-in' | 'mcp';

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
  safetyLevel: SafetyLevel;
  sourceMcpId: string | null;
  policyVersion: string;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface CreateToolParams {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  type: ToolType;
  safetyLevel: SafetyLevel;
  sourceMcpId?: string | null;
  enabled?: boolean;
}

export interface UpdateToolParams {
  name?: string;
  description?: string;
  inputSchema?: ToolInputSchema;
  type?: ToolType;
  safetyLevel?: SafetyLevel;
  sourceMcpId?: string | null;
  enabled?: boolean;
}

export interface ToolRef {
  id: string;
  name: string;
  source: ToolSource;
  sourceMcpId: string | null;
  policyVersion: string;
}

export type ToolApprovalState =
  | 'pending'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 'cancelled';

export interface ToolApproval {
  approvalId: string;
  runId: string;
  jobId: string | null;
  sessionId: string;
  agentId: string;
  tool: ToolRef;
  toolCallId: string;
  arguments: string;
  argumentsDigest: string;
  resourceScope: string;
  safetyLevel: SafetyLevel;
  policyVersion: string;
  state: ToolApprovalState;
  expiresAt: number;
  createdAt: number;
  updatedAt: number;
}
