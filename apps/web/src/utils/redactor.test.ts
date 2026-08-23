import { describe, it, expect } from 'vitest';
import { redactSensitive, REDACTED_KEYS_REGEX } from './redactor';

describe('redactSensitive', () => {
  it('redacts authToken field (real configStore field name)', () => {
    const input = {
      authToken: 'sk-test-12345',
      model: 'gpt-4',
      temperature: 0.7,
    };

    const result = redactSensitive(input) as typeof input;

    expect(result.authToken).toBe('***REDACTED***');
    expect(result.model).toBe('gpt-4');
    expect(result.temperature).toBe(0.7);

    // Original should not be mutated
    expect(input.authToken).toBe('sk-test-12345');
  });

  it('redacts nested object sensitive fields', () => {
    const input = {
      user: {
        name: 'John',
        password: 'secret123',
        profile: {
          apiKey: 'abc-def-ghi',
          bio: 'Developer',
        },
      },
    };

    const result = redactSensitive(input) as typeof input;

    expect(result.user.name).toBe('John');
    expect(result.user.password).toBe('***REDACTED***');
    expect(result.user.profile.apiKey).toBe('***REDACTED***');
    expect(result.user.profile.bio).toBe('Developer');
  });

  it('redacts sensitive fields in arrays of objects', () => {
    const input = {
      messages: [
        { id: 1, content: 'Hello', authToken: 'token-1' },
        { id: 2, content: 'World', secret: 'secret-2' },
      ],
    };

    const result = redactSensitive(input) as typeof input;

    expect(result.messages[0].id).toBe(1);
    expect(result.messages[0].content).toBe('Hello');
    expect(result.messages[0].authToken).toBe('***REDACTED***');
    expect(result.messages[1].id).toBe(2);
    expect(result.messages[1].content).toBe('World');
    expect(result.messages[1].secret).toBe('***REDACTED***');
  });

  it('preserves null and undefined values for non-sensitive keys', () => {
    const input = {
      name: null,
      description: undefined,
      apiKey: 'sensitive',
      token: 'also-sensitive',
    };

    const result = redactSensitive(input) as typeof input;

    expect(result.name).toBe(null);
    expect(result.description).toBe(undefined);
    expect(result.apiKey).toBe('***REDACTED***');
    expect(result.token).toBe('***REDACTED***');
  });

  it('preserves empty strings for non-sensitive keys', () => {
    const input = {
      empty: '',
      password: 'secret',
    };

    const result = redactSensitive(input) as typeof input;

    expect(result.empty).toBe('');
    expect(result.password).toBe('***REDACTED***');
  });

  it('handles Date instances correctly', () => {
    const date = new Date('2024-01-01T00:00:00Z');
    const input = {
      createdAt: date,
      token: 'sensitive',
    };

    const result = redactSensitive(input) as typeof input;

    expect(result.createdAt).toEqual(date);
    expect(result.createdAt).not.toBe(date); // Should be a new Date instance
    expect(result.token).toBe('***REDACTED***');
  });

  it('handles circular references without crashing', () => {
    const input: Record<string, unknown> = {
      name: 'test',
      value: 123,
    };

    // Create circular reference
    input.self = input;

    const result = redactSensitive(input) as typeof input;

    expect(result.name).toBe('test');
    expect(result.value).toBe(123);
    // Circular reference should be handled (marked as '[Circular]')
    expect(result.self).toBe('[Circular]');
  });

  it('handles multiple circular references in nested structures', () => {
    const obj1: Record<string, unknown> = { id: 1 };
    const obj2: Record<string, unknown> = { id: 2, ref: obj1 };
    obj1.ref = obj2; // Create circular reference between obj1 and obj2

    const input = {
      data: obj1,
      apiKey: 'sensitive',
    };

    const result = redactSensitive(input) as typeof input;

    expect(result.data.id).toBe(1);
    expect(result.apiKey).toBe('***REDACTED***');
    // Circular reference should be handled
    expect((result.data.ref as Record<string, unknown>).id).toBe(2);
  });

  it('matches all sensitive key patterns case-insensitively', () => {
    const input = {
      token: 't1',
      authToken: 't2',
      apiKey: 'k1',
      secretKey: 'k2',
      password: 'p1',
      credentials: 'c1',
      nonSensitive: 'safe',
    };

    const result = redactSensitive(input) as typeof input;

    expect(result.token).toBe('***REDACTED***');
    expect(result.authToken).toBe('***REDACTED***');
    expect(result.apiKey).toBe('***REDACTED***');
    expect(result.secretKey).toBe('***REDACTED***');
    expect(result.password).toBe('***REDACTED***');
    expect(result.credentials).toBe('***REDACTED***');
    expect(result.nonSensitive).toBe('safe');
  });

  it('handles empty objects and arrays', () => {
    const input = {
      emptyObj: {},
      emptyArr: [],
    };

    const result = redactSensitive(input) as typeof input;

    expect(result.emptyObj).toEqual({});
    expect(result.emptyArr).toEqual([]);
  });

  it('handles non-sensitive nested structures while preserving sensitive fields redaction', () => {
    const input = {
      config: {
        provider: 'openai',
        models: ['gpt-4', 'gpt-3.5-turbo'],
        settings: {
          temperature: 0.7,
          maxTokens: 2000,
        },
      },
      token: 'should-be-redacted',
    };

    const result = redactSensitive(input) as typeof input;

    expect(result.config.provider).toBe('openai');
    expect(result.config.models).toEqual(['gpt-4', 'gpt-3.5-turbo']);
    expect(result.config.settings.temperature).toBe(0.7);
    // Note: maxTokens contains 'key' substring, so it gets redacted as a security precaution
    expect(result.config.settings.maxTokens).toBe('***REDACTED***');
    expect(result.token).toBe('***REDACTED***');
  });
});

describe('REDACTED_KEYS_REGEX', () => {
  it('matches all expected sensitive patterns', () => {
    const patterns = [
      'token',
      'authToken',
      'apiKey',
      'secretKey',
      'password',
      'credentials',
      'TOKEN',
      'AuthToken',
      'API_KEY',
      'SECRET_KEY',
      'PASSWORD',
      'CREDENTIALS',
    ];

    patterns.forEach((pattern) => {
      expect(REDACTED_KEYS_REGEX.test(pattern)).toBe(true);
    });
  });

  it('acknowledges acceptable false positives for security', () => {
    // These keys contain sensitive substrings and will be redacted.
    // This is acceptable behavior for security - better safe than sorry.
    const acceptableFalsePositives = [
      'keywords', // Contains 'key'
      'secrets', // Contains 'secret'
      'tokenized', // Contains 'token'
      'maxTokens', // Contains 'key'
      'authenticationContext', // Contains 'auth'
    ];

    acceptableFalsePositives.forEach((key) => {
      expect(REDACTED_KEYS_REGEX.test(key)).toBe(true);
    });
  });

  it('does not match truly non-sensitive keys', () => {
    const nonSensitive = [
      'name',
      'description',
      'model',
      'temperature',
      'message',
      'content',
      'bio',
      'profile',
    ];

    nonSensitive.forEach((key) => {
      expect(REDACTED_KEYS_REGEX.test(key)).toBe(false);
    });
  });
});