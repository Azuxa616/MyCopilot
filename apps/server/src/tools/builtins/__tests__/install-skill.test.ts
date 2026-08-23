import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SkillDetail } from '@my-copilot/shared';

vi.mock('../../../repo/skill.js', () => ({ createSkill: vi.fn() }));
vi.mock('../../../skills/github.js', () => ({
  listRepoSkills: vi.fn(),
  importRepoSkill: vi.fn(),
}));

import { createSkill } from '../../../repo/skill.js';
import { importRepoSkill } from '../../../skills/github.js';
import { installSkillExecutor } from '../install-skill.js';

const ctx = { sessionId: 's' };

function makeDetail(over: Partial<SkillDetail>): SkillDetail {
  return {
    id: 'sk1',
    name: 'x',
    description: 'd',
    content: 'b',
    enabled: true,
    createdAt: 1,
    updatedAt: 1,
    source: 'upload',
    ...over,
  };
}

describe('install_skill tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('describe: restricted builtin（持久注入必须过审批）', () => {
    const tool = installSkillExecutor.describe();
    expect(tool.name).toBe('install_skill');
    expect(tool.safetyLevel).toBe('restricted');
    expect(tool.description).toContain('candidates');
  });

  it('repoUrl path: delegates to importRepoSkill', async () => {
    vi.mocked(importRepoSkill).mockResolvedValue(makeDetail({ name: 'pdf', description: '处理 PDF' }));
    const result = await installSkillExecutor.execute(
      { repoUrl: 'https://github.com/o/r', path: 'pdf' },
      ctx,
    );
    expect(importRepoSkill).toHaveBeenCalledWith('https://github.com/o/r', 'pdf');
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('pdf');
  });

  it('content path: parses SKILL.md and creates upload-source skill', async () => {
    vi.mocked(createSkill).mockReturnValue(makeDetail({ name: 'gen', always: true }));
    const result = await installSkillExecutor.execute(
      { content: '---\nname: gen\ndescription: d\nalways: true\n---\n# body' },
      ctx,
    );
    expect(vi.mocked(createSkill).mock.calls[0][0]).toMatchObject({
      name: 'gen',
      source: 'upload',
      always: true,
    });
    expect(result.isError).toBeUndefined();
  });

  it('content missing frontmatter name → isError with guidance, nothing created', async () => {
    const result = await installSkillExecutor.execute({ content: 'no frontmatter' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('name');
    expect(createSkill).not.toHaveBeenCalled();
  });

  it('neither content nor repoUrl → isError', async () => {
    const result = await installSkillExecutor.execute({}, ctx);
    expect(result.isError).toBe(true);
  });

  it('service failure surfaces as isError, nothing created', async () => {
    vi.mocked(importRepoSkill).mockRejectedValue(
      new Error('仓库包含多个 skill（a、b），请指定 path'),
    );
    const result = await installSkillExecutor.execute(
      { repoUrl: 'https://github.com/o/r' },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('多个');
  });
});