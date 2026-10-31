import { HttpError } from '../middleware/error.js';

/**
 * In-memory registry of active user-facing SSE streams.
 *
 * SEMANTICS:
 * One user-facing SSE stream = one registry entry per session.
 *
 * Agent-loop internal LLM calls share the session's AbortController —
 * they do NOT call `registerStream`/`unregisterStream` (that would
 * conflict with the user-facing stream singleton). Instead, they read
 * the signal via `getStreamSignal()` to detect user abort.
 */
const activeStreams = new Map<string, AbortController>();

/**
 * Register a new active stream for a session.
 *
 * @throws HttpError(409) if a stream is already active for this session.
 * @returns The AbortController for the stream.
 */
export function registerStream(sessionId: string): AbortController {
  if (activeStreams.has(sessionId)) {
    throw new HttpError(409, 'Another stream is active for this session');
  }
  const ac = new AbortController();
  activeStreams.set(sessionId, ac);
  return ac;
}

/**
 * Remove a stream from the registry (cleanup after stream ends).
 * 同时关闭该会话 Run 的事件缓冲与重连 sink（无缓冲时为 no-op）。
 */
export function unregisterStream(sessionId: string): void {
  activeStreams.delete(sessionId);
  closeRun(sessionId);
}

/**
 * Abort an active stream by session ID.
 *
 * @returns `true` if a stream was found and aborted, `false` otherwise.
 */
export function abortStream(sessionId: string): boolean {
  const ac = activeStreams.get(sessionId);
  if (!ac) return false;
  ac.abort();
  activeStreams.delete(sessionId);
  return true;
}

/**
 * Read the AbortSignal for an active stream without affecting registry state.
 *
 * Used by the agent loop to observe user-initiated aborts without owning the
 * stream lifecycle (the user-facing SSE handler remains the registry owner).
 *
 * @returns The signal for the active stream, or `null` if none is registered.
 */
export function getStreamSignal(sessionId: string): AbortSignal | null {
  const ac = activeStreams.get(sessionId);
  return ac ? ac.signal : null;
}

/**
 * Get the current number of active streams (for graceful shutdown).
 */
export function getActiveStreamCount(): number {
  return activeStreams.size;
}

// ---------------------------------------------------------------------------
// Run 事件缓冲 / waiting 标志 / 重连 sink（问答卡片刷新存活设计，见
// docs/2026-10-31-question-card-design.md 规范 §5）
// ---------------------------------------------------------------------------

/** 单个 SSE 事件的 wire 形态（缓冲与 sink 传输的最小单元）。 */
export interface RunEventFrame {
  event: string;
  data: string;
}

/** 重连客户端（GET /api/sessions/:id/events）的写入端。 */
export interface RunEventSink {
  write(frame: RunEventFrame): Promise<void>;
  close(): void;
}

interface RunBufferState {
  frames: RunEventFrame[];
  approxBytes: number;
  waiting: boolean;
  sinks: Set<RunEventSink>;
}

const MAX_RUN_BUFFER_FRAMES = 2000;
const MAX_RUN_BUFFER_BYTES = 512 * 1024;
const TERMINAL_SSE_EVENTS = new Set(['done', 'error', 'aborted']);

const runBuffers = new Map<string, RunBufferState>();

function ensureBuffer(sessionId: string): RunBufferState {
  let state = runBuffers.get(sessionId);
  if (!state) {
    state = { frames: [], approxBytes: 0, waiting: false, sinks: new Set() };
    runBuffers.set(sessionId, state);
  }
  return state;
}

/**
 * 追加一条 SSE 事件：入缓冲并扇出给所有重连 sink。
 * 主连接断开后扇出写失败会静默移除该 sink（Run 继续运行）。
 */
export function appendRunEvent(sessionId: string, frame: RunEventFrame): void {
  const state = ensureBuffer(sessionId);
  state.frames.push(frame);
  state.approxBytes += frame.event.length + frame.data.length + 16;
  while (
    state.frames.length > MAX_RUN_BUFFER_FRAMES ||
    state.approxBytes > MAX_RUN_BUFFER_BYTES
  ) {
    const dropped = state.frames.shift();
    if (!dropped) break;
    state.approxBytes -= dropped.event.length + dropped.data.length + 16;
  }
  if (TERMINAL_SSE_EVENTS.has(frame.event)) state.waiting = false;
  for (const sink of state.sinks) {
    void sink.write(frame).catch(() => {
      state.sinks.delete(sink);
    });
  }
}

/**
 * 等待期标志：Run 挂起等用户输入（ask_user / 工具确认）时为 true。
 * 断连豁免（lifecycle onAbort）据此决定是否中止 Run。
 */
export function setRunWaiting(sessionId: string, waiting: boolean): void {
  ensureBuffer(sessionId).waiting = waiting;
}

export function isRunWaiting(sessionId: string): boolean {
  return runBuffers.get(sessionId)?.waiting ?? false;
}

/** 该会话是否有活动 Run（供重连端点判断 idle / 重放）。 */
export function hasActiveRun(sessionId: string): boolean {
  return activeStreams.has(sessionId);
}

/**
 * 挂接重连 sink，返回需重放的既有缓冲帧（副本）。
 * 同步完成「拷贝 + 注册」，无事件丢失窗口。
 */
export function attachRunSink(
  sessionId: string,
  sink: RunEventSink,
): RunEventFrame[] {
  const state = ensureBuffer(sessionId);
  const replay = [...state.frames];
  state.sinks.add(sink);
  return replay;
}

export function detachRunSink(sessionId: string, sink: RunEventSink): void {
  runBuffers.get(sessionId)?.sinks.delete(sink);
}

/** Run 收尾：关闭全部重连 sink 并清空缓冲。 */
export function closeRun(sessionId: string): void {
  const state = runBuffers.get(sessionId);
  if (!state) return;
  runBuffers.delete(sessionId);
  for (const sink of state.sinks) {
    try {
      sink.close();
    } catch {
      // sink 自身清理失败不阻断其余 sink
    }
  }
  state.sinks.clear();
}
