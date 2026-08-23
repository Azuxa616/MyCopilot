import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorMiddleware } from '../../middleware/error.js';
import { createSkillsApp } from '../skills.js';

vi.mock('../../repo/skill.js', () => ({
  listSkills: vi.fn(),
  getSkill: vi.fn(),
  getSkillMeta: vi.fn(),
  createSkill: vi.fn(),
  updateSkill: vi.fn(),
  deleteSkill: vi.fn(),
  getSkillFile: vi.fn(),
}));

vi.mock('../../skills/parser.js', () => ({
  parseSkillMarkdown: vi.fn(),
}));

vi.mock('../../skills/sync.js', () => ({
  syncDirectorySkills: vi.fn(),
}));

vi.mock('../../skills/zip-import.js', () => ({
  parseSkillZip: vi.fn(),
}));

vi.mock('../../db/index.js', () => ({
  getDb: vi.fn(),
}));

vi.mock('../../skills/github.js', () => ({
  listRepoSkills: vi.fn(),
  importRepoSkill: vi.fn(),
}));

import {
  listSkills,
  getSkill,
  getSkillMeta,
  createSkill,
  updateSkill,
  deleteSkill,
  getSkillFile,
} from '../../repo/skill.js';
import { parseSkillMarkdown } from '../../skills/parser.js';
import { syncDirectorySkills } from '../../skills/sync.js';
import { parseSkillZip } from '../../skills/zip-import.js';
import { getDb } from '../../db/index.js';
import { listRepoSkills, importRepoSkill } from '../../skills/github.js';

type ApiResponse = {
  code: number;
  msg: string;
  data: Record<string, unknown>;
};

function createTestApp(opts?: Parameters<typeof createSkillsApp>[0]) {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/', createSkillsApp(opts));
  return app;
}

const mockSkillMeta = {
  id: 's1',
  name: 'Test',
  description: 'A skill',
  enabled: true,
  createdAt: 1,
  updatedAt: 1,
  source: 'upload' as const,
};

const mockSkillDetail = {
  ...mockSkillMeta,
  content: '# Body',
};

describe('skills route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET / returns list of skills', async () => {
    const mockList = [mockSkillMeta];
    vi.mocked(listSkills).mockReturnValue(mockList);

    const app = createTestApp();
    const res = await app.request('/');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body).toEqual({ code: 0, msg: 'ok', data: mockList });
  });

  it('GET / with query filters passes them to listSkills', async () => {
    vi.mocked(listSkills).mockReturnValue([]);

    const app = createTestApp();
    const res = await app.request('/?enabled=true&source=directory');
    expect(res.status).toBe(200);
    expect(listSkills).toHaveBeenCalledWith({ enabled: true, source: 'directory' });
  });

  it('POST / creates skill with valid content', async () => {
    const parsed = {
      frontmatter: { name: 'New', description: 'desc' },
      body: '# Body',
      raw: '---\nname: New\ndescription: desc\n---\n# Body',
    };
    vi.mocked(parseSkillMarkdown).mockReturnValue(parsed);
    vi.mocked(createSkill).mockReturnValue(mockSkillDetail);

    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'upload', content: '---\nname: New\ndescription: desc\n---\n# Body' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as ApiResponse;
    expect(body.data).toEqual(mockSkillDetail);
    expect(createSkill).toHaveBeenCalledWith({
      name: 'New',
      description: 'desc',
      body: '# Body',
      source: 'upload',
    });
  });

  it('POST / returns 400 when content is empty', async () => {
    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: '  ' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiResponse;
    expect(body.code).toBe(400);
    expect(body.msg).toContain('content');
  });

  it('POST / returns 400 when frontmatter name is missing', async () => {
    vi.mocked(parseSkillMarkdown).mockReturnValue({
      frontmatter: { name: '', description: '' },
      body: 'no name',
      raw: 'no name',
    });

    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'no name' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiResponse;
    expect(body.msg).toContain('name');
  });

  it('GET /:id returns skill detail when found', async () => {
    vi.mocked(getSkill).mockReturnValue(mockSkillDetail);

    const app = createTestApp();
    const res = await app.request('/s1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.data).toEqual(mockSkillDetail);
  });

  it('GET /:id returns 404 when not found', async () => {
    vi.mocked(getSkill).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/s1');
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiResponse;
    expect(body.code).toBe(404);
  });

  it('PATCH /:id updates upload-sourced skill', async () => {
    const meta = { ...mockSkillMeta, source: 'upload' as const };
    vi.mocked(getSkillMeta).mockReturnValue(meta);
    const updated = { ...mockSkillDetail, name: 'Updated', updatedAt: 2 };
    vi.mocked(updateSkill).mockReturnValue(updated);

    const app = createTestApp();
    const res = await app.request('/s1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Updated' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.data.name).toBe('Updated');
  });

  it('PATCH /:id returns 403 for directory-sourced skill', async () => {
    const meta = { ...mockSkillMeta, source: 'directory' as const, filePath: '/x.md' };
    vi.mocked(getSkillMeta).mockReturnValue(meta);

    const app = createTestApp();
    const res = await app.request('/s1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Changed' }),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as ApiResponse;
    expect(body.code).toBe(403);
    expect(body.msg).toContain('Directory-sourced');
  });

  it('PATCH /:id returns 404 when not found', async () => {
    vi.mocked(getSkillMeta).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/s1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'X' }),
    });
    expect(res.status).toBe(404);
  });

  it('DELETE /:id deletes skill', async () => {
    vi.mocked(deleteSkill).mockReturnValue(true);

    const app = createTestApp();
    const res = await app.request('/s1', { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.data.deleted).toBe(true);
  });

  it('DELETE /:id returns 404 when not found', async () => {
    vi.mocked(deleteSkill).mockReturnValue(false);

    const app = createTestApp();
    const res = await app.request('/s1', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('POST /rescan uses configured skillsDir', async () => {
    const syncResult = { created: 2, updated: 0, skipped: 1, deleted: 0, filesCreated: 0, filesUpdated: 0, filesDeleted: 0 };
    vi.mocked(syncDirectorySkills).mockReturnValue(syncResult);
    const mockDb = {} as ReturnType<typeof getDb>;
    vi.mocked(getDb).mockReturnValue(mockDb);

    const app = createTestApp({ skillsDir: '/skills' });
    const res = await app.request('/rescan', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.data).toEqual(syncResult);
    expect(syncDirectorySkills).toHaveBeenCalledWith(mockDb, '/skills');
  });

  it('POST /rescan accepts directory from request body when not configured', async () => {
    const syncResult = { created: 1, updated: 0, skipped: 0, deleted: 0, filesCreated: 0, filesUpdated: 0, filesDeleted: 0 };
    vi.mocked(syncDirectorySkills).mockReturnValue(syncResult);
    const mockDb = {} as ReturnType<typeof getDb>;
    vi.mocked(getDb).mockReturnValue(mockDb);

    const app = createTestApp();
    const res = await app.request('/rescan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ directory: '/custom-skills' }),
    });
    expect(res.status).toBe(200);
    expect(syncDirectorySkills).toHaveBeenCalledWith(mockDb, '/custom-skills');
  });

  it('POST /rescan returns 400 when no directory configured or provided', async () => {
    const app = createTestApp();
    const res = await app.request('/rescan', { method: 'POST' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiResponse;
    expect(body.code).toBe(400);
    expect(body.msg).toContain('Skills directory');
  });

  it('POST / persists frontmatter triggers', async () => {
    vi.mocked(parseSkillMarkdown).mockReturnValue({
      frontmatter: { name: 'T', description: 'd', triggers: ['a', 'b'] },
      body: 'body',
      raw: '',
    });
    vi.mocked(createSkill).mockReturnValue({ ...mockSkillDetail, id: 's9' });

    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'x' }),
    });
    expect(res.status).toBe(201);
    expect(vi.mocked(createSkill).mock.calls[0][0].triggers).toEqual(['a', 'b']);
  });

  it('POST / accepts structured shape {name, description, body} (SkillFormModal flow)', async () => {
    vi.mocked(createSkill).mockReturnValue({ ...mockSkillDetail, id: 's10' });

    const app = createTestApp();
    const res = await app.request('/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'FromModal', description: 'd', body: '# b' }),
    });
    expect(res.status).toBe(201);
    expect(vi.mocked(createSkill).mock.calls[0][0]).toMatchObject({
      name: 'FromModal',
      description: 'd',
      body: '# b',
      source: 'upload',
    });
  });

  it('PATCH /:id forwards triggers and files', async () => {
    vi.mocked(getSkillMeta).mockReturnValue({ ...mockSkillMeta });
    vi.mocked(updateSkill).mockReturnValue({ ...mockSkillDetail });

    const app = createTestApp();
    const res = await app.request('/s1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        triggers: ['x'],
        files: [{ path: 'a.md', content: 'a' }],
      }),
    });
    expect(res.status).toBe(200);
    expect(vi.mocked(updateSkill).mock.calls[0][1]).toEqual({
      triggers: ['x'],
      files: [{ path: 'a.md', content: 'a' }],
    });
  });

  it('PATCH /:id rejects unsafe file paths with 400', async () => {
    vi.mocked(getSkillMeta).mockReturnValue({ ...mockSkillMeta });

    const app = createTestApp();
    const res = await app.request('/s1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        files: [
          { path: 'ok.md', content: 'a' },
          { path: '../evil.md', content: 'b' },
        ],
      }),
    });
    expect(res.status).toBe(400);
    expect(vi.mocked(updateSkill)).not.toHaveBeenCalled();
  });

  it('POST /import uploads a zip and creates an upload-source skill', async () => {
    vi.mocked(parseSkillZip).mockReturnValue({
      ok: true,
      skill: {
        name: 'Zipped',
        description: 'd',
        body: 'b',
        files: [{ path: 'references/a.md', content: 'a' }],
      },
    });
    vi.mocked(createSkill).mockReturnValue({ ...mockSkillDetail, id: 'sz1' });

    const app = createTestApp();
    const form = new FormData();
    form.append(
      'file',
      new File([new Uint8Array([1, 2, 3])], 'pack.zip', { type: 'application/zip' }),
    );

    const res = await app.request('/import', { method: 'POST', body: form });
    expect(res.status).toBe(201);
    expect(vi.mocked(createSkill).mock.calls[0][0]).toMatchObject({
      name: 'Zipped',
      source: 'upload',
      files: [{ path: 'references/a.md', content: 'a' }],
    });
  });

  it('POST /import rejects a zip without usable SKILL.md', async () => {
    vi.mocked(parseSkillZip).mockReturnValue({ ok: false, error: 'ZIP 中未找到 SKILL.md' });

    const app = createTestApp();
    const form = new FormData();
    form.append('file', new File([new Uint8Array([1])], 'bad.zip'));

    const res = await app.request('/import', { method: 'POST', body: form });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiResponse;
    expect(JSON.stringify(body)).toContain('SKILL.md');
  });

  it('POST /import rejects a missing file field', async () => {
    const app = createTestApp();
    const res = await app.request('/import', {
      method: 'POST',
      body: new FormData(),
    });
    expect(res.status).toBe(400);
  });

  it('GET /:id/files/* returns file content for a nested path', async () => {
    vi.mocked(getSkillMeta).mockReturnValue({ ...mockSkillMeta });
    vi.mocked(getSkillFile).mockReturnValue({
      path: 'references/api.md',
      content: 'api doc',
    });

    const app = createTestApp();
    const res = await app.request('/s1/files/references%2Fapi.md');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect(body.data).toEqual({ path: 'references/api.md', content: 'api doc' });
    expect(vi.mocked(getSkillFile).mock.calls[0]).toEqual(['s1', 'references/api.md']);
  });

  it('GET /:id/files/* rejects path traversal', async () => {
    const app = createTestApp();
    const res = await app.request('/s1/files/..%2F..%2Fetc%2Fpasswd');
    expect(res.status).toBe(400);
  });

  it('GET /:id/files/* returns 404 for unknown skill or file', async () => {
    vi.mocked(getSkillMeta).mockReturnValue(undefined);
    const app = createTestApp();
    const res1 = await app.request('/s1/files/nope.md');
    expect(res1.status).toBe(404);

    vi.mocked(getSkillMeta).mockReturnValue({ ...mockSkillMeta });
    vi.mocked(getSkillFile).mockReturnValue(undefined);
    const res2 = await app.request('/s1/files/nope.md');
    expect(res2.status).toBe(404);
  });

  it('GET /github/manifest proxies listRepoSkills', async () => {
    vi.mocked(listRepoSkills).mockResolvedValue({
      repo: 'o/r',
      ref: 'HEAD',
      entries: [{ path: 'pdf', name: 'pdf', description: 'd', fileCount: 1 }],
    });
    const app = createTestApp();
    const res = await app.request('/github/manifest?url=' + encodeURIComponent('https://github.com/o/r'));
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse;
    expect((body.data as { entries: unknown[] }).entries).toHaveLength(1);
  });

  it('GET /github/manifest rejects errors with 400', async () => {
    vi.mocked(listRepoSkills).mockRejectedValue(new Error('仓库域名 evil.com 不允许'));
    const app = createTestApp();
    const res = await app.request('/github/manifest?url=' + encodeURIComponent('https://evil.com/a/b'));
    expect(res.status).toBe(400);
  });

  it('GET /github/manifest requires url query', async () => {
    const app = createTestApp();
    const res = await app.request('/github/manifest');
    expect(res.status).toBe(400);
  });

  it('POST /import/github creates skill via importRepoSkill', async () => {
    vi.mocked(importRepoSkill).mockResolvedValue({ ...mockSkillDetail, id: 'gh1' });
    const app = createTestApp();
    const res = await app.request('/import/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://github.com/o/r', path: 'pdf' }),
    });
    expect(res.status).toBe(201);
    expect(vi.mocked(importRepoSkill).mock.calls[0]).toEqual(['https://github.com/o/r', 'pdf']);
  });

  it('POST /import/github rejects service errors with 400', async () => {
    vi.mocked(importRepoSkill).mockRejectedValue(new Error('仓库包含多个 skill（a、b），请指定 path'));
    const app = createTestApp();
    const res = await app.request('/import/github', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://github.com/o/r' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as ApiResponse;
    expect(JSON.stringify(body)).toContain('多个');
  });
});
