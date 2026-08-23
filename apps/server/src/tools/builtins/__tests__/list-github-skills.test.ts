import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../skills/github.js', () => ({
  listRepoSkills: vi.fn(),
  importRepoSkill: vi.fn(),
}));

import { listRepoSkills } from '../../../skills/github.js';
import { listGithubSkillsExecutor } from '../list-github-skills.js';

const ctx = { sessionId: 's' };

describe('list_github_skills tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('describe: safe builtin requiring repoUrl', () => {
    const tool = listGithubSkillsExecutor.describe();
    expect(tool.name).toBe('list_github_skills');
    expect(tool.safetyLevel).toBe('safe');
    expect(tool.inputSchema.fields).toHaveLength(1);
    expect(tool.inputSchema.fields[0]?.name).toBe('repoUrl');
  });

  it('returns formatted candidate list', async () => {
    vi.mocked(listRepoSkills).mockResolvedValue({
      repo: 'anthropics/skills',
      ref: 'HEAD',
      entries: [
        { path: 'pdf', name: 'pdf', description: '处理 PDF', fileCount: 2 },
        { path: '', name: 'root-skill', description: 'd', fileCount: 0 },
      ],
    });
    const result = await listGithubSkillsExecutor.execute(
      { repoUrl: 'https://github.com/anthropics/skills' },
      ctx,
    );
    expect(result.isError).toBeUndefined();
    const text = result.content[0]?.text ?? '';
    expect(text).toContain('anthropics/skills');
    expect(text).toContain('pdf');
    expect(text).toContain('处理 PDF');
    expect(text).toContain('install_skill');
  });

  it('returns isError with message on service failure', async () => {
    vi.mocked(listRepoSkills).mockRejectedValue(new Error('仓库域名 evil.com 不允许'));
    const result = await listGithubSkillsExecutor.execute(
      { repoUrl: 'https://evil.com/a/b' },
      ctx,
    );
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('不允许');
  });
});