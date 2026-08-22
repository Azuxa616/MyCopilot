import { describe, it, expect } from 'vitest';
import { maskApiKey, isMaskedApiKey } from '../mask.js';

describe('maskApiKey', () => {
  it('masks long keys keeping first/last 4 chars', () => {
    expect(maskApiKey('sk-1234567890abcdef')).toBe('sk-1****cdef');
  });

  it('fully masks keys of 8 chars or fewer', () => {
    expect(maskApiKey('12345678')).toBe('****');
    expect(maskApiKey('short')).toBe('****');
    expect(maskApiKey('')).toBe('****');
  });
});

describe('isMaskedApiKey', () => {
  it('treats empty and ****-containing values as masked', () => {
    expect(isMaskedApiKey('')).toBe(true);
    expect(isMaskedApiKey('sk-1****cdef')).toBe(true);
  });

  it('treats real keys as not masked', () => {
    expect(isMaskedApiKey('sk-real-key-value')).toBe(false);
  });
});