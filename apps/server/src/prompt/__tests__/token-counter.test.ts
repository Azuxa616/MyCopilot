import { describe, it, expect } from 'vitest';
import {
  estimateTokens,
  estimateMessageTokens,
  estimateMessagesTokens,
} from '../token-counter.js';

describe('estimateTokens', () => {
  it('returns 0 for empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('returns 0 for nullish input (defensive)', () => {
    // The function guards `!text`, so undefined/null also yield 0.
    expect(estimateTokens('' as string)).toBe(0);
  });

  it('rounds up: "hello world" (11 chars) -> ceil(11/4) = 3', () => {
    expect(estimateTokens('hello world')).toBe(3);
  });

  it('approximates 100 chars -> 25 tokens', () => {
    const text = 'a'.repeat(100);
    expect(estimateTokens(text)).toBe(25);
  });

  it('rounds up partial tokens (1 char -> 1 token)', () => {
    expect(estimateTokens('x')).toBe(1);
  });

  it('handles exact multiple (8 chars -> 2 tokens, no off-by-one)', () => {
    expect(estimateTokens('abcdefgh')).toBe(2);
  });
});

describe('estimateMessageTokens', () => {
  it('adds role overhead (4) to content tokens', () => {
    // content 'test' = 4 chars -> ceil(4/4) = 1 token, + 4 overhead = 5
    expect(
      estimateMessageTokens({ role: 'user', content: 'test' }),
    ).toBe(5);
  });

  it('counts only overhead for empty content', () => {
    expect(
      estimateMessageTokens({ role: 'assistant', content: '' }),
    ).toBe(4);
  });

  it('treats null content as empty (assistant tool-call turn)', () => {
    expect(
      estimateMessageTokens({ role: 'assistant', content: null }),
    ).toBe(4);
  });

  it('is role-agnostic (overhead is constant across roles)', () => {
    const user = estimateMessageTokens({ role: 'user', content: 'hi' });
    const system = estimateMessageTokens({ role: 'system', content: 'hi' });
    const tool = estimateMessageTokens({ role: 'tool', content: 'hi' });
    expect(user).toBe(system);
    expect(system).toBe(tool);
  });
});

describe('estimateMessagesTokens', () => {
  it('returns 0 for empty array', () => {
    expect(estimateMessagesTokens([])).toBe(0);
  });

  it('sums token costs across multiple messages', () => {
    const messages = [
      { role: 'user', content: 'test' }, // 4 + 1 = 5
      { role: 'assistant', content: 'hi' }, // 4 + 1 = 5
      { role: 'user', content: '' }, // 4 + 0 = 4
    ];
    expect(estimateMessagesTokens(messages)).toBe(14);
  });

  it('matches sum of individual estimateMessageTokens calls', () => {
    const messages = [
      { role: 'system', content: 'long system prompt '.repeat(10) },
      { role: 'user', content: 'question?' },
      { role: 'assistant', content: null },
    ];
    const individual = messages.reduce(
      (sum, m) => sum + estimateMessageTokens(m),
      0,
    );
    expect(estimateMessagesTokens(messages)).toBe(individual);
  });
});
