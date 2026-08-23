import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';

const { listRepoSkills, importRepoSkill, parseGithubRepoUrl } = await import('../github.js');

function repoZip(root: string, entries: Record<string, string>): Response {
  const full = Object.fromEntries(
    Object.entries(entries).map(([k, v]) => [`${root}/${k}`, strToU8(v)]),
  );
  const body = zipSync(full);
  return new Response(body, { status: 200, headers: { 'content-length': String(body.length) } });
}

const SKILL_MD = (n: string) => `---\nname: ${n}\ndescription: skill ${n}\n---\n# ${n} body`;

beforeEach(() => {
  process.env.SKILL_IMPORT_MAX_MB = '1';
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SKILL_IMPORT_ALLOWED_HOSTS;
  delete process.env.SKILL_IMPORT_MAX_MB;
});

describe('parseGithubRepoUrl', () => {
  it('accepts github.com owner/repo and builds codeload HEAD archive url', () => {
    const r = parseGithubRepoUrl('https://github.com/anthropics/skills');
    expect(r.owner).toBe('anthropics');
    expect(r.repo).toBe('skills');
    expect(r.archiveUrl).toBe('https://codeload.github.com/anthropics/skills/zip/HEAD');
  });

  it('strips trailing slash and .git suffix', () => {
    const r = parseGithubRepoUrl('https://github.com/anthropics/skills.git/');
    expect(r.repo).toBe('skills');
  });

  it('rejects non-whitelisted hosts', () => {
    expect(() => parseGithubRepoUrl('https://evil.com/a/b')).toThrow(/不允许/);
  });

  it('honors SKILL_IMPORT_ALLOWED_HOSTS override', () => {
    process.env.SKILL_IMPORT_ALLOWED_HOSTS = 'gitee.com';
    expect(() => parseGithubRepoUrl('https://gitee.com/a/b')).not.toThrow();
    expect(() => parseGithubRepoUrl('https://github.com/a/b')).toThrow(/不允许/);
  });

  it('rejects malformed paths', () => {
    expect(() => parseGithubRepoUrl('https://github.com/onlyowner')).toThrow(/owner\/repo/);
  });
});

describe('listRepoSkills', () => {
  it('lists pack skills and root SKILL.md, stripping archive root prefix', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => repoZip('skills-abc123', {
      'pdf/SKILL.md': SKILL_MD('pdf'),
      'pdf/references/api.md': 'api',
      'docx/SKILL.md': SKILL_MD('docx'),
      'README.md': 'not a skill entry',
    })));

    const m = await listRepoSkills('https://github.com/o/r');
    expect(m.repo).toBe('o/r');
    expect(m.entries.map((e) => e.name).sort()).toEqual(['docx', 'pdf']);
    const pdf = m.entries.find((e) => e.name === 'pdf')!;
    expect(pdf.path).toBe('pdf');
    expect(pdf.fileCount).toBe(1);
    expect(pdf.description).toBe('skill pdf');
  });

  it('rejects archives over the size cap via content-length', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(new Uint8Array(10), { status: 200, headers: { 'content-length': String(2 * 1024 * 1024) } })));
    await expect(listRepoSkills('https://github.com/o/r')).rejects.toThrow(/上限/);
  });

  it('surfaces fetch failures with status', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nf', { status: 404 })));
    await expect(listRepoSkills('https://github.com/o/r')).rejects.toThrow(/404/);
  });

  it('returns empty entries for a repo without skills (no throw)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => repoZip('r-1', { 'README.md': 'x' })));
    const m = await listRepoSkills('https://github.com/o/r');
    expect(m.entries).toEqual([]);
  });
});

describe('importRepoSkill', () => {
  it('imports one pack with side files as upload-source editable copy', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => repoZip('skills-abc123', {
      'pdf/SKILL.md': `---\nname: pdf\ndescription: d\ntriggers:\n  - pdf\nalways: true\n---\nbody`,
      'pdf/references/api.md': 'api',
    })));

    const { getDb, initDatabase } = await import('../../db/index.js');
    const { mkdtempSync, rmSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'gh-import-'));
    initDatabase(dir);
    try {
      const detail = await importRepoSkill('https://github.com/o/r', 'pdf');
      expect(detail.source).toBe('upload');
      expect(detail.triggers).toEqual(['pdf']);
      expect(detail.always).toBe(true);
      expect(detail.files?.map((f) => f.path)).toEqual(['references/api.md']);
    } finally {
      getDb().close();
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('imports root skill when path omitted and repo is single-skill', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => repoZip('r-1', {
      'SKILL.md': SKILL_MD('solo'),
    })));

    const { getDb, initDatabase } = await import('../../db/index.js');
    const { mkdtempSync, rmSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'gh-import-2'));
    initDatabase(dir);
    try {
      const detail = await importRepoSkill('https://github.com/o/r');
      expect(detail.name).toBe('solo');
      expect(detail.fileCount ?? detail.files?.length).toBe(0);
    } finally {
      getDb().close();
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });

  it('throws with candidate list when path omitted and repo has multiple skills', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => repoZip('skills-abc123', {
      'a/SKILL.md': SKILL_MD('a'), 'b/SKILL.md': SKILL_MD('b'),
    })));
    await expect(importRepoSkill('https://github.com/o/r')).rejects.toThrow(/a.*b|多个/);
  });

  it('throws for unknown path', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => repoZip('r-1', {
      'a/SKILL.md': SKILL_MD('a'),
    })));
    await expect(importRepoSkill('https://github.com/o/r', 'nope')).rejects.toThrow(/nope|未找到/);
  });

  it('throws when side file exceeds single-file limit (strict import)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => repoZip('r-1', {
      'a/SKILL.md': SKILL_MD('a'),
      'a/big.md': 'x'.repeat(256 * 1024 + 1),
    })));
    const { getDb, initDatabase } = await import('../../db/index.js');
    const { mkdtempSync, rmSync, existsSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = mkdtempSync(join(tmpdir(), 'gh-import-3'));
    initDatabase(dir);
    try {
      await expect(importRepoSkill('https://github.com/o/r', 'a')).rejects.toThrow(/big\.md|上限/);
    } finally {
      getDb().close();
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    }
  });
});