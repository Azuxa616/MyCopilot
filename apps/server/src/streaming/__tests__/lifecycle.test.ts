import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Context } from 'hono';

// ---------------------------------------------------------------------------
// Mock all dependencies BEFORE importing the module under test
// ---------------------------------------------------------------------------

const mockRepo = {
  createMessage: vi.fn(),
  updateMessage: vi.fn(),
  updateMessageContent: vi.fn(),
};

const mockAdapter = {
  chatCompletionStream: vi.fn(),
};

const mockGetAdapter = vi.fn();

const mockAssembleMessages = vi.fn();

const mockRegisterStream = vi.fn();
const mockUnregisterStream = vi.fn();

// Track SSE writes for assertions
let sseWrites: Array<{ event: string; data: string }> = [];
let onAbortCallback: (() => void) | null = null;

const mockStream = {
  writeSSE: vi.fn(async (evt: { event: string; data: string }) => {
    sseWrites.push(evt);
  }),
  onAbort: vi.fn((cb: () => void) => {
    onAbortCallback = cb;
  }),
};

const mockStreamSSE = vi.fn();

vi.mock('../../repo/message.js', () => mockRepo);
vi.mock('../../llm/index.js', () => ({
  getAdapter: mockGetAdapter,
}));
vi.mock('../../prompt/assembler.js', () => ({
  assembleMessages: mockAssembleMessages,
}));
vi.mock('../registry.js', () => ({
  registerStream: mockRegisterStream,
  unregisterStream: mockUnregisterStream,
}));
vi.mock('hono/streaming', () => ({
  streamSSE: mockStreamSSE,
}));

// Dynamic import after mocks are set up
const { streamMessageHandler } = await import('../lifecycle.js');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Flush pending microtasks so async generator loop completes. */
function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeContext(): Context {
  return {} as unknown as Context;
}

function makeParams(overrides: Record<string, unknown> = {}) {
  return {
    sessionId: 'test-session',
    userMessage: {
      id: 'user-msg-1',
      sessionId: 'test-session',
      role: 'user' as const,
      content: 'Hello',
      attachments: [],
      status: 'sent' as const,
      createdAt: 1000,
    },
    provider: {
      id: 'prov-1',
      name: 'OpenAI',
      type: 'openai' as const,
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'sk-test',
      enabled: true,
      createdAt: 1000,
      updatedAt: 1000,
    },
    model: {
      id: 'model-1',
      providerId: 'prov-1',
      name: 'gpt-4',
      enabled: true,
      createdAt: 1000,
      updatedAt: 1000,
    },
    history: [],
    ...overrides,
  };
}

/**
 * Standard setup for a normal (success) completion scenario.
 * After calling this, call streamMessageHandler then await flushMicrotasks().
 */
function setupNormalCompletion(chunks: string[] = ['Hello', ' ', 'World']) {
  const ac = new AbortController();
  mockRegisterStream.mockReturnValue(ac);

  // Clear all mocks first
  sseWrites = [];
  onAbortCallback = null;
  mockStream.writeSSE.mockClear();
  mockStream.onAbort.mockClear();
  mockStreamSSE.mockClear();
  mockRepo.createMessage.mockClear();
  mockRepo.updateMessage.mockClear();
  mockRepo.updateMessageContent.mockClear();
  mockAssembleMessages.mockClear();
  mockGetAdapter.mockClear();
  mockRegisterStream.mockClear();
  mockUnregisterStream.mockClear();
  mockAdapter.chatCompletionStream.mockClear();

  // Set up mock returns AFTER clearing
  mockRegisterStream.mockReturnValue(ac);

  mockRepo.createMessage
    .mockReturnValueOnce({
      id: 'user-msg-1',
      sessionId: 'test-session',
      role: 'user',
      content: 'Hello',
      attachments: [],
      status: 'sent',
      createdAt: 1000,
    })
    .mockReturnValueOnce({
      id: 'assistant-msg-1',
      sessionId: 'test-session',
      role: 'assistant',
      content: '',
      status: 'sending',
      createdAt: 1001,
    });

  mockAssembleMessages.mockReturnValue([
    { role: 'system', content: 'test system prompt' },
    { role: 'user', content: 'Hello' },
  ]);

  mockGetAdapter.mockReturnValue(mockAdapter);

  async function* generator() {
    for (const chunk of chunks) {
      yield chunk;
    }
  }
  mockAdapter.chatCompletionStream.mockReturnValue(generator());

  // streamSSE calls callback, returns Response.
  // Errors in callback are caught to prevent unhandled rejections.
  mockStreamSSE.mockImplementation(
    (_c: unknown, cb: (stream: typeof mockStream) => Promise<void>) => {
      cb(mockStream).catch(() => {
        // streamSSE handles errors internally
      });
      return new Response(null, { status: 200 });
    },
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Stream Message Lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sseWrites = [];
    onAbortCallback = null;
  });

  // --- Test 1: Normal completion ---
  it('normal completion: status=sent, SSE delta×N + done', async () => {
    setupNormalCompletion(['Hello', ' ', 'World']);

    const c = makeContext();
    const params = makeParams();
    streamMessageHandler(c, params);

    // Wait for async generator loop to complete
    await flushMicrotasks();

    // User message saved
    expect(mockRepo.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'user', status: 'sent' }),
    );

    // Assistant placeholder created
    expect(mockRepo.createMessage).toHaveBeenCalledWith(
      expect.objectContaining({ role: 'assistant', content: '', status: 'sending' }),
    );

    // assembleMessages called
    expect(mockAssembleMessages).toHaveBeenCalled();

    // getAdapter called with provider type
    expect(mockGetAdapter).toHaveBeenCalledWith('openai');

    // registerStream called
    expect(mockRegisterStream).toHaveBeenCalledWith('test-session');

    // Check SSE events
    const deltaEvents = sseWrites.filter((w) => w.event === 'delta');
    expect(deltaEvents).toHaveLength(3);
    expect(JSON.parse(deltaEvents[0].data)).toEqual({ content: 'Hello' });
    expect(JSON.parse(deltaEvents[1].data)).toEqual({ content: ' ' });
    expect(JSON.parse(deltaEvents[2].data)).toEqual({ content: 'World' });

    const doneEvents = sseWrites.filter((w) => w.event === 'done');
    expect(doneEvents).toHaveLength(1);
    expect(JSON.parse(doneEvents[0].data)).toEqual({ messageId: 'assistant-msg-1' });

    // Final persist
    expect(mockRepo.updateMessage).toHaveBeenCalledWith('assistant-msg-1', {
      content: 'Hello World',
      status: 'sent',
    });

    // unregisterStream called
    expect(mockUnregisterStream).toHaveBeenCalledWith('test-session');
  });

  // --- Test 2: Adapter throws error ---
  it('adapter error: status=failed, SSE error event', async () => {
    setupNormalCompletion([]);

    // Override: make generator throw after yielding partial content
    async function* errorGenerator() {
      yield 'partial';
      throw new Error('API connection failed');
    }
    mockAdapter.chatCompletionStream.mockReturnValue(errorGenerator());

    const c = makeContext();
    const params = makeParams();
    streamMessageHandler(c, params);

    await flushMicrotasks();

    // Should have error event
    const errEvents = sseWrites.filter((w) => w.event === 'error');
    expect(errEvents).toHaveLength(1);
    const errData = JSON.parse(errEvents[0].data);
    expect(errData.code).toBe('stream_error');
    expect(errData.message).toContain('API connection failed');

    // Status should be 'failed' with partial content
    expect(mockRepo.updateMessage).toHaveBeenCalledWith('assistant-msg-1', {
      content: 'partial',
      status: 'failed',
      error: 'API connection failed',
    });

    // No done event
    expect(sseWrites.filter((w) => w.event === 'done')).toHaveLength(0);

    // unregisterStream still called
    expect(mockUnregisterStream).toHaveBeenCalledWith('test-session');
  });

  // --- Test 3: Abort ---
  it('abort: status=aborted, SSE aborted event, partial content saved', async () => {
    setupNormalCompletion([]);

    const ac = new AbortController();
    mockRegisterStream.mockReturnValue(ac);

    // Generator yields one chunk, then aborts and throws AbortError
    async function* abortableGenerator() {
      yield 'partial-content';
      ac.abort(); // sets ac.signal.aborted = true
      throw Object.assign(new Error('The operation was aborted.'), {
        name: 'AbortError',
      });
    }
    mockAdapter.chatCompletionStream.mockReturnValue(abortableGenerator());

    const c = makeContext();
    const params = makeParams();
    streamMessageHandler(c, params);

    await flushMicrotasks();

    // Should have delta for partial content
    const deltaEvents = sseWrites.filter((w) => w.event === 'delta');
    expect(deltaEvents).toHaveLength(1);

    // Should have aborted event
    const abortedEvents = sseWrites.filter((w) => w.event === 'aborted');
    expect(abortedEvents).toHaveLength(1);
    const abortedData = JSON.parse(abortedEvents[0].data);
    expect(abortedData.messageId).toBe('assistant-msg-1');
    expect(abortedData.partialContent).toBe('partial-content');

    // Status should be 'aborted' with partial content
    expect(mockRepo.updateMessage).toHaveBeenCalledWith('assistant-msg-1', {
      content: 'partial-content',
      status: 'aborted',
    });

    // No done/error events
    expect(sseWrites.filter((w) => w.event === 'done')).toHaveLength(0);
    expect(sseWrites.filter((w) => w.event === 'error')).toHaveLength(0);

    // unregisterStream called
    expect(mockUnregisterStream).toHaveBeenCalledWith('test-session');
  });

  // --- Test 4: Incremental persist (fast chunks, no per-chunk DB write) ---
  it('incremental persist: fast chunks within 1s → only 1 final DB write', async () => {
    setupNormalCompletion(['a', 'b', 'c', 'd', 'e']);

    const c = makeContext();
    const params = makeParams();
    streamMessageHandler(c, params);

    await flushMicrotasks();

    // updateMessageContent should NOT be called — all chunks complete in <1s
    expect(mockRepo.updateMessageContent).not.toHaveBeenCalled();

    // Final updateMessage should have the full content
    expect(mockRepo.updateMessage).toHaveBeenCalledWith('assistant-msg-1', {
      content: 'abcde',
      status: 'sent',
    });

    // All 5 deltas + 1 done
    expect(sseWrites.filter((w) => w.event === 'delta')).toHaveLength(5);
    expect(sseWrites.filter((w) => w.event === 'done')).toHaveLength(1);
  });

  // --- Test 5: stream.onAbort callback is registered ---
  it('stream.onAbort is registered', async () => {
    setupNormalCompletion(['hello']);

    const c = makeContext();
    const params = makeParams();
    streamMessageHandler(c, params);

    // Wait for async writeSSE (placeholder event) to complete
    await flushMicrotasks();

    expect(mockStream.onAbort).toHaveBeenCalled();
    expect(onAbortCallback).toBeInstanceOf(Function);
  });

  // --- Test 6: unregisterStream called in finally even on error ---
  it('unregisterStream called in finally even on error', async () => {
    setupNormalCompletion([]);

    // Make updateMessage throw to simulate DB error during success path
    mockRepo.updateMessage.mockImplementation(() => {
      throw new Error('DB write failed');
    });

    const c = makeContext();
    const params = makeParams();

    streamMessageHandler(c, params);
    await flushMicrotasks();

    // unregisterStream still called (finally block)
    expect(mockUnregisterStream).toHaveBeenCalledWith('test-session');
  });
});
