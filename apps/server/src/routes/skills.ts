import { Hono } from 'hono';
import {
  listSkills,
  getSkill,
  getSkillMeta,
  createSkill,
  updateSkill,
  deleteSkill,
} from '../repo/skill.js';
import { parseSkillMarkdown } from '../skills/parser.js';
import { syncDirectorySkills, type SyncResult } from '../skills/sync.js';
import { successResponse } from '../utils/response.js';
import { HttpError } from '../middleware/error.js';
import { getDb } from '../db/index.js';
import type { SkillSource, UpdateSkillParams } from '@my-copilot/shared';

export interface SkillsAppOptions {
  /**
   * Default directory to scan for `*.md` skill files during POST /rescan.
   * If omitted, the endpoint requires a `directory` field in the request body.
   */
  skillsDir?: string;
}

export function createSkillsApp(opts: SkillsAppOptions = {}): Hono {
  const app = new Hono();

  // GET / — list skills, optional filters via query string.
  app.get('/', (c) => {
    const enabledParam = c.req.query('enabled');
    const sourceParam = c.req.query('source') as SkillSource | undefined;

    const filter: { enabled?: boolean; source?: SkillSource } = {};
    if (enabledParam === 'true') filter.enabled = true;
    else if (enabledParam === 'false') filter.enabled = false;
    if (sourceParam === 'directory' || sourceParam === 'upload') {
      filter.source = sourceParam;
    }

    const data = listSkills(filter);
    return successResponse(c, data);
  });

  // POST / — create a skill from raw markdown content.
  app.post('/', async (c) => {
    const body = await c.req.json<{ source?: SkillSource; content?: string }>();

    const source: SkillSource =
      body.source === 'directory' || body.source === 'upload' ? body.source : 'upload';
    const content = typeof body.content === 'string' ? body.content : '';

    if (!content.trim()) {
      throw new HttpError(400, 'Missing required field: content');
    }

    const parsed = parseSkillMarkdown(content);
    if (!parsed.frontmatter.name) {
      throw new HttpError(
        400,
        'Invalid skill: frontmatter is missing a name field',
      );
    }

    const data = createSkill({
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      body: parsed.body,
      source,
    });

    return successResponse(c, data, 201);
  });

  // GET /:id — return full skill detail (body exposed as `content`).
  app.get('/:id', (c) => {
    const id = c.req.param('id');
    const data = getSkill(id);
    if (!data) {
      throw new HttpError(404, 'Skill not found');
    }
    return successResponse(c, data);
  });

  // PATCH /:id — update skill. Directory-sourced skills are read-only.
  app.patch('/:id', async (c) => {
    const id = c.req.param('id');
    const meta = getSkillMeta(id);
    if (!meta) {
      throw new HttpError(404, 'Skill not found');
    }
    if (meta.source === 'directory') {
      throw new HttpError(
        403,
        'Directory-sourced skills cannot be edited; modify the source file and rescan',
      );
    }

    const body = await c.req.json<UpdateSkillParams>();
    const data = updateSkill(id, body);
    if (!data) {
      throw new HttpError(404, 'Skill not found');
    }
    return successResponse(c, data);
  });

  // DELETE /:id — delete a skill. Directory-sourced skills are deleted from
  // DB only (the file remains on disk; a rescan would re-create the row).
  app.delete('/:id', (c) => {
    const id = c.req.param('id');
    const deleted = deleteSkill(id);
    if (!deleted) {
      throw new HttpError(404, 'Skill not found');
    }
    return successResponse(c, { deleted });
  });

  // POST /rescan — re-sync the directory into the DB.
  app.post('/rescan', async (c) => {
    let dir = opts.skillsDir;
    if (!dir) {
      try {
        const body = await c.req.json<{ directory?: string }>();
        if (typeof body.directory === 'string') dir = body.directory;
      } catch {
        // body parsing is best-effort; fall through to the 400 below
      }
    }
    if (!dir) {
      throw new HttpError(
        400,
        'Skills directory is not configured; provide { directory } in the request body',
      );
    }

    const result: SyncResult = syncDirectorySkills(getDb(), dir);
    return successResponse(c, result);
  });

  return app;
}
