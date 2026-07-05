import { describe, it, expect } from 'vitest';
import type {
  MessageRole,
  MessageStatus,
  AttachmentMeta,
  Message,
  Session,
  SessionSummary,
  CreateSessionParams,
  SendMessageParams,
} from '../session.js';

describe('Session types', () => {
  it('MessageStatus should include aborted', () => {
    const status: MessageStatus = 'aborted';
    expect(status).toBe('aborted');
  });

  it('MessageStatus should include sending, sent, failed', () => {
    const sending: MessageStatus = 'sending';
    const sent: MessageStatus = 'sent';
    const failed: MessageStatus = 'failed';
    expect(sending).toBe('sending');
    expect(sent).toBe('sent');
    expect(failed).toBe('failed');
  });

  it('MessageRole should be user, assistant, or system', () => {
    const user: MessageRole = 'user';
    const assistant: MessageRole = 'assistant';
    const system: MessageRole = 'system';
    expect(user).toBe('user');
    expect(assistant).toBe('assistant');
    expect(system).toBe('system');
  });

  it('should create a valid Message object', () => {
    const msg: Message = {
      id: 'msg-1',
      sessionId: 'session-1',
      role: 'user',
      content: 'Hello',
      attachments: [],
      status: 'sent',
      createdAt: 1000,
    };
    expect(msg.id).toBe('msg-1');
    expect(msg.sessionId).toBe('session-1');
    expect(msg.attachments).toEqual([]);
  });

  it('should create a valid Session object', () => {
    const session: Session = {
      id: 'session-1',
      title: 'Test',
      modelId: null,
      createdAt: 1000,
      updatedAt: 1000,
    };
    expect(session.title).toBe('Test');
    expect(session.modelId).toBeNull();
  });

  it('should create a valid SessionSummary', () => {
    const summary: SessionSummary = {
      id: 'session-1',
      title: 'Test',
      modelId: 'gpt-4',
      createdAt: 1000,
      updatedAt: 1000,
      messageCount: 5,
    };
    expect(summary.messageCount).toBe(5);
  });

  it('should create valid CreateSessionParams', () => {
    const params: CreateSessionParams = {
      title: 'New Session',
      modelId: null,
    };
    expect(params.title).toBe('New Session');
  });

  it('should create valid SendMessageParams', () => {
    const params: SendMessageParams = {
      content: 'Hello',
    };
    expect(params.content).toBe('Hello');
  });

  it('should create a valid AttachmentMeta', () => {
    const attachment: AttachmentMeta = {
      name: 'file.txt',
      type: 'text/plain',
      size: 100,
      textExcerpt: 'Hello world',
    };
    expect(attachment.name).toBe('file.txt');
  });
});
