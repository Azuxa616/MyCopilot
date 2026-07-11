import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import type { McpConfig, Tool } from '@my-copilot/shared';
import { createTransport } from './transport-factory.js';
import { jsonSchemaToToolInputSchema } from '../utils/schema-adapter.js';

/**
 * MCP connection manager (module-level singleton).
 *
 * Design decisions (T7 scope):
 * - Lazy spawn: connections are only created on demand, never proactively.
 * - No health-check timer/cron (YAGNI); broken connections are rebuilt on next use.
 * - No proactive reconnection; `ensureConnected` rebuilds if the cached client is not healthy.
 * - `callTool` enforces a timeout via AbortController wired into the SDK's RequestOptions.
 * - State lives in a module-scoped Map — flat functional module style, no classes.
 */

export type McpConnectionHealth = 'healthy' | 'disconnected' | 'connecting';

export interface McpConnection {
  client: Client;
  mcpId: string;
  config: McpConfig;
  health: McpConnectionHealth;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Module-scoped connection pool. Keyed by mcpId. */
const connections = new Map<string, McpConnection>();

/**
 * Ensures a healthy client exists for `mcpId`, creating or rebuilding one if necessary.
 * Returns the cached client when the connection is already healthy.
 */
export async function ensureConnected(
  mcpId: string,
  config: McpConfig,
): Promise<Client> {
  const existing = connections.get(mcpId);
  if (existing && existing.health === 'healthy') {
    return existing.client;
  }

  // Tear down any broken/stale connection before rebuilding.
  if (existing) {
    await safeClose(existing.client);
    connections.delete(mcpId);
  }

  const transport = createTransport(config);
  const client = new Client({
    name: `my-copilot-${mcpId}`,
    version: '1.0.0',
  });

  connections.set(mcpId, {
    client,
    mcpId,
    config,
    health: 'connecting',
  });

  try {
    await client.connect(transport);
    const conn = connections.get(mcpId);
    if (conn) conn.health = 'healthy';
    return client;
  } catch (err) {
    const conn = connections.get(mcpId);
    if (conn) conn.health = 'disconnected';
    throw err;
  }
}

/**
 * Lists tools exposed by an MCP server, converting each to the internal `Tool` shape.
 * MCP-provided tools are NOT persisted to the DB tools table; they're transient.
 */
export async function listTools(
  mcpId: string,
  config: McpConfig,
): Promise<Tool[]> {
  const client = await ensureConnected(mcpId, config);
  const result = await client.listTools();
  const now = Date.now();

  return result.tools.map((tool): Tool => ({
    id: `mcp-${mcpId}-${tool.name}`,
    name: tool.name,
    description: tool.description ?? '',
    inputSchema: jsonSchemaToToolInputSchema(
      tool.inputSchema as Record<string, unknown>,
    ),
    type: 'mcp-provided',
    dangerLevel: 'low',
    enabled: true,
    createdAt: now,
    updatedAt: now,
  }));
}

/**
 * Calls a tool on an MCP server with a timeout.
 *
 * The timeout is enforced via AbortController and wired into the SDK's RequestOptions.signal,
 * which properly cancels the in-flight request rather than just racing a rejection.
 */
export async function callTool(
  mcpId: string,
  config: McpConfig,
  toolName: string,
  args: Record<string, unknown>,
  signal?: AbortSignal,
  timeoutMs?: number,
): Promise<unknown> {
  const client = await ensureConnected(mcpId, config);
  const timeout = timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  // If the caller supplied an external signal, forward its abort to our controller.
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      controller.abort();
    } else {
      signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }

  try {
    return await client.callTool(
      { name: toolName, arguments: args },
      undefined,
      { signal: controller.signal },
    );
  } catch (err) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new Error(`MCP tool call timed out after ${timeout}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Closes and forgets a single connection. No-op if none exists. */
export async function disconnect(mcpId: string): Promise<void> {
  const conn = connections.get(mcpId);
  if (!conn) return;
  await safeClose(conn.client);
  connections.delete(mcpId);
}

/** Closes every active connection. Intended for graceful shutdown. */
export async function disconnectAll(): Promise<void> {
  const ids = Array.from(connections.keys());
  await Promise.all(
    ids.map(async (id) => {
      try {
        await disconnect(id);
      } catch {
        // best-effort
      }
    }),
  );
  connections.clear();
}

/**
 * Merges tools from multiple MCPs. Failures are swallowed per-MCP so one broken
 * server doesn't hide tools from the others.
 */
export async function listAllTools(
  configs: Array<{ id: string; config: McpConfig }>,
): Promise<Tool[]> {
  const results = await Promise.all(
    configs.map(async ({ id, config }) => {
      try {
        return await listTools(id, config);
      } catch {
        return [];
      }
    }),
  );
  return results.flat();
}

/** Returns the live connection record for `mcpId`, if any (for diagnostics/health). */
export function getConnection(mcpId: string): McpConnection | undefined {
  return connections.get(mcpId);
}

/** Test-only escape hatch: clears the pool without invoking close(). */
export function __clearConnectionsForTests(): void {
  connections.clear();
}

async function safeClose(client: Client): Promise<void> {
  try {
    await client.close();
  } catch {
    // best-effort — the subprocess may already be gone
  }
}
