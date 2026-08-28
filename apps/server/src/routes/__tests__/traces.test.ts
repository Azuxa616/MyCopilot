import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';
import { errorMiddleware } from '../../middleware/error.js';
import { tracesApp } from '../traces.js';

vi.mock('../../repo/runTrace.js', () => ({
  listRunsBySession: vi.fn(),
  getRunWithSteps: vi.fn(),
}));

import { listRunsBySession, getRunWithSteps } from '../../repo/runTrace.js';

type ApiResponse<T = unknown> = {
  code: number;
  msg: string;
  data: T;
};

const sampleRun = {
  id: 'r1',
  sessionId: 's1',
  userMessageId: 'um1',
  assistantMessageId: 'am1',
  agentId: null,
  jobId: null,
  status: 'completed' as const,
  stopReason: 'end_turn' as const,
  iterations: 2,
  budgetSnapshot: null,
  degraded: false,
  totalTokens: 120,
  startedAt: '2026-08-28T00:00:00.000Z',
  endedAt: '2026-08-28T00:00:01.000Z',
  error: null,
  stepCount: 3,
};

const sampleStep = {
  id: 'st1',
  runId: 'r1',
  seq: 1,
  type: 'tool_exec' as const,
  toolName: 'calculator',
  argsPreview: '{"expression":"2+3"}',
  resultPreview: '5',
  isError: false,
  durationMs: 12,
  createdAt: '2026-08-28T00:00:00.500Z',
};

function createTestApp() {
  const app = new Hono();
  app.onError(errorMiddleware());
  app.route('/', tracesApp);
  return app;
}

/** 构造 n 条 stepCount 不同的 run，id 依序编号。 */
function makeRuns(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    ...sampleRun,
    id: `r${i + 1}`,
    stepCount: i + 1,
  }));
}

describe('traces route', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ─── GET /sessions/:sessionId/runs ───────────────────────────────────────

  it('GET /sessions/:id/runs returns runs with stepCount via listRunsBySession', async () => {
    vi.mocked(listRunsBySession).mockReturnValue([sampleRun]);

    const app = createTestApp();
    const res = await app.request('/sessions/s1/runs');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<typeof sampleRun[]>;
    expect(body).toEqual({ code: 0, msg: 'ok', data: [sampleRun] });
    expect(listRunsBySession).toHaveBeenCalledWith('s1');
  });

  it('GET /sessions/:id/runs returns empty array for session without runs', async () => {
    vi.mocked(listRunsBySession).mockReturnValue([]);

    const app = createTestApp();
    const res = await app.request('/sessions/empty/runs');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<unknown[]>;
    expect(body).toEqual({ code: 0, msg: 'ok', data: [] });
  });

  it('GET /sessions/:id/runs?limit=2 slices repo result to 2', async () => {
    vi.mocked(listRunsBySession).mockReturnValue(makeRuns(5));

    const app = createTestApp();
    const res = await app.request('/sessions/s1/runs?limit=2');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<{ id: string }[]>;
    expect(body.data.map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('GET /sessions/:id/runs clamps ?limit=0 up to 1 (lower bound)', async () => {
    vi.mocked(listRunsBySession).mockReturnValue(makeRuns(3));

    const app = createTestApp();
    const res = await app.request('/sessions/s1/runs?limit=0');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<{ id: string }[]>;
    expect(body.data).toHaveLength(1);
  });

  it('GET /sessions/:id/runs clamps ?limit=999 down to 50 (upper bound)', async () => {
    vi.mocked(listRunsBySession).mockReturnValue(makeRuns(55));

    const app = createTestApp();
    const res = await app.request('/sessions/s1/runs?limit=999');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<{ id: string }[]>;
    expect(body.data).toHaveLength(50);
  });

  it('GET /sessions/:id/runs falls back to default 50 for non-numeric ?limit', async () => {
    vi.mocked(listRunsBySession).mockReturnValue(makeRuns(55));

    const app = createTestApp();
    const res = await app.request('/sessions/s1/runs?limit=abc');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<{ id: string }[]>;
    expect(body.data).toHaveLength(50);
  });

  it('GET /sessions/:id/runs without ?limit defaults to 50', async () => {
    vi.mocked(listRunsBySession).mockReturnValue(makeRuns(55));

    const app = createTestApp();
    const res = await app.request('/sessions/s1/runs');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<{ id: string }[]>;
    expect(body.data).toHaveLength(50);
  });

  // ─── GET /runs/:runId ─────────────────────────────────────────────────────

  it('GET /runs/:runId returns run with steps when found', async () => {
    vi.mocked(getRunWithSteps).mockReturnValue({ run: sampleRun, steps: [sampleStep] });

    const app = createTestApp();
    const res = await app.request('/runs/r1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as ApiResponse<{ run: typeof sampleRun; steps: typeof sampleStep[] }>;
    expect(body.data.run.id).toBe('r1');
    expect(body.data.steps).toEqual([sampleStep]);
    expect(getRunWithSteps).toHaveBeenCalledWith('r1');
  });

  it('GET /runs/:runId returns 404 when not found', async () => {
    vi.mocked(getRunWithSteps).mockReturnValue(undefined);

    const app = createTestApp();
    const res = await app.request('/runs/missing');
    expect(res.status).toBe(404);
    const body = (await res.json()) as ApiResponse<null>;
    expect(body.code).toBe(404);
    expect(body.msg).toContain('Run not found');
  });
});
