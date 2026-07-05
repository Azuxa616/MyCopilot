export interface AgentConfig {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  modelId: string | null;
  parameters: AgentConfig;
  skillIds: string[];
  toolIds: string[];
  mcpIds: string[];
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}
