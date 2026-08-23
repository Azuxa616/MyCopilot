import { describe, it, expect, afterEach } from 'vitest';
import { loadConfig } from '../config.js';

describe('loadConfig DEMO_MODE', () => {
  afterEach(() => {
    delete process.env.DEMO_MODE;
    delete process.env.DEMO_TOKEN;
    delete process.env.AUTH_TOKEN;
  });

  it('throws when DEMO_MODE=1 without DEMO_TOKEN', () => {
    process.env.DEMO_MODE = '1';
    delete process.env.DEMO_TOKEN;
    expect(() => loadConfig()).toThrow(/DEMO_TOKEN/);
  });

  it('parses demo flags and trims token', () => {
    process.env.DEMO_MODE = '1';
    process.env.DEMO_TOKEN = '  demo-token  ';
    const config = loadConfig();
    expect(config.demoMode).toBe(true);
    expect(config.demoToken).toBe('demo-token');
  });

  it('defaults to demo off', () => {
    delete process.env.DEMO_MODE;
    const config = loadConfig();
    expect(config.demoMode).toBe(false);
    expect(config.demoToken).toBeNull();
  });
});