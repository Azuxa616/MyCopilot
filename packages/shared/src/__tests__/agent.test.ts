import { describe, it, expect } from 'vitest';
import type { Agent, AgentConfig } from '../agent.js';

describe('Agent types', () => {
  it('should create a valid AgentConfig', () => {
    const config: AgentConfig = {
      temperature: 0.7,
      maxTokens: 2048,
      topP: 1,
    };
    expect(config.temperature).toBe(0.7);
    expect(config.maxTokens).toBe(2048);
  });

  it('should create a valid Agent object', () => {
    const agent: Agent = {
      id: 'agent-1',
      name: 'Assistant',
      description: 'A helpful assistant',
      systemPrompt: 'You are helpful',
      modelId: null,
      parameters: {},
      skillIds: [],
      toolIds: [],
      mcpIds: [],
      enabled: true,
      createdAt: 1000,
      updatedAt: 1000,
    };
    expect(agent.name).toBe('Assistant');
    expect(agent.parameters).toEqual({});
  });
});
