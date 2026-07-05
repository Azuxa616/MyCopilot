import type { ProviderType, ProviderTestResult } from '@my-copilot/shared';

/** Hostnames explicitly blocked. */
const BLOCKED_HOSTS = new Set([
  '127.0.0.1', 'localhost', '0.0.0.0', '[::1]',
]);
/** IP prefixes blocked (private + link-local ranges). */
const BLOCKED_PREFIXES = [
  '192.168.', '10.', '172.16.', '172.17.', '172.18.', '172.19.',
  '172.20.', '172.21.', '172.22.', '172.23.', '172.24.', '172.25.',
  '172.26.', '172.27.', '172.28.', '172.29.', '172.30.', '172.31.',
  '169.254.', 'fc00:', 'fd00:',
];

function isBlockedUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const host = url.hostname.toLowerCase();
    if (BLOCKED_HOSTS.has(host)) return true;
    return BLOCKED_PREFIXES.some((p) => host.startsWith(p));
  } catch {
    return true; // unparseable URLs are blocked
  }
}

export async function testProvider(
  type: ProviderType,
  baseUrl: string,
  apiKey?: string,
): Promise<ProviderTestResult> {
  // Block internal / private network URLs (SSRF prevention)
  if (isBlockedUrl(baseUrl)) {
    return { success: false, errorClass: 'network', message: 'Internal URLs not allowed' };
  }

  const start = performance.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);

  try {
    const endpoint = type === 'openai' ? '/v1/models' : '/api/tags';
    const url = `${baseUrl.replace(/\/$/, '')}${endpoint}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
    };
    if (type === 'openai' && apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`;
    }

    const res = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const latencyMs = Math.round(performance.now() - start);

    if (res.ok) {
      return { success: true, latencyMs };
    }

    if (res.status === 401 || res.status === 403) {
      return { success: false, errorClass: 'auth', message: 'Invalid API key' };
    }

    if (res.status === 404) {
      return { success: false, errorClass: 'notfound', message: 'Invalid endpoint' };
    }

    return {
      success: false,
      errorClass: 'unknown',
      message: res.statusText || `HTTP ${res.status}`,
    };
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof Error && err.name === 'AbortError') {
      return { success: false, errorClass: 'network', message: 'Request timed out' };
    }

    if (err instanceof TypeError) {
      return { success: false, errorClass: 'network', message: 'Unreachable' };
    }

    return {
      success: false,
      errorClass: 'unknown',
      message: err instanceof Error ? err.message : String(err),
    };
  }
}
