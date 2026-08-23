import type { Mcp } from '@my-copilot/shared';
import { listEnabledMcps } from '../repo/mcp.js';
import {
  disableToolsByMcp,
  syncMcpTools,
  type McpToolSyncResult,
} from '../repo/tool.js';
import { listTools } from './manager.js';

export async function synchronizeMcpTools(mcp: Mcp): Promise<McpToolSyncResult> {
  const tools = await listTools(mcp.id, mcp.config);
  return syncMcpTools(mcp.id, tools);
}

export async function trySynchronizeMcpTools(mcp: Mcp): Promise<McpToolSyncResult | null> {
  if (!mcp.enabled) {
    disableToolsByMcp(mcp.id);
    return null;
  }
  try {
    return await synchronizeMcpTools(mcp);
  } catch (error) {
    console.warn(
      `[mcp] Tool sync failed for ${mcp.id}:`,
      error instanceof Error ? error.message : String(error),
    );
    return null;
  }
}

export async function synchronizeAllEnabledMcps(): Promise<{
  synchronized: number;
  failed: number;
}> {
  const results = await Promise.all(
    listEnabledMcps().map((mcp) => trySynchronizeMcpTools(mcp)),
  );
  return {
    synchronized: results.filter((result) => result !== null).length,
    failed: results.filter((result) => result === null).length,
  };
}
