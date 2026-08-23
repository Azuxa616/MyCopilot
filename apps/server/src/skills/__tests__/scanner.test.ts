import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { scanSkillDirectory } from '../scanner.js';

describe('scanSkillDirectory', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'skill-scan-'));
  });

  afterEach(() => {
    if (dir && existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('returns empty array for an empty directory', () => {
    const result = scanSkillDirectory(dir);
    expect(result).toEqual([]);
  });

  it('returns empty array when directory does not exist', () => {
    const result = scanSkillDirectory(join(dir, 'does-not-exist'));
    expect(result).toEqual([]);
  });

  it('discovers and parses valid skill markdown files', () => {
    writeFileSync(
      join(dir, 'alpha.md'),
      `---
name: Alpha
description: first skill
---
# Alpha body`,
    );
    writeFileSync(
      join(dir, 'beta.md'),
      `---
name: Beta
description: second skill
---
Beta body content`,
    );

    const result = scanSkillDirectory(dir);
    expect(result).toHaveLength(2);

    const names = result.map((r) => r.parsed.frontmatter.name).sort();
    expect(names).toEqual(['Alpha', 'Beta']);

    for (const item of result) {
      expect(item.hash).toMatch(/^[a-f0-9]{64}$/);
      expect(item.fileName).toMatch(/\.md$/);
      expect(item.filePath).toContain(item.fileName);
    }
  });

  it('skips files with missing or empty name in frontmatter', () => {
    writeFileSync(
      join(dir, 'good.md'),
      `---
name: Good
description: ok
---
body`,
    );
    writeFileSync(join(dir, 'noFm.md'), 'just plain text, no frontmatter');
    writeFileSync(
      join(dir, 'emptyName.md'),
      `---
description: missing name
---
body`,
    );
    // Non-markdown file should be ignored entirely.
    writeFileSync(join(dir, 'notes.txt'), '---\nname: ignored\n---\n');

    const result = scanSkillDirectory(dir);
    expect(result).toHaveLength(1);
    expect(result[0]!.parsed.frontmatter.name).toBe('Good');
  });

  it('ignores uppercase .MD extension by lowercasing the check', () => {
    writeFileSync(
      join(dir, 'caps.MD'),
      `---
name: Caps
description: upper ext
---
body`,
    );
    const result = scanSkillDirectory(dir);
    expect(result).toHaveLength(1);
    expect(result[0]!.parsed.frontmatter.name).toBe('Caps');
  });

  it('ignores subdirectories instead of trying to read them as files', () => {
    mkdirSync(join(dir, 'subdir'));
    writeFileSync(
      join(dir, 'real.md'),
      `---
name: Real
description: x
---
body`,
    );

    const result = scanSkillDirectory(dir);
    expect(result).toHaveLength(1);
    expect(result[0]!.parsed.frontmatter.name).toBe('Real');
  });

  it('discovers a directory-pack skill with SKILL.md entry and side files', () => {
    const packDir = join(dir, 'code-review');
    mkdirSync(join(packDir, 'references'), { recursive: true });
    writeFileSync(
      join(packDir, 'SKILL.md'),
      `---
name: CodeReview
description: review code
---
# Review body`,
    );
    writeFileSync(join(packDir, 'references', 'api.md'), 'api reference');
    writeFileSync(join(packDir, 'extra.txt'), 'notes');

    const result = scanSkillDirectory(dir);
    expect(result).toHaveLength(1);

    const skill = result[0];
    expect(skill.parsed.frontmatter.name).toBe('CodeReview');
    expect(skill.filePath).toBe(join(packDir, 'SKILL.md'));
    expect(skill.files).toEqual([
      { path: 'references/api.md', content: 'api reference' },
      { path: 'extra.txt', content: 'notes' },
    ]);
  });

  it('directory pack skips scripts dir, non-text files, and oversized files', () => {
    const packDir = join(dir, 'pack');
    mkdirSync(join(packDir, 'scripts'), { recursive: true });
    writeFileSync(
      join(packDir, 'SKILL.md'),
      `---\nname: Pack\ndescription: d\n---\nbody`,
    );
    writeFileSync(join(packDir, 'scripts', 'run.sh'), '#!/bin/sh');
    writeFileSync(join(packDir, 'logo.png'), 'fake-binary');
    writeFileSync(join(packDir, 'big.md'), 'x'.repeat(256 * 1024 + 1));

    const result = scanSkillDirectory(dir);
    expect(result).toHaveLength(1);
    expect(result[0].files).toEqual([]); // 全部被跳过：scripts/、非白名单、超限
  });

  it('directory pack exceeding file count limit keeps first N files', () => {
    const packDir = join(dir, 'many');
    mkdirSync(packDir, { recursive: true });
    writeFileSync(join(packDir, 'SKILL.md'), `---\nname: Many\ndescription: d\n---\nbody`);
    for (let i = 0; i < 25; i++) {
      writeFileSync(join(packDir, `f${i}.txt`), `c${i}`);
    }

    const result = scanSkillDirectory(dir);
    expect(result[0].files.length).toBeLessThanOrEqual(20);
  });

  it('directory without SKILL.md is ignored entirely', () => {
    mkdirSync(join(dir, 'not-a-skill'), { recursive: true });
    writeFileSync(join(dir, 'not-a-skill', 'random.md'), 'no frontmatter pack');

    expect(scanSkillDirectory(dir)).toEqual([]);
  });

  it('flat *.md skills still work and carry empty files', () => {
    writeFileSync(join(dir, 'flat.md'), `---\nname: Flat\ndescription: d\n---\nflat body`);

    const result = scanSkillDirectory(dir);
    expect(result).toHaveLength(1);
    expect(result[0].parsed.frontmatter.name).toBe('Flat');
    expect(result[0].files).toEqual([]);
  });
});
