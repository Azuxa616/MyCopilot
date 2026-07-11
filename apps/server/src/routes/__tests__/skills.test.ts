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
}));

vi.mock('../../skills/parser.js', () => ({
  parseSkillMarkdown: vi.fn(),
}));

vi.mock('../../skills/sync.js', () => ({
  syncDirectorySkills: vi.fn(),
}));

vi.mock('../../db/index.js', () => ({
  getDb: vi.fn(),
}));

import {
  listSkills,
  getSkill,
  getSkillMeta,
  createSkill,
  updateSkill,
  deleteSkill,
} from '../../repo/skill.js';
import { parseSkillMarkdown } from '../../skills/parser.js';
import { syncDirectorySkills } from '../../skills/sync.js';
import { getDb } from '../../db/index.js';

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
    const body = (await res.json()) as any;
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
    const body = (await res.json()) as any;
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
    const body = (await res.json()) as any;
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
    const body = (await res.json()) as any;
    expect(body.msg).toContain('name');
  });

  it('GET /:id returns skill detail when found', async () => {
    vi.mocked(getSkill).mockReturnValue(mockSkillDetail);

    const app = createTestApp();
    const res = await app.request('/s1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual(mockSkillDetail);
  });

  it('GET /:id returns 404 when not found', async () => {
    vi.mocked(getSkill).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/s1');
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
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
    const body = (await res.json()) as any;
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
    const body = (await res.json()) as any;
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
    const body = (await res.json()) as any;
    expect(body.data.deleted).toBe(true);
  });

  it('DELETE /:id returns 404 when not found', async () => {
    vi.mocked(deleteSkill).mockReturnValue(false);

    const app = createTestApp();
    const res = await app.request('/s1', { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('POST /rescan uses configured skillsDir', async () => {
    const syncResult = { created: 2, updated: 0, skipped: 1, deleted: 0 };
    vi.mocked(syncDirectorySkills).mockReturnValue(syncResult);
    const mockDb = {} as any;
    vi.mocked(getDb).mockReturnValue(mockDb);

    const app = createTestApp({ skillsDir: '/skills' });
    const res = await app.request('/rescan', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.data).toEqual(syncResult);
    expect(syncDirectorySkills).toHaveBeenCalledWith(mockDb, '/skills');
  });

  it('POST /rescan accepts directory from request body when not configured', async () => {
    const syncResult = { created: 1, updated: 0, skipped: 0, deleted: 0 };
    vi.mocked(syncDirectorySkills).mockReturnValue(syncResult);
    const mockDb = {} as any;
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
    const body = (await res.json()) as any;
    expect(body.code).toBe(400);
    expect(body.msg).toContain('Skills directory');
  });
});
