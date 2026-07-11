import type { Tool } from '@my-copilot/shared';
import type { ToolExecutor, ToolExecutionResult, ToolExecutionContext } from '../registry.js';

const MAX_RESULTS = 10;

export const webSearchExecutor: ToolExecutor = {
  describe(): Tool {
    return {
      id: 'builtin-web-search',
      name: 'web_search',
      description: 'Search the web for current information. Use when the user asks about recent events, current data, or information that may be beyond your training cutoff.',
      inputSchema: {
        fields: [
          { name: 'query', type: 'string', description: 'Search query', required: true },
          { name: 'num_results', type: 'number', description: 'Number of results (default 5, max 10)', required: false },
        ],
      },
      type: 'built-in',
      dangerLevel: 'low',
      enabled: true,
      createdAt: 0,
      updatedAt: 0,
    };
  },

  async execute(args: Record<string, unknown>, context: ToolExecutionContext): Promise<ToolExecutionResult> {
    const query = String(args.query ?? '').trim();
    if (!query) {
      return { content: [{ type: 'text', text: 'Missing required parameter: query' }], isError: true };
    }

    const numResults = Math.min(Math.max(Number(args.num_results ?? 5), 1), MAX_RESULTS);

    try {
      const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;
      const response = await fetch(url, {
        signal: context.signal,
        headers: { 'User-Agent': 'MyCopilot/1.0' },
      });

      if (!response.ok) {
        return { content: [{ type: 'text', text: `Search failed with status ${response.status}` }], isError: true };
      }

      const html = await response.text();

      // Parse DuckDuckGo Lite HTML results
      const results: Array<{ title: string; url: string; snippet: string }> = [];
      // DuckDuckGo Lite uses <a class="result-link" href="..."> for links
      // and <td class="result-snippet"> for snippets
      // Simple regex-based parsing (no DOM parser needed)
      const linkRegex = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([^<]+)<\/a>/g;
      const snippetRegex = /<td[^>]+class="result-snippet"[^>]*>([\s\S]*?)<\/td>/g;

      const links: Array<{ url: string; title: string }> = [];
      let match;
      while ((match = linkRegex.exec(html)) !== null && links.length < numResults) {
        links.push({ url: match[1], title: match[2] });
      }

      const snippets: string[] = [];
      while ((match = snippetRegex.exec(html)) !== null && snippets.length < numResults) {
        // Strip HTML tags from snippet
        snippets.push(match[1].replace(/<[^>]+>/g, '').trim());
      }

      for (let i = 0; i < Math.min(links.length, numResults); i++) {
        results.push({
          title: links[i].title.trim(),
          url: links[i].url,
          snippet: snippets[i] || '',
        });
      }

      if (results.length === 0) {
        return { content: [{ type: 'text', text: 'No results found.' }] };
      }

      return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { content: [{ type: 'text', text: `Search error: ${message}` }], isError: true };
    }
  },
};

import { registerTool } from '../registry.js';

/** Convenience function to register web_search with the tool registry. */
export function registerWebSearch(): void {
  registerTool('web_search', webSearchExecutor);
}