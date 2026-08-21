import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SkillDetail, SkillMeta } from '@my-copilot/shared';

// ---------------------------------------------------------------------------
// Mock repo layer BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockListSkills = vi.fn();
const mockGetSkill = vi.fn();

vi.mock('../../repo/skill.js', () => ({
  listSkills: (...args: unknown[]) => mockListSkills(...args),
  getSkill: (...args: unknown[]) => mockGetSkill(...args),
}));

const { buildSkillInjections } = await import('../skill-injections.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** 最小表 fixture：模拟 skills 表行（body 对应 body 列）。 */
interface SkillRowFixture {
  id: string;
  name: string;
  body: string;
  enabled: boolean;
  createdAt: number;
}

function makeMeta(row: SkillRowFixture): SkillMeta {
  return {
    id: row.id,
    name: row.name,
    description: `desc of ${row.name}`,
    enabled: row.enabled,
    createdAt: row.createdAt,
    updatedAt: row.createdAt,
    source: 'directory',
  };
}

function makeDetail(row: SkillRowFixture): SkillDetail {
  return { ...makeMeta(row), content: row.body };
}

/**
 * 以内存表驱动 mock：listSkills 复现 repo 的 enabled 过滤 + created_at
 * DESC 排序契约，getSkill 按 id 返回 SkillDetail（content 即 body 列）。
 */
function installTable(rows: SkillRowFixture[]): void {
  mockListSkills.mockImplementation((filter?: { enabled?: boolean }) =>
    rows
      .filter((row) => filter?.enabled === undefined || row.enabled === filter.enabled)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(makeMeta),
  );
  mockGetSkill.mockImplementation((id: string) => {
    const row = rows.find((r) => r.id === id);
    return row ? makeDetail(row) : undefined;
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('buildSkillInjections', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('2 enabled + 1 disabled → 2 条注入，不含 disabled，按 createdAt 排序', () => {
    installTable([
      { id: 'skill-1', name: 'alpha', body: 'body of alpha', enabled: true, createdAt: 2 },
      { id: 'skill-2', name: 'beta', body: 'body of beta', enabled: true, createdAt: 1 },
      { id: 'skill-3', name: 'gamma', body: 'body of gamma', enabled: false, createdAt: 3 },
    ]);

    const result = buildSkillInjections();

    // enabled 过滤必须显式请求（disabled 排除的唯一保证）
    expect(mockListSkills).toHaveBeenCalledWith({ enabled: true });
    expect(result).toHaveLength(2);
    expect(result).toEqual([
      { name: 'alpha', body: 'body of alpha' },
      { name: 'beta', body: 'body of beta' },
    ]);
    expect(result.map((s) => s.name)).not.toContain('gamma');
  });

  it('空表 → []，且不发起 detail 查询', () => {
    installTable([]);

    expect(buildSkillInjections()).toEqual([]);
    expect(mockGetSkill).not.toHaveBeenCalled();
  });

  it('meta 对应 detail 缺失（getSkill → undefined）时跳过该条', () => {
    mockListSkills.mockReturnValue([
      { id: 'skill-1', name: 'alpha', enabled: true, createdAt: 1 },
    ] as SkillMeta[]);
    mockGetSkill.mockReturnValue(undefined);

    expect(buildSkillInjections()).toEqual([]);
  });
});
