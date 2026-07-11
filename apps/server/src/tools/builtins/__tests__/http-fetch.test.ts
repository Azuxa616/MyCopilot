import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { httpFetchExecutor } from '../http-fetch.js';
import { clearRegisteredTools, registerTool } from '../../registry.js';

describe('http_fetch', () => {
  beforeEach(() => {
    clearRegisteredTools();
    registerTool('http_fetch', httpFetchExecutor);
  });

  afterEach(() => {
    clearRegisteredTools();
  });

  const mockContext = {
    sessionId: 'test-session',
  };

  it('should successfully fetch HTML and return stripped text', async () => {
    const chunks = [
      new TextEncoder().encode('<html><body><h1>Hello World</h1></body></html>'),
    ];
    let chunkIndex = 0;

    const mockResponse = {
      ok: true,
      status: 200,
      url: 'https://example.com',
      headers: {
        get: vi.fn((name: string) => (name === 'content-type' ? 'text/html' : null)),
      },
      body: {
        getReader: () => ({
          read: () => {
            if (chunkIndex < chunks.length) {
              return Promise.resolve({ done: false, value: chunks[chunkIndex++] });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
        }),
      },
    };

    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const result = await httpFetchExecutor.execute({ url: 'https://example.com' }, mockContext);

    expect(result.isError).toBeUndefined();
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe(200);
    expect(parsed.url).toBe('https://example.com');
    expect(parsed.truncated).toBe(false);
    expect(parsed.text).toBe('Hello World');
    expect(parsed.contentType).toBe('text/html');
  });

  it('should return error for 404 response', async () => {
    const mockResponse = {
      ok: false,
      status: 404,
      url: 'https://example.com/notfound',
    };

    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const result = await httpFetchExecutor.execute({ url: 'https://example.com/notfound' }, mockContext);

    expect(result.isError).toBe(true);
    expect(result.content).toHaveLength(1);
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe(404);
    expect(parsed.url).toBe('https://example.com/notfound');
    expect(parsed.error).toBe('HTTP 404');
  });

  it('should return error for non-http URL (file://)', async () => {
    const result = await httpFetchExecutor.execute({ url: 'file:///etc/passwd' }, mockContext);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Invalid URL: must be http:// or https://');
  });

  it('should block localhost URLs for SSRF protection', async () => {
    const result = await httpFetchExecutor.execute({ url: 'http://localhost:8080' }, mockContext);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('URL blocked: localhost/private IP addresses not allowed');
  });

  it('should block private IP addresses for SSRF protection', async () => {
    const result = await httpFetchExecutor.execute({ url: 'http://192.168.1.1' }, mockContext);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('URL blocked: localhost/private IP addresses not allowed');
  });

  it('should truncate large responses to 50KB', async () => {
    const longText = 'a'.repeat(60 * 1024); // 60KB
    const chunks = [new TextEncoder().encode(longText)];
    let chunkIndex = 0;

    const mockResponse = {
      ok: true,
      status: 200,
      url: 'https://example.com',
      headers: {
        get: vi.fn((name: string) => (name === 'content-type' ? 'text/plain' : null)),
      },
      body: {
        getReader: () => ({
          read: () => {
            if (chunkIndex < chunks.length) {
              return Promise.resolve({ done: false, value: chunks[chunkIndex++] });
            }
            return Promise.resolve({ done: true, value: undefined });
          },
        }),
      },
    };

    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const result = await httpFetchExecutor.execute({ url: 'https://example.com' }, mockContext);

    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.truncated).toBe(true);
    expect(parsed.text.length).toBe(50 * 1024); // 50KB
  });

  it('should return error for timeout', async () => {
    const mockAbortError = new DOMException('The operation was aborted', 'AbortError');
    globalThis.fetch = vi.fn().mockRejectedValue(mockAbortError);

    const result = await httpFetchExecutor.execute({ url: 'https://example.com' }, mockContext);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Request timed out or was cancelled');
  });

  it('should return error for missing url parameter', async () => {
    const result = await httpFetchExecutor.execute({}, mockContext);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Missing required parameter: url');
  });

  it('should only support GET, HEAD, and OPTIONS methods', async () => {
    const result = await httpFetchExecutor.execute({ url: 'https://example.com', method: 'POST' }, mockContext);

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBe('Only GET, HEAD, and OPTIONS methods are supported');
  });
});