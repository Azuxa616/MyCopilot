import { describe, it, expect, vi, beforeEach } from 'vitest';
import { webSearchExecutor } from '../web-search.js';
import { clearRegisteredTools, registerTool } from '../../registry.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

const CTX = { sessionId: 'sess-1' };

describe('webSearchExecutor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearRegisteredTools();
    registerTool('web_search', webSearchExecutor);
    mockFetch.mockReset();
  });

  it('returns the correct Tool descriptor', () => {
    const tool = webSearchExecutor.describe();

    expect(tool).toMatchObject({
      id: 'builtin-web-search',
      name: 'web_search',
      description: expect.any(String),
      inputSchema: {
        fields: [
          { name: 'query', type: 'string', description: 'Search query', required: true },
          { name: 'num_results', type: 'number', description: 'Number of results (default 5, max 10)', required: false },
        ],
      },
      type: 'built-in',
      safetyLevel: 'safe',
      enabled: true,
    });
  });

  it('executes successful search and parses DuckDuckGo Lite HTML results', async () => {
    const mockHtml = `
      <html>
        <body>
          <a class="result-link" href="https://example.com">Example Title</a>
          <td class="result-snippet">A snippet of the result</td>
          <a class="result-link" href="https://another.com">Another Title</a>
          <td class="result-snippet">Another snippet here</td>
        </body>
      </html>
    `;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => mockHtml,
    });

    const result = await webSearchExecutor.execute({ query: 'test query', num_results: 2 }, CTX);

    expect(mockFetch).toHaveBeenCalledWith(
      'https://lite.duckduckgo.com/lite/?q=test%20query',
      {
        signal: undefined,
        headers: { 'User-Agent': 'MyCopilot/1.0' },
      },
    );

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    expect(result.content[0]!.type).toBe('text');

    const parsedResults = JSON.parse(result.content[0]!.text);
    expect(parsedResults).toEqual([
      { title: 'Example Title', url: 'https://example.com', snippet: 'A snippet of the result' },
      { title: 'Another Title', url: 'https://another.com', snippet: 'Another snippet here' },
    ]);
  });

  it('returns error for empty query', async () => {
    const result = await webSearchExecutor.execute({ query: '' }, CTX);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Missing required parameter: query');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('returns error when query parameter is missing', async () => {
    const result = await webSearchExecutor.execute({}, CTX);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Missing required parameter: query');
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('handles network errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network failure'));

    const result = await webSearchExecutor.execute({ query: 'test' }, CTX);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Search error: Network failure');
  });

  it('handles HTTP error responses', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    const result = await webSearchExecutor.execute({ query: 'test' }, CTX);

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toBe('Search failed with status 503');
  });

  it('returns "No results found" when HTML contains no results', async () => {
    const mockHtml = '<html><body>No results here</body></html>';

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => mockHtml,
    });

    const result = await webSearchExecutor.execute({ query: 'no results query' }, CTX);

    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toBe('No results found.');
  });

  it('respects MAX_RESULTS limit', async () => {
    const manyResultsHtml = Array.from({ length: 20 }, (_, i) => `
      <a class="result-link" href="https://example${i}.com">Title ${i}</a>
      <td class="result-snippet">Snippet ${i}</td>
    `).join('');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => manyResultsHtml,
    });

    const result = await webSearchExecutor.execute({ query: 'test', num_results: 15 }, CTX);

    const parsedResults = JSON.parse(result.content[0]!.text);
    expect(parsedResults).toHaveLength(10); // MAX_RESULTS
  });

  it('uses default of 5 results when num_results is not provided', async () => {
    const manyResultsHtml = Array.from({ length: 10 }, (_, i) => `
      <a class="result-link" href="https://example${i}.com">Title ${i}</a>
      <td class="result-snippet">Snippet ${i}</td>
    `).join('');

    mockFetch.mockResolvedValueOnce({
      ok: true,
      text: async () => manyResultsHtml,
    });

    const result = await webSearchExecutor.execute({ query: 'test' }, CTX);

    const parsedResults = JSON.parse(result.content[0]!.text);
    expect(parsedResults).toHaveLength(5); // default
  });

  it('respects abort signal', async () => {
    const abortController = new AbortController();
    abortController.abort();

    const result = await webSearchExecutor.execute(
      { query: 'test' },
      { ...CTX, signal: abortController.signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('Search error:');
  });
});