import type {
  SafetyLevel,
  ToolApproval,
  ToolApprovalState,
  ToolRef,
} from '@my-copilot/shared';
import { getDb } from '../db/index.js';
import { generateId, now } from './base.js';

interface ToolApprovalRow {
  approval_id: string;
  run_id: string;
  job_id: string | null;
  session_id: string;
  agent_id: string;
  tool_id: string;
  tool_name: string;
  tool_source: ToolRef['source'];
  source_mcp_id: string | null;
  tool_call_id: string;
  arguments: string;
  arguments_digest: string;
  resource_scope: string;
  safety_level: SafetyLevel;
  policy_version: string;
  state: ToolApprovalState;
  expires_at: number;
  created_at: number;
  updated_at: number;
}

function rowToApproval(row: ToolApprovalRow): ToolApproval {
  return {
    approvalId: row.approval_id,
    runId: row.run_id,
    jobId: row.job_id,
    sessionId: row.session_id,
    agentId: row.agent_id,
    tool: {
      id: row.tool_id,
      name: row.tool_name,
      source: row.tool_source,
      sourceMcpId: row.source_mcp_id,
      policyVersion: row.policy_version,
    },
    toolCallId: row.tool_call_id,
    arguments: row.arguments,
    argumentsDigest: row.arguments_digest,
    resourceScope: row.resource_scope,
    safetyLevel: row.safety_level,
    policyVersion: row.policy_version,
    state: row.state,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function createToolApproval(params: Omit<
  ToolApproval,
  'approvalId' | 'state' | 'createdAt' | 'updatedAt'
>): ToolApproval {
  const approvalId = generateId();
  const timestamp = now();
  getDb()
    .prepare(
      `INSERT INTO tool_approvals (
        approval_id, run_id, job_id, session_id, agent_id, tool_id, tool_name,
        tool_source, source_mcp_id, tool_call_id, arguments, arguments_digest,
        resource_scope, safety_level, policy_version, state, expires_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
    )
    .run(
      approvalId,
      params.runId,
      params.jobId,
      params.sessionId,
      params.agentId,
      params.tool.id,
      params.tool.name,
      params.tool.source,
      params.tool.sourceMcpId,
      params.toolCallId,
      params.arguments,
      params.argumentsDigest,
      params.resourceScope,
      params.safetyLevel,
      params.policyVersion,
      params.expiresAt,
      timestamp,
      timestamp,
    );
  return {
    ...params,
    approvalId,
    state: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function getToolApproval(approvalId: string): ToolApproval | undefined {
  const row = getDb()
    .prepare('SELECT * FROM tool_approvals WHERE approval_id = ?')
    .get(approvalId) as ToolApprovalRow | undefined;
  return row ? rowToApproval(row) : undefined;
}

export function settleToolApproval(
  approvalId: string,
  state: Exclude<ToolApprovalState, 'pending'>,
): ToolApproval | undefined {
  const row = getDb()
    .prepare(
      `UPDATE tool_approvals
       SET state = ?, updated_at = ?
       WHERE approval_id = ? AND state = 'pending'
       RETURNING *`,
    )
    .get(state, now(), approvalId) as ToolApprovalRow | undefined;
  return row ? rowToApproval(row) : undefined;
}

export function expirePendingToolApprovals(): number {
  const timestamp = now();
  return getDb()
    .prepare(
      `UPDATE tool_approvals SET state = 'expired', updated_at = ?
       WHERE state = 'pending' AND expires_at <= ?`,
    )
    .run(timestamp, timestamp).changes;
}

export function cancelSessionToolApprovals(sessionId: string): number {
  return getDb()
    .prepare(
      `UPDATE tool_approvals SET state = 'cancelled', updated_at = ?
       WHERE session_id = ? AND state = 'pending'`,
    )
    .run(now(), sessionId).changes;
}
