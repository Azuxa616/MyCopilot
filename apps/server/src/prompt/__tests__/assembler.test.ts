import { describe, it, expect } from 'vitest';
import {
  assembleMessages,
  type AttachmentText,
  type SkillInjection,
  type SummaryInjection,
} from '../assembler.js';
import type { Message } from '@my-copilot/shared';

function createMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: 'msg-1',
    sessionId: 'session-1',
    role: 'user',
    content: 'Hello',
    attachments: [],
    status: 'sent',
    createdAt: Date.now(),
    ...overrides,
  };
}

describe('assembleMessages', () => {
  // Test 1: No attachments → messages = [system, ...history, user]
  it('assembles without attachments: system + history + user', () => {
    const history: Message[] = [
      createMessage({ id: '1', role: 'user', content: 'Hi' }),
      createMessage({ id: '2', role: 'assistant', content: 'Hello!' }),
    ];

    const result = assembleMessages({ history, userContent: 'New question' });

    expect(result).toHaveLength(4); // system + 2 history + user
    expect(result[0]).toEqual({
      role: 'system',
      content: '你是一个乐于助人的 AI 助手,请用中文回答用户问题。',
    });
    expect(result[1]).toEqual({ role: 'user', content: 'Hi' });
    expect(result[2]).toEqual({ role: 'assistant', content: 'Hello!' });
    expect(result[3]).toEqual({ role: 'user', content: 'New question' });
  });

  // Test 2: With attachments → user message contains attachment text blocks
  it('includes attachment text blocks in user message', () => {
    const history: Message[] = [];
    const attachments: AttachmentText[] = [
      { name: 'report.docx', content: 'Full text of report' },
    ];

    const result = assembleMessages({
      history,
      userContent: 'Summarize this',
      attachments,
    });

    expect(result).toHaveLength(2); // system + user

    const userContent = result[1].content;
    // Check format
    expect(userContent).toContain('[附件:report.docx]');
    expect(userContent).toContain('Full text of report');
    expect(userContent).toContain('[/附件]');
    expect(userContent).toContain('Summarize this');
    // Attachment block must appear before user text
    const attIdx = userContent.indexOf('[附件:report.docx]');
    const userIdx = userContent.indexOf('Summarize this');
    expect(attIdx).toBeLessThan(userIdx);
  });

  // Test 3: Aborted messages are skipped
  it('skips aborted messages', () => {
    const history: Message[] = [
      createMessage({ id: '1', role: 'user', content: 'Hi', status: 'sent' }),
      createMessage({ id: '2', role: 'assistant', content: 'Partial response...', status: 'aborted' }),
      createMessage({ id: '3', role: 'user', content: 'Try again', status: 'sent' }),
    ];

    const result = assembleMessages({
      history,
      userContent: 'Final attempt',
    });

    // system + user#1 + user#3 + Final = 4 (aborted skipped)
    expect(result).toHaveLength(4);
    expect(result[1].content).toBe('Hi');
    expect(result[2].content).toBe('Try again');

    // Confirm aborted is NOT in output
    const contents = result.map((m) => m.content);
    expect(contents).not.toContain('Partial response...');
  });

  // Also skip other non-sent statuses
  it('skips messages with sending or failed status', () => {
    const history: Message[] = [
      createMessage({ id: '1', role: 'user', content: 'Q1', status: 'sending' }),
      createMessage({ id: '2', role: 'assistant', content: 'A1', status: 'failed' }),
      createMessage({ id: '3', role: 'user', content: 'Q2', status: 'sent' }),
    ];

    const result = assembleMessages({
      history,
      userContent: 'Q3',
    });

    // system + Q2 + Q3 = 3
    expect(result).toHaveLength(3);
    expect(result[1].content).toBe('Q2');
    expect(result[2].content).toBe('Q3');
  });

  // Test 4: Empty history → still has system + user
  it('handles empty history — still includes system and user', () => {
    const result = assembleMessages({
      history: [],
      userContent: 'Solo message',
    });

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe(
      '你是一个乐于助人的 AI 助手,请用中文回答用户问题。',
    );
    expect(result[1]).toEqual({ role: 'user', content: 'Solo message' });
  });

  // Test 5: Attachment text format is correct ([附件:name] wrapped)
  it('formats attachment text correctly with [附件:name] wrapper', () => {
    const attachments: AttachmentText[] = [
      { name: 'a.txt', content: 'AAA' },
      { name: 'b.txt', content: 'BBB' },
    ];

    const result = assembleMessages({
      history: [],
      userContent: 'Check files',
      attachments,
    });

    const content = result[1].content;
    // Exact format
    expect(content).toBe(
      '[附件:a.txt]\nAAA\n[/附件]\n[附件:b.txt]\nBBB\n[/附件]\nCheck files',
    );

    // Order: a.txt before b.txt
    const aIdx = content.indexOf('[附件:a.txt]');
    const bIdx = content.indexOf('[附件:b.txt]');
    expect(aIdx).toBeLessThan(bIdx);
  });

  // Edge: undefined attachments vs empty array
  it('treats undefined attachments as no attachments', () => {
    const result = assembleMessages({
      history: [],
      userContent: 'Plain message',
    });

    expect(result).toHaveLength(2);
    expect(result[1].content).toBe('Plain message');
  });

  // Edge: empty attachments array
  it('treats empty attachments array as no attachments', () => {
    const result = assembleMessages({
      history: [],
      userContent: 'Plain message',
      attachments: [],
    });

    expect(result).toHaveLength(2);
    expect(result[1].content).toBe('Plain message');
  });

  // First message must always be system role
  it('ensures first message is always system role', () => {
    const history: Message[] = [
      createMessage({ role: 'user', content: 'U' }),
    ];

    const result = assembleMessages({ history, userContent: 'V' });

    expect(result[0].role).toBe('system');
  });

  // ===== Skills injection (T8) =====

  it('injects skills as an additional system message after the default prompt', () => {
    const skills: SkillInjection[] = [
      { name: 'summarizer', body: 'Always be concise.' },
      { name: 'reviewer', body: 'Review code carefully.' },
    ];

    const result = assembleMessages({
      history: [],
      userContent: 'Hi',
      skills,
    });

    // system (default) + system (skills) + user = 3
    expect(result).toHaveLength(3);
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe(
      '你是一个乐于助人的 AI 助手,请用中文回答用户问题。',
    );

    const skillMsg = result[1];
    expect(skillMsg.role).toBe('system');
    expect(skillMsg.content).toContain(
      'The following skills are available. Follow their instructions when relevant:',
    );
    // Both skill bodies are present, wrapped under "# Skill: <name>"
    expect(skillMsg.content).toContain('# Skill: summarizer');
    expect(skillMsg.content).toContain('Always be concise.');
    expect(skillMsg.content).toContain('# Skill: reviewer');
    expect(skillMsg.content).toContain('Review code carefully.');
    // Skill blocks are separated by a horizontal rule
    expect(skillMsg.content).toContain('\n\n---\n\n');

    expect(result[2]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('keeps skill order as provided (caller sorts by createdAt)', () => {
    const skills: SkillInjection[] = [
      { name: 'first', body: 'Body-1' },
      { name: 'second', body: 'Body-2' },
      { name: 'third', body: 'Body-3' },
    ];

    const result = assembleMessages({
      history: [],
      userContent: 'Q',
      skills,
    });

    const skillContent = result[1].content;
    const i1 = skillContent.indexOf('# Skill: first');
    const i2 = skillContent.indexOf('# Skill: second');
    const i3 = skillContent.indexOf('# Skill: third');
    expect(i1).toBeLessThan(i2);
    expect(i2).toBeLessThan(i3);
  });

  it('is backward compatible when skills is undefined (no extra system message)', () => {
    const result = assembleMessages({
      history: [],
      userContent: 'Hi',
      // skills intentionally omitted
    });

    // Only default system + user
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('system');
    expect(result[1]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('does not inject skills when array is empty', () => {
    const result = assembleMessages({
      history: [],
      userContent: 'Hi',
      skills: [],
    });

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('system');
    expect(result[1]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('filters out skills with empty or whitespace-only bodies', () => {
    const skills: SkillInjection[] = [
      { name: 'empty', body: '' },
      { name: 'whitespace', body: '   \n\t  ' },
      { name: 'valid', body: 'Real instructions.' },
    ];

    const result = assembleMessages({
      history: [],
      userContent: 'Hi',
      skills,
    });

    // Still injects a skill system message because 'valid' remains
    expect(result).toHaveLength(3);
    const skillContent = result[1].content;
    expect(skillContent).toContain('# Skill: valid');
    expect(skillContent).toContain('Real instructions.');
    expect(skillContent).not.toContain('# Skill: empty');
    expect(skillContent).not.toContain('# Skill: whitespace');
  });

  it('does not inject skill system message when all skill bodies are empty', () => {
    const skills: SkillInjection[] = [
      { name: 'a', body: '' },
      { name: 'b', body: '  ' },
    ];

    const result = assembleMessages({
      history: [],
      userContent: 'Hi',
      skills,
    });

    // No skill system message — back to default + user
    expect(result).toHaveLength(2);
    expect(result[0].content).toBe(
      '你是一个乐于助人的 AI 助手,请用中文回答用户问题。',
    );
  });

  it('trims skill bodies before injecting', () => {
    const skills: SkillInjection[] = [
      { name: 'trimmer', body: '\n  Trim me.  \n' },
    ];

    const result = assembleMessages({
      history: [],
      userContent: 'Hi',
      skills,
    });

    const skillContent = result[1].content;
    // Trimmed body should not carry surrounding whitespace
    expect(skillContent).toContain('# Skill: trimmer\n\nTrim me.');
    expect(skillContent).not.toMatch(/Trim me\.\s+\n/);
  });

  it('combines skills with attachments and history correctly', () => {
    const history: Message[] = [
      createMessage({ id: '1', role: 'user', content: 'Prior question' }),
      createMessage({ id: '2', role: 'assistant', content: 'Prior answer' }),
    ];
    const attachments: AttachmentText[] = [
      { name: 'note.txt', content: 'NOTE' },
    ];
    const skills: SkillInjection[] = [
      { name: 'skill-a', body: 'A instructions.' },
    ];

    const result = assembleMessages({
      history,
      userContent: 'Now',
      attachments,
      skills,
    });

    // system + system(skill) + 2 history + user = 5
    expect(result).toHaveLength(5);
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('system');
    expect(result[1].content).toContain('# Skill: skill-a');
    expect(result[2]).toEqual({ role: 'user', content: 'Prior question' });
    expect(result[3]).toEqual({ role: 'assistant', content: 'Prior answer' });
    expect(result[4].role).toBe('user');
    expect(result[4].content).toContain('[附件:note.txt]');
    expect(result[4].content).toContain('Now');
  });

  // ===== Tool-role message forwarding (verify T2 still intact) =====

  it('forwards tool-role messages from history with their toolCallId', () => {
    const history: Message[] = [
      createMessage({
        id: 'a1',
        role: 'assistant',
        content: '',
        toolCalls: [
          { id: 'call_1', name: 'get_weather', arguments: '{"city":"X"}' },
        ],
      }),
      createMessage({
        id: 't1',
        role: 'tool',
        content: '{"temp":20}',
        toolCallId: 'call_1',
      }),
      createMessage({
        id: 'u1',
        role: 'user',
        content: 'Thanks',
      }),
    ];

    const result = assembleMessages({
      history,
      userContent: 'Next',
    });

    // system + assistant(toolCalls) + tool + user(thanks) + user(next) = 5
    expect(result).toHaveLength(5);
    expect(result[1]).toEqual({
      role: 'assistant',
      content: '',
      toolCalls: [
        { id: 'call_1', name: 'get_weather', arguments: '{"city":"X"}' },
      ],
    });
    expect(result[2]).toEqual({
      role: 'tool',
      content: '{"temp":20}',
      toolCallId: 'call_1',
    });
    expect(result[3]).toEqual({ role: 'user', content: 'Thanks' });
    expect(result[4]).toEqual({ role: 'user', content: 'Next' });
  });

  it('skips tool-role messages that lack a toolCallId', () => {
    const history: Message[] = [
      createMessage({
        id: 't1',
        role: 'tool',
        content: 'orphan',
        // toolCallId intentionally omitted
      }),
      createMessage({ id: 'u1', role: 'user', content: 'Q' }),
    ];

    const result = assembleMessages({
      history,
      userContent: 'Next',
    });

    // system + user(Q) + user(Next) — orphan tool skipped
    expect(result).toHaveLength(3);
    expect(result.map((m) => m.role)).toEqual(['system', 'user', 'user']);
    expect(result.map((m) => m.content)).not.toContain('orphan');
  });

  it('still forwards tool-role messages correctly when skills are injected', () => {
    const history: Message[] = [
      createMessage({
        id: 't1',
        role: 'tool',
        content: 'tool-out',
        toolCallId: 'call_x',
      }),
    ];
    const skills: SkillInjection[] = [{ name: 's', body: 'S body.' }];

    const result = assembleMessages({
      history,
      userContent: 'Q',
      skills,
    });

    // system + system(skill) + tool + user = 4
    expect(result).toHaveLength(4);
    expect(result[0].role).toBe('system');
    expect(result[1].role).toBe('system');
    expect(result[1].content).toContain('# Skill: s');
    expect(result[2]).toEqual({
      role: 'tool',
      content: 'tool-out',
      toolCallId: 'call_x',
    });
    expect(result[3]).toEqual({ role: 'user', content: 'Q' });
  });

  // ===== T26: summary injection =====

  it('injects summary as a third system message after default prompt and skills', () => {
    const summary: SummaryInjection = { text: 'User asked about the weather. Assistant replied it was sunny.' };
    const skills: SkillInjection[] = [{ name: 's1', body: 'Be concise.' }];

    const result = assembleMessages({
      history: [],
      userContent: 'Continue',
      skills,
      summary,
    });

    // system(default) + system(skills) + system(summary) + user = 4
    expect(result).toHaveLength(4);
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe(
      '你是一个乐于助人的 AI 助手,请用中文回答用户问题。',
    );
    expect(result[1].role).toBe('system');
    expect(result[1].content).toContain('# Skill: s1');
    expect(result[2].role).toBe('system');
    // Summary wrapper format: [Previous conversation summary]\n\n<text>
    expect(result[2].content).toBe(
      '[Previous conversation summary]\n\nUser asked about the weather. Assistant replied it was sunny.',
    );
    expect(result[3]).toEqual({ role: 'user', content: 'Continue' });
  });

  it('injects summary even when no skills are provided (summary is the second system message)', () => {
    const summary: SummaryInjection = { text: 'Earlier the user greeted the assistant.' };

    const result = assembleMessages({
      history: [],
      userContent: 'Hi',
      summary,
    });

    // system(default) + system(summary) + user = 3
    expect(result).toHaveLength(3);
    expect(result[1].role).toBe('system');
    expect(result[1].content).toContain('[Previous conversation summary]');
    expect(result[1].content).toContain('Earlier the user greeted the assistant.');
  });

  it('does not inject summary system message when summary text is empty or whitespace-only', () => {
    const result = assembleMessages({
      history: [],
      userContent: 'Hi',
      summary: { text: '   \n\t  ' },
    });

    // Defensive: empty summary is a no-op, back to default + user
    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('system');
    expect(result[1]).toEqual({ role: 'user', content: 'Hi' });
  });

  it('is backward compatible when summary is undefined (no extra system message)', () => {
    const result = assembleMessages({
      history: [],
      userContent: 'Hi',
      // summary intentionally omitted
    });

    expect(result).toHaveLength(2);
    expect(result[0].role).toBe('system');
  });

  // ===== T26: maxTokens truncation =====
  // Note: truncateHistory uses SYSTEM_RESERVE=2000, so maxTokens must exceed
  // 2000 to leave a non-zero historyBudget. Fixtures use messages large enough
  // that total > maxTokens (forcing the truncation path, not the fast path).
  // Each `'x'.repeat(3200)` ≈ 800 tokens + 4 role overhead = 804 tokens.

  it('truncates history when maxTokens budget is exceeded (drops oldest, keeps recent)', () => {
    // 6 messages × ~804 tokens each ≈ 4824 total; maxTokens=4500 leaves
    // historyBudget=2500. Walking newest→oldest keeps the latest 3 messages
    // (≈2412 tokens after chain grouping) and drops the oldest 3.
    const big = 'x'.repeat(3200); // ~800 tokens + 4 overhead = 804
    const history: Message[] = [
      createMessage({ id: 'm0', role: 'user', content: `OLD_Q1-${big}` }),
      createMessage({ id: 'm1', role: 'assistant', content: `OLD_A1-${big}` }),
      createMessage({ id: 'm2', role: 'user', content: `OLD_Q2-${big}` }),
      createMessage({ id: 'm3', role: 'assistant', content: `NEW_A2-${big}` }),
      createMessage({ id: 'm4', role: 'user', content: `NEW_Q3-${big}` }),
      createMessage({ id: 'm5', role: 'assistant', content: `NEW_A3-${big}` }),
    ];

    const result = assembleMessages({
      history,
      userContent: 'Current question',
      maxTokens: 4500,
    });

    // system + (3 kept history) + user = 5
    expect(result).toHaveLength(5);
    expect(result[0].role).toBe('system');

    // Oldest three MUST be dropped; newest three MUST survive.
    const contents = result.map((m) => m.content);
    expect(contents).not.toContain(`OLD_Q1-${big}`);
    expect(contents).not.toContain(`OLD_A1-${big}`);
    expect(contents).not.toContain(`OLD_Q2-${big}`);
    expect(contents).toContain(`NEW_A2-${big}`);
    expect(contents).toContain(`NEW_Q3-${big}`);
    expect(contents).toContain(`NEW_A3-${big}`);

    // Final user message is always appended after history.
    expect(result[result.length - 1]).toEqual({
      role: 'user',
      content: 'Current question',
    });
  });

  it('does NOT truncate when total tokens fit within maxTokens (fast path)', () => {
    // Small history: total << maxTokens. Fast path returns everything unchanged.
    const history: Message[] = [
      createMessage({ id: '1', role: 'user', content: 'Hi' }),
      createMessage({ id: '2', role: 'assistant', content: 'Hello!' }),
    ];

    const result = assembleMessages({
      history,
      userContent: 'Next',
      maxTokens: 4000, // >> total, no truncation
    });

    // system + 2 history + user = 4 (same as without maxTokens)
    expect(result).toHaveLength(4);
    expect(result[1]).toEqual({ role: 'user', content: 'Hi' });
    expect(result[2]).toEqual({ role: 'assistant', content: 'Hello!' });
    expect(result[3]).toEqual({ role: 'user', content: 'Next' });
  });

  it('treats maxTokens=0 / negative / undefined as no truncation (backward compatible)', () => {
    const history: Message[] = [
      createMessage({ id: '1', role: 'user', content: 'Q1' }),
      createMessage({ id: '2', role: 'assistant', content: 'A1' }),
    ];

    // undefined — no truncation branch
    const r1 = assembleMessages({ history, userContent: 'Next' });
    // maxTokens = 0 — falsy guard, no truncation
    const r2 = assembleMessages({ history, userContent: 'Next', maxTokens: 0 });
    // negative — guard requires > 0
    const r3 = assembleMessages({ history, userContent: 'Next', maxTokens: -100 });

    for (const r of [r1, r2, r3]) {
      expect(r).toHaveLength(4); // system + 2 history + user
      expect(r[1]).toEqual({ role: 'user', content: 'Q1' });
      expect(r[2]).toEqual({ role: 'assistant', content: 'A1' });
    }
  });

  // ===== T26: combined scenario (skill + summary + truncation) =====

  it('combines skills + summary + truncation in one assembly', () => {
    // Same budget math as the truncation test above: 6 × 804 = 4824 tokens,
    // maxTokens=4500 keeps the newest 3 and drops the oldest 3.
    const big = 'y'.repeat(3200);
    const history: Message[] = [
      createMessage({ id: 'o1', role: 'user', content: `OLD_Q1-${big}` }),
      createMessage({ id: 'o2', role: 'assistant', content: `OLD_A1-${big}` }),
      createMessage({ id: 'o3', role: 'user', content: `OLD_Q2-${big}` }),
      createMessage({ id: 'n1', role: 'assistant', content: `NEW_A2-${big}` }),
      createMessage({ id: 'n2', role: 'user', content: `NEW_Q3-${big}` }),
      createMessage({ id: 'n3', role: 'assistant', content: `NEW_A3-${big}` }),
    ];
    const skills: SkillInjection[] = [
      { name: 'reviewer', body: 'Always review carefully.' },
    ];
    const summary: SummaryInjection = {
      text: 'The user previously asked about T26 integration.',
    };

    const result = assembleMessages({
      history,
      userContent: 'Final question',
      skills,
      summary,
      maxTokens: 4500,
    });

    // Expect: system + system(skill) + system(summary) + (3 kept history) + user = 7
    expect(result).toHaveLength(7);
    expect(result[0].role).toBe('system');
    expect(result[0].content).toBe(
      '你是一个乐于助人的 AI 助手,请用中文回答用户问题。',
    );
    expect(result[1].role).toBe('system');
    expect(result[1].content).toContain('# Skill: reviewer');
    expect(result[2].role).toBe('system');
    expect(result[2].content).toContain('[Previous conversation summary]');
    expect(result[2].content).toContain('T26 integration');

    // Truncation dropped the oldest pair; the newest three survive.
    const contents = result.map((m) => m.content);
    expect(contents).not.toContain(`OLD_Q1-${big}`);
    expect(contents).not.toContain(`OLD_A1-${big}`);
    expect(contents).not.toContain(`OLD_Q2-${big}`);
    expect(contents).toContain(`NEW_A2-${big}`);
    expect(contents).toContain(`NEW_Q3-${big}`);
    expect(contents).toContain(`NEW_A3-${big}`);

    // Last message is the current user input.
    expect(result[result.length - 1]).toEqual({
      role: 'user',
      content: 'Final question',
    });
  });

  // ===== T26: tool chain intact after truncation =====

  it('preserves assistant+tool chains in the surviving history after truncation', () => {
    // Three tool-call rounds. Each chain = empty assistant (4 tokens) + tool
    // result (~1200 tokens) ≈ 1208 per chain, total ≈ 3624. maxTokens=3400
    // leaves historyBudget=1400, enough for exactly one chain (the newest).
    const big = 'z'.repeat(4800); // ~1200 tokens + 4 overhead = 1204
    const history: Message[] = [
      createMessage({
        id: 'a1',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_1', name: 'get_weather', arguments: '{"city":"A"}' }],
      }),
      createMessage({
        id: 't1',
        role: 'tool',
        content: `R1-${big}`,
        toolCallId: 'call_1',
      }),
      createMessage({
        id: 'a2',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_2', name: 'get_weather', arguments: '{"city":"B"}' }],
      }),
      createMessage({
        id: 't2',
        role: 'tool',
        content: `R2-${big}`,
        toolCallId: 'call_2',
      }),
      createMessage({
        id: 'a3',
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'call_3', name: 'get_weather', arguments: '{"city":"C"}' }],
      }),
      createMessage({
        id: 't3',
        role: 'tool',
        content: `R3-${big}`,
        toolCallId: 'call_3',
      }),
    ];

    const result = assembleMessages({
      history,
      userContent: 'Summarize',
      maxTokens: 3400,
    });

    // The first system message + final user; the surviving history keeps the
    // most recent tool chain (assistant with toolCalls + tool with matching id).
    const survivingAssistant = result.find(
      (m) => m.role === 'assistant' && m.toolCalls && m.toolCalls.length > 0,
    );
    const survivingTool = result.find((m) => m.role === 'tool');

    expect(survivingAssistant).toBeDefined();
    expect(survivingTool).toBeDefined();
    // The kept tool MUST reference the kept assistant's toolCall id — never orphaned.
    expect(survivingAssistant!.toolCalls![0].id).toBe(survivingTool!.toolCallId);

    // The dropped (older) chains must NOT appear.
    const toolCallIds = result
      .filter((m) => m.role === 'tool')
      .map((m) => m.toolCallId);
    expect(toolCallIds).toHaveLength(1);
    // Only the newest call_3 survives; call_1 and call_2 were truncated away.
    expect(toolCallIds[0]).toBe('call_3');

    // No orphan tool message without a preceding assistant tool-call turn.
    const roles = result.map((m) => m.role);
    const toolIdx = roles.indexOf('tool');
    expect(roles[toolIdx - 1]).toBe('assistant');
  });
});
