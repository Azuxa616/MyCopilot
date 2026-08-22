import { describe, it, expect } from 'vitest';
import {
  SKILL_FILE_MAX_BYTES,
  SKILL_MAX_FILES,
  SKILL_FILES_TOTAL_MAX_BYTES,
  isSkillTextFile,
} from '../limits.js';

describe('skill limits', () => {
  it('exposes the documented constants', () => {
    expect(SKILL_FILE_MAX_BYTES).toBe(256 * 1024);
    expect(SKILL_MAX_FILES).toBe(20);
    expect(SKILL_FILES_TOTAL_MAX_BYTES).toBe(1024 * 1024);
  });

  it('isSkillTextFile accepts whitelisted extensions only', () => {
    expect(isSkillTextFile('references/api.md')).toBe(true);
    expect(isSkillTextFile('assets/tpl.txt')).toBe(true);
    expect(isSkillTextFile('conf.yaml')).toBe(true);
    expect(isSkillTextFile('scripts/run.sh')).toBe(false); // 扩展名不在白名单
    expect(isSkillTextFile('logo.png')).toBe(false);
    expect(isSkillTextFile('bin')).toBe(false);
  });
});