// apps/server/src/demo/tools.ts
import type { Tool } from '@my-copilot/shared';

/**
 * Built-in tool names allowed in DEMO_MODE. Whitelist (not blacklist) on
 * purpose: new built-ins must be consciously reviewed before demo exposure.
 * Network-capable tools (http_fetch, web_search) are excluded — SSRF surface.
 * Spec: docs/superpowers/specs/2026-08-22-demo-deployment-design.md §4
 */
export const DEMO_ALLOWED_TOOLS: ReadonlySet<string> = new Set([
  'current_datetime',
  'calculator',
  'generate_uuid',
  'hash_text',
  'base64_encode',
  'base64_decode',
  'json_format',
]);

/** True when the server runs in DEMO_MODE. */
export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === '1';
}

/**
 * Filter a tool list down to what a demo instance may advertise to the LLM.
 * No-op outside DEMO_MODE; in demo mode keeps whitelisted built-ins only
 * (MCP-provided tools are always dropped).
 */
export function filterDemoTools(tools: Tool[]): Tool[] {
  if (!isDemoMode()) return tools;
  return tools.filter(
    (tool) => tool.type === 'built-in' && DEMO_ALLOWED_TOOLS.has(tool.name),
  );
}
