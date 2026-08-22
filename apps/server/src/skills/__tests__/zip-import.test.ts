import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { parseSkillZip } from '../zip-import.js';

function zipOf(entries: Record<string, string>): Uint8Array {
  return zipSync(
    Object.fromEntries(Object.entries(entries).map(([k, v]) => [k, strToU8(v)])),
  );
}

const VALID_SKILL_MD = `---
name: Imported
description: from zip
---
# Imported body`;

describe('parseSkillZip', () => {
  it('parses a root-level SKILL.md pack with side files', () => {
    const result = parseSkillZip(
      zipOf({
        'SKILL.md': VALID_SKILL_MD,
        'references/api.md': 'api doc',
        'assets/tpl.txt': 'tpl',
        'scripts/run.sh': '#!/bin/sh', // 应被跳过
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.skill).toMatchObject({
      name: 'Imported',
      description: 'from zip',
      body: '# Imported body',
    });
    expect(result.skill?.files).toEqual([
      { path: 'assets/tpl.txt', content: 'tpl' },
      { path: 'references/api.md', content: 'api doc' },
    ]);
  });

  it('parses a single-subdirectory pack (<name>/SKILL.md), stripping the pack prefix', () => {
    const result = parseSkillZip(
      zipOf({
        'code-review/SKILL.md': VALID_SKILL_MD,
        'code-review/references/README.md': 'readme',
        // pack 子目录之外的条目不属于该 pack，应被忽略
        'outside.md': 'not part of the pack',
      }),
    );

    expect(result.ok).toBe(true);
    // 附属文件剥离 pack 根前缀，与 scanner 的"相对 pack 根"语义一致
    expect(result.skill?.files).toEqual([{ path: 'references/README.md', content: 'readme' }]);
  });

  it('rejects unsafe side-file paths (traversal / absolute / backslash)', () => {
    const result = parseSkillZip(
      zipOf({
        'SKILL.md': VALID_SKILL_MD,
        '../evil.md': 'traversal',
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('../evil.md');

    const backslash = parseSkillZip(
      zipOf({
        'SKILL.md': VALID_SKILL_MD,
        'dir\\file.md': 'windows separator',
      }),
    );
    expect(backslash.ok).toBe(false);
    expect(backslash.error).toContain('dir\\file.md');
  });

  it('falls back to a single flat .md at zip root (legacy shape)', () => {
    const result = parseSkillZip(zipOf({ 'old-skill.md': VALID_SKILL_MD }));
    expect(result.ok).toBe(true);
    expect(result.skill?.name).toBe('Imported');
    expect(result.skill?.files).toEqual([]);
  });

  it('rejects a zip without SKILL.md or usable markdown', () => {
    const result = parseSkillZip(zipOf({ 'foo.txt': 'no skill here' }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('SKILL.md');
  });

  it('rejects a SKILL.md missing frontmatter name', () => {
    const result = parseSkillZip(zipOf({ 'SKILL.md': 'no frontmatter' }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('name');
  });

  it('rejects oversized side files with the offending path', () => {
    const result = parseSkillZip(
      zipOf({
        'SKILL.md': VALID_SKILL_MD,
        'big.md': 'x'.repeat(256 * 1024 + 1),
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.error).toContain('big.md');
  });

  it('rejects packs exceeding the file count limit', () => {
    const entries: Record<string, string> = { 'SKILL.md': VALID_SKILL_MD };
    for (let i = 0; i < 25; i++) entries[`f${i}.txt`] = `c${i}`;

    const result = parseSkillZip(zipOf(entries));
    expect(result.ok).toBe(false);
    expect(result.error).toContain('20');
  });

  it('rejects malformed zip data', () => {
    const result = parseSkillZip(new Uint8Array([0x00, 0x01, 0x02, 0x03]));
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});