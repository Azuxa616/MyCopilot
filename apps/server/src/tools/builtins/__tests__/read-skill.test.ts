import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SkillMeta, SkillDetail } from '@my-copilot/shared';

vi.mock('../../../repo/skill.js', () => ({
  listEnabledSkills: vi.fn(),
  getSkill: vi.fn(),
  getSkillFile: vi.fn(),
}));

import { listEnabledSkills, getSkill, getSkillFile } from '../../../repo/skill.js';
import { readSkillExecutor } from '../read-skill.js';

const ctx = { sessionId: 's' };

function makeDetail(over: Partial<SkillDetail>): SkillDetail {
  return {
    id: 'sk1', name: 'pdf', description: 'd', content: '# body', enabled: true,
    createdAt: 1, updatedAt: 1, source: 'upload', ...over,
  };
}

const meta = (id: string, name: string): SkillMeta => ({
  id, name, description: '', enabled: true, createdAt: 1, updatedAt: 1,
});

describe('read_skill tool', () => {
  beforeEach(() => vi.clearAllMocks());

  it('describe: safe builtin with name + optional path', () => {
    const tool = readSkillExecutor.describe();
    expect(tool.name).toBe('read_skill');
    expect(tool.safetyLevel).toBe('safe');
    expect(tool.inputSchema.fields.map((f) => f.name)).toEqual(['name', 'path']);
  });

  it('returns SKILL.md body by name when path omitted', async () => {
    vi.mocked(listEnabledSkills).mockReturnValue([meta('sk1', 'pdf')]);
    vi.mocked(getSkill).mockReturnValue(makeDetail({}));

    const result = await readSkillExecutor.execute({ name: 'pdf' }, ctx);
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toContain('# body');
  });

  it('returns side file content when path given', async () => {
    vi.mocked(listEnabledSkills).mockReturnValue([meta('sk1', 'pdf')]);
    vi.mocked(getSkill).mockReturnValue(makeDetail({}));
    vi.mocked(getSkillFile).mockReturnValue({ path: 'references/api.md', content: 'api doc' });

    const result = await readSkillExecutor.execute({ name: 'pdf', path: 'references/api.md' }, ctx);
    expect(result.content[0]?.text).toContain('api doc');
    expect(vi.mocked(getSkillFile).mock.calls[0]).toEqual(['sk1', 'references/api.md']);
  });

  it('errors for unknown skill without leaking content', async () => {
    vi.mocked(listEnabledSkills).mockReturnValue([]);
    const result = await readSkillExecutor.execute({ name: 'nope' }, ctx);
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toContain('不在当前可用');
  });

  it('rejects unsafe path arguments', async () => {
    vi.mocked(listEnabledSkills).mockReturnValue([meta('sk1', 'pdf')]);
    vi.mocked(getSkill).mockReturnValue(makeDetail({}));
    const result = await readSkillExecutor.execute({ name: 'pdf', path: '../etc/passwd' }, ctx);
    expect(result.isError).toBe(true);
    expect(getSkillFile).not.toHaveBeenCalled();
  });
});
