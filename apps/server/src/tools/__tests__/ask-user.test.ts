import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ASK_USER_TIMEOUT_CONFIG_KEY, QUESTION_CARD_LIMITS } from '@my-copilot/shared';
import { initDatabase, getDb } from '../../db/index.js';
import { createSession } from '../../repo/session.js';
import * as config from '../../repo/config.js';
import { clearPendingConfirmations, resolveToolApproval } from '../confirmation.js';
import { askUserExecutor } from '../builtins/ask-user.js';

const validQuestion = { question: '选择方案', mode: 'single', options: ['A', 'B'] };

describe('ask_user executor', () => {
  let testDir: string;
  let sessionId: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'my-copilot-ask-user-'));
    initDatabase(testDir);
    sessionId = createSession({}).id;
    clearPendingConfirmations();
    vi.useFakeTimers();
  });

  afterEach(() => {
    clearPendingConfirmations();
    vi.useRealTimers();
    getDb().close();
    rmSync(testDir, { recursive: true, force: true });
  });

  it.each([
    ['questions 为空', []],
    ['questions 超过四题', Array.from({ length: 5 }, () => validQuestion)],
    ['question 为空', [{ ...validQuestion, question: ' ' }]],
    ['question 过长', [{ ...validQuestion, question: 'x'.repeat(QUESTION_CARD_LIMITS.maxQuestionChars + 1) }]],
    ['description 过长', [{ ...validQuestion, description: 'x'.repeat(QUESTION_CARD_LIMITS.maxDescriptionChars + 1) }]],
    ['mode 无效', [{ ...validQuestion, mode: 'other' }]],
    ['options 不足', [{ ...validQuestion, options: ['A'] }]],
    ['options 过多', [{ ...validQuestion, options: ['A', 'B', 'C', 'D', 'E', 'F', 'G'] }]],
    ['options 重复', [{ ...validQuestion, options: ['A', 'A'] }]],
    ['options 为空', [{ ...validQuestion, options: ['A', ' '] }]],
    ['options 过长', [{ ...validQuestion, options: ['A', 'x'.repeat(QUESTION_CARD_LIMITS.maxOptionChars + 1)] }]],
    ['optionDescriptions 不等长', [{ ...validQuestion, optionDescriptions: ['A'] }]],
    ['optionDescriptions 为空', [{ ...validQuestion, optionDescriptions: ['', 'B'] }]],
    ['optionDescriptions 过长', [{ ...validQuestion, optionDescriptions: ['A', 'x'.repeat(QUESTION_CARD_LIMITS.maxOptionDescriptionChars + 1)] }]],
    ['allowCustomOption 非布尔', [{ ...validQuestion, allowCustomOption: 'yes' }]],
    ['customOptionLabel 过长', [{ ...validQuestion, customOptionLabel: 'x'.repeat(QUESTION_CARD_LIMITS.maxCustomLabelChars + 1) }]],
  ])('拒绝无效输入：%s', async (_name, questions) => {
    const result = await askUserExecutor.execute({ questions }, { sessionId });
    expect(result.isError).toBe(true);
    expect(result.content[0]?.text).toMatch(/第|questions/);
  });

  it('接受 JSON 字符串并透传用户回答', async () => {
    let approvalId = '';
    const promise = askUserExecutor.execute({ questions: JSON.stringify([validQuestion]) }, {
      sessionId,
      toolCallId: 'call-1',
      advertisedTool: askUserExecutor.describe(),
      onConfirmationRequired: approval => { approvalId = approval.approvalId; },
    });
    await vi.waitFor(() => expect(approvalId).not.toBe(''));
    const answer = { status: 'answered', answers: [{ index: 0, status: 'answered', selections: ['A'] }], answeredAt: new Date().toISOString() };
    resolveToolApproval(approvalId, true, JSON.stringify(answer));
    const result = await promise;
    expect(result.isError).toBeUndefined();
    expect(result.content[0]?.text).toBe(JSON.stringify(answer));
  });

  it('配置超时时返回 expired 负载', async () => {
    config.set(ASK_USER_TIMEOUT_CONFIG_KEY, '1000');
    const promise = startWaiting();
    await vi.advanceTimersByTimeAsync(1000);
    const result = await promise;
    expect(JSON.parse(result.content[0]?.text ?? '')).toEqual({ status: 'expired', answers: [] });
  });

  it('未配置超时时不会过期', async () => {
    let approvalId = '';
    const promise = askUserExecutor.execute({ questions: [validQuestion] }, {
      sessionId,
      onConfirmationRequired: approval => { approvalId = approval.approvalId; },
    });
    await vi.waitFor(() => expect(approvalId).not.toBe(''));
    await vi.advanceTimersByTimeAsync(10_000_000);
    let settled = false;
    void promise.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    resolveToolApproval(approvalId, true, '{"status":"skipped","answers":[]}');
    await promise;
  });

  function startWaiting() {
    return askUserExecutor.execute({ questions: [validQuestion] }, {
      sessionId,
      onConfirmationRequired: () => undefined,
    });
  }
});
