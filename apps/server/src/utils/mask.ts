/**
 * Mask an API key for API responses: first 4 + `****` + last 4.
 * Keys of 8 chars or fewer are fully masked so nothing leaks.
 */
export function maskApiKey(key: string): string {
  if (key.length <= 8) return '****';
  return `${key.slice(0, 4)}****${key.slice(-4)}`;
}

/**
 * True when a submitted apiKey value is a masked round-trip (or empty)
 * and must therefore NOT overwrite the stored key on PATCH.
 * Real API keys never contain `****`.
 */
export function isMaskedApiKey(key: string): boolean {
  return key === '' || key.includes('****');
}