import { describe, it, expect } from 'vitest';
import { assembleMessages, type AttachmentText } from '../assembler.js';
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
});
