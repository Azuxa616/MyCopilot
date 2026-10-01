import { describe, it, expect } from 'vitest';
import { VISION_CATALOG_RULES, matchVisionCatalog } from '../capability.js';

describe('matchVisionCatalog', () => {
  it('matches confirmed prefix rules (yes)', () => {
    expect(matchVisionCatalog('gpt-4o')).toBe('yes');
    expect(matchVisionCatalog('gpt-4o-mini-2024-07-18')).toBe('yes');
    expect(matchVisionCatalog('deepseek-flash')).toBe('yes');
    expect(matchVisionCatalog('deepseek-flash-vision-exp')).toBe('yes'); // 同族前缀命中
  });

  it('matches confirmed prefix rules (no)', () => {
    expect(matchVisionCatalog('deepseek-v4-pro')).toBe('no');
  });

  it('normalizes case and surrounding whitespace before matching', () => {
    expect(matchVisionCatalog('GPT-4O')).toBe('yes');
    expect(matchVisionCatalog('  DeepSeek-Flash  ')).toBe('yes');
  });

  it('matches ollama-style local vision model families', () => {
    expect(matchVisionCatalog('llava:13b')).toBe('yes');
    expect(matchVisionCatalog('qwen2.5-7b-instruct-vl')).toBe('yes');
    expect(matchVisionCatalog('glm-4v-plus')).toBe('yes');
  });

  it('returns undefined for unconfirmed names (宁缺毋滥：漏判优于错判)', () => {
    expect(matchVisionCatalog('gpt-4')).toBeUndefined();      // 非 4o，无 vision 结论
    expect(matchVisionCatalog('deepseek-v4')).toBeUndefined();
    expect(matchVisionCatalog('llama3.1:8b')).toBeUndefined();
    expect(matchVisionCatalog('')).toBeUndefined();
    expect(matchVisionCatalog('   ')).toBeUndefined();
  });

  it('exposes rules as ordered prefix regexes', () => {
    expect(VISION_CATALOG_RULES.length).toBeGreaterThanOrEqual(4);
    for (const [pattern] of VISION_CATALOG_RULES) {
      // 全部规则必须是前缀语义（^ 开头）
      expect(pattern.source.startsWith('^')).toBe(true);
    }
  });
});
