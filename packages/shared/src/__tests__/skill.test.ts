import { describe, it, expect } from 'vitest';
import type { SkillFrontmatter, SkillMeta, SkillDetail, ParsedSkill } from '../skill.js';

describe('Skill types', () => {
  it('should create a valid SkillFrontmatter', () => {
    const frontmatter: SkillFrontmatter = {
      name: 'test',
      description: 'A test skill',
      triggers: ['test'],
    };
    expect(frontmatter.name).toBe('test');
  });

  it('should create a valid SkillMeta', () => {
    const meta: SkillMeta = {
      id: 'skill-1',
      name: 'Test Skill',
      description: 'A test skill',
      enabled: true,
      createdAt: 1000,
      updatedAt: 1000,
    };
    expect(meta.name).toBe('Test Skill');
  });

  it('should create a valid SkillDetail', () => {
    const detail: SkillDetail = {
      id: 'skill-1',
      name: 'Test Skill',
      description: 'A test skill',
      enabled: true,
      createdAt: 1000,
      updatedAt: 1000,
      content: '# Skill Content',
    };
    expect(detail.content).toBe('# Skill Content');
  });

  it('should create a valid ParsedSkill', () => {
    const parsed: ParsedSkill = {
      frontmatter: { name: 'test', description: 'desc' },
      body: 'body content',
      raw: '---\nname: test\ndescription: desc\n---\nbody content',
    };
    expect(parsed.frontmatter.name).toBe('test');
    expect(parsed.body).toBe('body content');
  });
});
