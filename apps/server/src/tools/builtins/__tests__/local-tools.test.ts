import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  base64DecodeExecutor,
  base64EncodeExecutor,
  calculatorExecutor,
  currentDatetimeExecutor,
  generateUuidExecutor,
  hashTextExecutor,
  jsonFormatExecutor,
} from '../index.js';

const context = { sessionId: 'test-session' };

function resultJson(result: Awaited<ReturnType<typeof hashTextExecutor.execute>>) {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('local built-in tools', () => {
  it('returns deterministic time fields for a requested time zone', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-12T04:30:00.000Z'));

    const result = await currentDatetimeExecutor.execute(
      { timeZone: 'Asia/Hong_Kong', locale: 'en-US' },
      context,
    );
    const value = resultJson(result);

    expect(result.isError).toBeUndefined();
    expect(value.isoUtc).toBe('2026-07-12T04:30:00.000Z');
    expect(value.unixMs).toBe(1783830600000);
    expect(value.timeZone).toBe('Asia/Hong_Kong');
    expect(value.formatted).toContain('12:30:00 PM');
  });

  it('returns an error for an invalid time zone', async () => {
    const result = await currentDatetimeExecutor.execute(
      { timeZone: 'Not/A_Timezone' },
      context,
    );

    expect(result.isError).toBe(true);
  });

  it('evaluates calculator input and rejects non-string input', async () => {
    const result = await calculatorExecutor.execute({ expression: '6 * 7' }, context);
    expect(resultJson(result)).toEqual({ expression: '6 * 7', result: 42 });

    const invalid = await calculatorExecutor.execute({ expression: 42 }, context);
    expect(invalid.isError).toBe(true);
    expect(invalid.content[0]!.text).toContain('must be a string');
  });

  it('generates UUID version 4 values', async () => {
    const result = await generateUuidExecutor.execute({}, context);
    const value = resultJson(result);

    expect(value.version).toBe(4);
    expect(value.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('creates a known SHA-256 digest', async () => {
    const result = await hashTextExecutor.execute({ text: 'abc' }, context);

    expect(resultJson(result)).toEqual({
      algorithm: 'sha256',
      digest: 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    });
  });

  it('round-trips Unicode text through Base64', async () => {
    const source = '你好, MyCopilot 👋';
    const encoded = await base64EncodeExecutor.execute({ text: source }, context);
    const base64 = resultJson(encoded).base64;
    const decoded = await base64DecodeExecutor.execute({ data: base64 }, context);

    expect(resultJson(decoded)).toEqual({ text: source });
  });

  it.each(['not base64', 'YQ=', '/w=='])(
    'rejects invalid Base64 or UTF-8 input %s',
    async (data) => {
      const result = await base64DecodeExecutor.execute({ data }, context);
      expect(result.isError).toBe(true);
    },
  );

  it('formats and recursively sorts JSON keys', async () => {
    const result = await jsonFormatExecutor.execute(
      { json: '{"z":{"b":1,"a":2},"a":0}', indent: 2, sortKeys: true },
      context,
    );

    expect(resultJson(result).formatted).toBe(
      '{\n  "a": 0,\n  "z": {\n    "a": 2,\n    "b": 1\n  }\n}',
    );
  });

  it('supports compact JSON and rejects invalid options', async () => {
    const compact = await jsonFormatExecutor.execute(
      { json: '{"a": 1}', indent: 0 },
      context,
    );
    expect(resultJson(compact)).toEqual({ formatted: '{"a":1}' });

    const invalidJson = await jsonFormatExecutor.execute({ json: '{' }, context);
    expect(invalidJson.isError).toBe(true);

    const invalidIndent = await jsonFormatExecutor.execute(
      { json: '{}', indent: 9 },
      context,
    );
    expect(invalidIndent.isError).toBe(true);
  });

  it('honors an already-aborted signal', async () => {
    const controller = new AbortController();
    controller.abort();

    const result = await generateUuidExecutor.execute(
      {},
      { sessionId: 'test-session', signal: controller.signal },
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('cancelled');
  });

  it('enforces the one MiB text limit', async () => {
    const result = await hashTextExecutor.execute(
      { text: 'a'.repeat(1024 * 1024 + 1) },
      context,
    );

    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('1048576 byte limit');
  });
});
