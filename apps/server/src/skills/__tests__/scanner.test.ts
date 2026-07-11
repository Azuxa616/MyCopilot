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
});
