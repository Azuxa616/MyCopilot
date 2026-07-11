import matter from 'gray-matter';
import type { ParsedSkill, SkillFrontmatter } from '@my-copilot/shared';

/**
 * Parse a SKILL.md markdown string into frontmatter + body.
 *
 * Never throws — always returns a valid ParsedSkill. If frontmatter is
 * missing or invalid, returns empty frontmatter ({name: '', description: ''})
 * and treats the whole input as the body.
 */
export function parseSkillMarkdown(raw: string): ParsedSkill {
  let data: Record<string, unknown> = {};
  let body = raw;

  try {
    const parsed = matter(raw, { excerpt: false });
    data = parsed.data ?? {};
    body = parsed.content ?? '';
  } catch {
    // gray-matter rarely throws, but be defensive: treat input as raw body.
    return {
      frontmatter: { name: '', description: '' },
      body: raw,
      raw,
    };
  }

  const frontmatter = normalizeFrontmatter(data);

  return {
    frontmatter,
    body,
    raw,
  };
}

function normalizeFrontmatter(data: Record<string, unknown>): SkillFrontmatter {
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  const description =
    typeof data.description === 'string' ? data.description.trim() : '';

  const result: SkillFrontmatter = { name, description };

  if (Array.isArray(data.triggers)) {
    const triggers = data.triggers.filter((t): t is string => typeof t === 'string');
    if (triggers.length > 0) {
      result.triggers = triggers;
    }
  } else if (typeof data.triggers === 'string') {
    result.triggers = [data.triggers];
  }

  if (typeof data.version === 'string') {
    result.version = data.version;
  }

  return result;
}
