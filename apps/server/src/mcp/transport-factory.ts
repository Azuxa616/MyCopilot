import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpConfig } from '@my-copilot/shared';

/**
 * Creates an MCP transport from a config.
 *
 * T7 scope: only `stdio` is supported. `sse` and `http` are deferred to later tasks.
 *
 * The stdio transport spawns a subprocess and talks to it over stdin/stdout.
 * stderr inherits to the parent process by default so server-side error logs remain visible.
 */
export function createTransport(config: McpConfig): StdioClientTransport {
  if (config.transport === 'stdio') {
    if (!config.command) {
      throw new Error('stdio transport requires config.command');
    }
    return new StdioClientTransport({
      command: config.command,
      args: config.args ?? [],
      env: config.env ?? {},
    });
  }
  throw new Error(`Unsupported MCP transport: ${config.transport}`);
}
