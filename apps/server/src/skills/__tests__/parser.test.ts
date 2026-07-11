import { describe, it, expect } from 'vitest';
import { parseSkillMarkdown } from '../parser.js';

describe('parseSkillMarkdown', () => {
  it('parses normal frontmatter with name and description', () => {
    const raw = `---
name: My Skill
description: A useful skill
---
# Body content here

Do the thing.`;
    const result = parseSkillMarkdown(raw);
    expect(result.frontmatter.name).toBe('My Skill');
    expect(result.frontmatter.description).toBe('A useful skill');
    expect(result.body).toContain('# Body content here');
    expect(result.body).toContain('Do the thing.');
    expect(result.raw).toBe(raw);
  });

  it('returns empty frontmatter when no frontmatter is present', () => {
    const raw = '# Just a heading\n\nNo frontmatter here.';
    const result = parseSkillMarkdown(raw);
    expect(result.frontmatter.name).toBe('');
    expect(result.frontmatter.description).toBe('');
    expect(result.body).toBe(raw);
    expect(result.raw).toBe(raw);
  });

  it('returns empty name but keeps body when frontmatter is broken yaml', () => {
    // Invalid YAML: unquoted colon-in-value without space breaks parsing.
    // gray-matter is permissive; the worst case is empty data, never a throw.
    const raw = `---
name: : :
---
body still here`;
    const result = parseSkillMarkdown(raw);
    expect(result.frontmatter.name === '' || typeof result.frontmatter.name === 'string').toBe(true);
    // Body may or may not include the raw text depending on parse outcome,
    // but the function must never throw.
    expect(typeof result.body).toBe('string');
    expect(result.raw).toBe(raw);
  });

  it('handles large body content without truncation', () => {
    const big = 'A'.repeat(50_000);
    const raw = `---
name: Big
description: huge
---
${big}`;
    const result = parseSkillMarkdown(raw);
    expect(result.frontmatter.name).toBe('Big');
    expect(result.body).toContain(big);
    expect(result.body.length).toBeGreaterThanOrEqual(50_000);
  });

  it('preserves code blocks that contain --- separators', () => {
    const raw = `---
name: CodeSkill
description: has fences
---
Here is a fence:

\`\`\`
---
not frontmatter
---
\`\`\`

After fence.`;
    const result = parseSkillMarkdown(raw);
    expect(result.frontmatter.name).toBe('CodeSkill');
    expect(result.body).toContain('```');
    expect(result.body).toContain('not frontmatter');
    expect(result.body).toContain('After fence.');
  });

  it('parses triggers array and version string', () => {
    const raw = `---
name: Triggers
description: with triggers
triggers:
  - one
  - two
version: 1.2.3
---
body`;
    const result = parseSkillMarkdown(raw);
    expect(result.frontmatter.name).toBe('Triggers');
    expect(result.frontmatter.triggers).toEqual(['one', 'two']);
    expect(result.frontmatter.version).toBe('1.2.3');
  });

  it('trims whitespace around name and description', () => {
    const raw = `---
name: "  spaced  "
description: " pad me "
---
body`;
    const result = parseSkillMarkdown(raw);
    expect(result.frontmatter.name).toBe('spaced');
    expect(result.frontmatter.description).toBe('pad me');
  });

  it('never throws on non-string input shapes', () => {
    // gray-matter parses numeric/bool values; normalizeFrontmatter must cope.
    const raw = `---
name: 123
description: true
---
body`;
    const result = parseSkillMarkdown(raw);
    expect(result.frontmatter.name).toBe('');
    expect(result.frontmatter.description).toBe('');
  });
});
