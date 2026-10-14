import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Job } from '@my-copilot/shared';

// ---------------------------------------------------------------------------
// Mocks — 动态 import 的模块同样走 vi.mock 拦截（同一模块图）。
// Lambda 包装（而非直接传 mock）避免 vi.mock 工厂提升触发的 TDZ。
// ---------------------------------------------------------------------------

const mockRunAgentLoopAsJob = vi.fn();
// mock 签名经 vi.fn 泛型声明为 rest 参数：vi.mock 工厂以 (...args) => mock(...args)
// 转发时 strict TS 要求目标签名可接收 spread（TS2556）；实现体保持零参。
const mockGetAdapter = vi.fn<(...args: unknown[]) => unknown>(() => ({ type: 'openai' }));
const mockListEnabledTools = vi.fn<(...args: unknown[]) => unknown>(() => []);
const mockListRegisteredTools = vi.fn<(...args: unknown[]) => unknown>(() => []);
const mockFilterDemoTools = vi.fn<(...args: unknown[]) => unknown>((tools) => tools);
const mockBuildSkillInjections = vi.fn<(...args: unknown[]) => unknown>(() => []);
const mockClaimJob = vi.fn<(...args: unknown[]) => unknown>(() => undefined);
const mockCompleteJob = vi.fn<(...args: unknown[]) => unknown>(() => undefined);
const mockFailJob = vi.fn<(...args: unknown[]) => unknown>(() => undefined);
const mockReclaimStaleJobs = vi.fn<(...args: unknown[]) => number>(() => 0);
const mockRenewJobLease = vi.fn<(...args: unknown[]) => boolean>(() => true);
const mockFailWaitingJobsOnStartup = vi.fn<(...args: unknown[]) => number>(() => 0);

vi.mock('../../agent-loop/runner.js', () => ({
  runAgentLoopAsJob: (...args: unknown[]) => mockRunAgentLoopAsJob(...args),
}));
vi.mock('../../llm/index.js', () => ({
  getAdapter: (...args: unknown[]) => mockGetAdapter(...args),
}));
vi.mock('../../repo/tool.js', () => ({
  listEnabledTools: (...args: unknown[]) => mockListEnabledTools(...args),
}));
vi.mock('../../tools/registry.js', () => ({
  listRegisteredTools: (...args: unknown[]) => mockListRegisteredTools(...args),
}));
vi.mock('../../demo/tools.js', () => ({
  filterDemoTools: (...args: unknown[]) => mockFilterDemoTools(...args),
}));
vi.mock('../../prompt/skill-injections.js', () => ({
  buildSkillInjections: (...args: unknown[]) => mockBuildSkillInjections(...args),
}));
vi.mock('../../repo/job.js', () => ({
  claimJob: (...args: unknown[]) => mockClaimJob(...args),
  completeJob: (...args: unknown[]) => mockCompleteJob(...args),
  failJob: (...args: unknown[]) => mockFailJob(...args),
  reclaimStaleJobs: (...args: unknown[]) => mockReclaimStaleJobs(...args),
  renewJobLease: (...args: unknown[]) => mockRenewJobLease(...args),
  failWaitingJobsOnStartup: (...args: unknown[]) => mockFailWaitingJobsOnStartup(...args),
  resumeJobAfterConfirmation: vi.fn(),
  setJobWaitingForConfirmation: vi.fn(),
}));
vi.mock('../../repo/tool-approval.js', () => ({
  expirePendingToolApprovals: vi.fn(),
}));

import { processJob, registerAgentLoopHandler, clearJobHandlers, stop } from '../worker.js';

function makeJob(payload: Record<string, unknown>): Job {
  return {
    id: 'job-1',
    type: 'agent-loop',
    payload,
    status: 'running',
    priority: 0,
    attempts: 1,
    maxAttempts: 1,
    leasedAt: Date.now(),
    leaseOwner: 'worker-1',
    error: null,
    result: null,
    sessionId: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

function basePayload(): Record<string, unknown> {
  return {
    sessionId: 'sess-1',
    userMessageId: 'm1',
    userContent: 'hi',
    history: [],
    adapterType: 'openai',
    adapterConfig: { baseUrl: 'http://x', model: 'gpt' },
  };
}

describe('registerAgentLoopHandler（/ 与 @ 参数穿透：双链路之 async 执行侧）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRunAgentLoopAsJob.mockResolvedValue({ status: 'completed' });
    mockBuildSkillInjections.mockReturnValue([]);
    clearJobHandlers();
    registerAgentLoopHandler();
  });

  afterEach(async () => {
    await stop(100);
    clearJobHandlers();
  });

  it('payload 携带 enforcedSkillIds → buildSkillInjections 收到该数组；referencedSessionIds → job context', async () => {
    mockBuildSkillInjections.mockReturnValue([{ name: 'S', body: 'B' }]);

    await processJob(
      makeJob({
        ...basePayload(),
        enforcedSkillIds: ['beta'],
        referencedSessionIds: ['sess-9'],
      }),
    );

    expect(mockBuildSkillInjections).toHaveBeenCalledWith(['beta']);
    expect(mockRunAgentLoopAsJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        skills: [{ name: 'S', body: 'B' }],
        referencedSessionIds: ['sess-9'],
      }),
      expect.any(AbortSignal),
    );
    expect(mockCompleteJob).toHaveBeenCalled();
  });

  it('payload 未携带时按 undefined 传递（零行为变化，不抛错）', async () => {
    await processJob(makeJob(basePayload()));

    expect(mockBuildSkillInjections).toHaveBeenCalledWith(undefined);
    expect(mockRunAgentLoopAsJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ referencedSessionIds: undefined }),
      expect.any(AbortSignal),
    );
  });
});
