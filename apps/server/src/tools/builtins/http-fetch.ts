import type { Tool } from '@my-copilot/shared';
import type { ToolExecutor, ToolExecutionResult, ToolExecutionContext } from '../registry.js';

const FETCH_TIMEOUT_MS = 30_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB
const MAX_TEXT_LENGTH = 50 * 1024; // 50KB

export const httpFetchExecutor: ToolExecutor = {
  describe(): Tool {
    return {
      id: 'builtin-http-fetch',
      name: 'http_fetch',
      description: 'Fetch content from a URL. Use to retrieve specific web pages or API responses. Returns page content as text.',
      inputSchema: {
        fields: [
          { name: 'url', type: 'string', description: 'HTTP(S) URL to fetch', required: true },
          { name: 'method', type: 'string', description: 'HTTP method (default: GET)', required: false },
        ],
      },
      type: 'built-in',
      dangerLevel: 'medium',
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
    };
  },

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const url = String(args.url ?? '').trim();
    if (!url) {
      return { content: [{ type: 'text', text: 'Missing required parameter: url' }], isError: true };
    }

    // Validate URL scheme
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return { content: [{ type: 'text', text: 'Invalid URL: must be http:// or https://' }], isError: true };
    }

    // SSRF protection: reject localhost and private IPs
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname;
      if (
        hostname === 'localhost' ||
        hostname === '127.0.0.1' ||
        hostname === '0.0.0.0' ||
        hostname === '::1' ||
        hostname.startsWith('192.168.') ||
        hostname.startsWith('10.') ||
        hostname.startsWith('172.') // 172.16-31 range simplified
      ) {
        return { content: [{ type: 'text', text: 'URL blocked: localhost/private IP addresses not allowed' }], isError: true };
      }
    } catch {
      return { content: [{ type: 'text', text: 'Invalid URL format' }], isError: true };
    }

    const method = String(args.method ?? 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      return { content: [{ type: 'text', text: 'Only GET, HEAD, and OPTIONS methods are supported' }], isError: true };
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

      // Combine context signal with timeout
      if (context.signal?.aborted) {
        clearTimeout(timeout);
        return { content: [{ type: 'text', text: 'Request cancelled' }], isError: true };
      }
      context.signal?.addEventListener('abort', () => controller.abort(), { once: true });

      const response = await fetch(url, {
        method,
        signal: controller.signal,
        headers: { 'User-Agent': 'MyCopilot/1.0' },
      });
      clearTimeout(timeout);

      const status = response.status;
      const finalUrl = response.url || url;

      if (!response.ok) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ status, url: finalUrl, error: `HTTP ${status}` }) }],
          isError: true,
        };
      }

      // Check content-length before reading
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > MAX_RESPONSE_BYTES) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ status, url: finalUrl, error: 'Response too large (exceeds 5MB)' }) }],
          isError: true,
        };
      }

      // Read with size limit
      const reader = response.body?.getReader();
      if (!reader) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ status, url: finalUrl, error: 'No response body' }) }],
          isError: true,
        };
      }

      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.length;
        if (totalBytes > MAX_RESPONSE_BYTES) {
          reader.cancel();
          return {
            content: [{ type: 'text', text: JSON.stringify({ status, url: finalUrl, error: 'Response too large (exceeds 5MB)' }) }],
            isError: true,
          };
        }
        chunks.push(value);
      }

      const raw = new TextDecoder().decode(Buffer.concat ? Buffer.concat(chunks) : concatenate(chunks));
      const contentType = response.headers.get('content-type') ?? '';

      // Convert to text (strip HTML if needed)
      let text = raw;
      if (contentType.includes('text/html') || contentType.includes('application/xhtml')) {
        text = stripHtml(raw);
      }

      const truncated = text.length > MAX_TEXT_LENGTH;
      if (truncated) {
        text = text.slice(0, MAX_TEXT_LENGTH);
      }

      return {
        content: [{ type: 'text', text: JSON.stringify({ status, url: finalUrl, truncated, contentType, text }) }],
      };
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return { content: [{ type: 'text', text: 'Request timed out or was cancelled' }], isError: true };
      }
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Fetch error: ${message}` }], isError: true };
    }
  },
};

function stripHtml(html: string): string {
  // Remove script and style blocks
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  // Remove all tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode common entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  // Collapse whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function concatenate(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

import { registerTool } from '../registry.js';

export function registerHttpFetch(): void {
  registerTool('http_fetch', httpFetchExecutor);
}