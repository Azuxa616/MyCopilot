import type {
  AgentToolBinding,
  AgentToolSafetyOverride,
  SafetyLevel,
} from '@my-copilot/shared';
import { getDb } from '../db/index.js';

const STRICTNESS: Record<SafetyLevel, number> = {
  safe: 0,
  restricted: 1,
  danger: 2,
};

export function assertValidOverride(
  toolDefault: SafetyLevel,
  override: AgentToolSafetyOverride,
): void {
  if (override === 'inherit') return;
  if (STRICTNESS[override] < STRICTNESS[toolDefault]) {
    throw new Error(
      `Cannot override tool safety level from '${toolDefault}' to '${override}'`,
    );
  }
}

export function getAgentToolSafetyOverride(
  agentId: string,
  toolId: string,
): AgentToolSafetyOverride {
  const row = getDb()
    .prepare('SELECT safety_level FROM agent_tools WHERE agent_id = ? AND tool_id = ?')
    .get(agentId, toolId) as { safety_level: AgentToolSafetyOverride } | undefined;
  return row?.safety_level ?? 'inherit';
}

export function setAgentToolBinding(
  binding: AgentToolBinding,
  toolDefault: SafetyLevel,
): void {
  assertValidOverride(toolDefault, binding.safetyLevel);
  getDb()
    .prepare(
      `INSERT INTO agent_tools (agent_id, tool_id, safety_level)
       VALUES (?, ?, ?)
       ON CONFLICT(agent_id, tool_id)
       DO UPDATE SET safety_level = excluded.safety_level`,
    )
    .run(binding.agentId, binding.toolId, binding.safetyLevel);
}

export function assertExistingOverridesValid(
  toolId: string,
  toolDefault: SafetyLevel,
): void {
  const rows = getDb()
    .prepare('SELECT safety_level FROM agent_tools WHERE tool_id = ?')
    .all(toolId) as Array<{ safety_level: AgentToolSafetyOverride }>;
  for (const row of rows) assertValidOverride(toolDefault, row.safety_level);
}
