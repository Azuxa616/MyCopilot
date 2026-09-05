// Zustand - Session state management
import { create } from 'zustand';
import type { Session, SessionSummary, CreateSessionParams, Message } from '@my-copilot/shared';
import { api } from '../api';
import { parseSSEStream, type ConfirmationEventData } from '../utils/streamUtils';
import type { MessageWithTimeline, TimelineEntry } from '../types/timeline';

// Sentinel value for a "pending" (not-yet-created) session
export const NEW_SESSION_SENTINEL = '__new__';

/**
 * Find the last assistant message still in 'sending' state within a session's cache.
 * Returns its id, or undefined if none. Shared by the SSE callbacks in sendMessage.
 */
function findSendingAssistantId(messages: Message[]): string | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role === 'assistant' && m.status === 'sending') return m.id;
    }
    return undefined;
}

// ---------------------------------------------------------------------------
// Agent 状态机（RFC agent-loop-v2 §7：SSE 事件到 UI 状态的可推导投影）
// ---------------------------------------------------------------------------

/** 前端 Agent 状态机状态；语义对齐 RFC §7，与后端 RunStatus 不直接共用枚举。 */
export type AgentState = 'idle' | 'thinking' | 'tool_running' | 'responding' | 'error' | 'cancelled';

/** 驱动状态机的触发事件，与 SSE 流生命周期 1:1。 */
export type AgentStateTrigger =
    | 'send'
    | 'content_delta'
    | 'tool_call_start'
    | 'tool_call_done'
    | 'stream_done'
    | 'stream_error'
    | 'stream_aborted';

/** 当前轮单个工具调用的进度（tool_call_start → tool_result），供 UI 渲染。 */
export interface ActiveToolCall {
    id: string;
    name: string;
    status: 'running' | 'done';
}

/**
 * 前端本地的 assistant 消息扩展（过程时间线）从 types/timeline.ts 导入；
 * 仅存在于前端消息缓存用于渲染，不持久化、不上行 server（刷新后由
 * utils/timeline.ts 从服务端消息重建，reasoning 除外）。
 */

/**
 * 状态机转移表（RFC agent-loop-v2 §7）。非法前置状态保持不变：
 *
 * | trigger          | 转移                                        |
 * |------------------|---------------------------------------------|
 * | send             | idle → thinking（非 idle 保持）             |
 * | content_delta    | thinking / tool_running → responding        |
 * | tool_call_start  | thinking / responding → tool_running        |
 * | tool_call_done   | 保持（等 content_delta 回 responding）      |
 * | stream_done      | 任意 → idle                                 |
 * | stream_error     | 任意 → error                                |
 * | stream_aborted   | 任意 → cancelled                            |
 */
export function transitionAgentState(current: AgentState, trigger: AgentStateTrigger): AgentState {
    switch (trigger) {
        case 'send':
            return current === 'idle' ? 'thinking' : current;
        case 'content_delta':
            return current === 'thinking' || current === 'tool_running' ? 'responding' : current;
        case 'tool_call_start':
            return current === 'thinking' || current === 'responding' ? 'tool_running' : current;
        case 'tool_call_done':
            return current;
        case 'stream_done':
            return 'idle';
        case 'stream_error':
            return 'error';
        case 'stream_aborted':
            return 'cancelled';
    }
}

/** 终态触发：进入终态的同时清空当前轮 activeToolCalls。 */
const TERMINAL_AGENT_TRIGGERS: ReadonlyArray<AgentStateTrigger> = [
    'stream_done',
    'stream_error',
    'stream_aborted',
];

/**
 * tool_call_start 只携带 (messageId, index)，尚无工具调用 id/name；
 * 先用组合键占位，tool_call_done 到达后再替换为服务端真实 id。
 */
function toolCallKey(messageId: string, index: number): string {
    return `${messageId}:${index}`;
}

interface SessionStore {
    // State - layered loading architecture
    sessionSummaries: SessionSummary[];
    currentSession: Session | null;
    messagesCache: Record<string, Message[]>;
    selectedSessionId: string;
    isSending: boolean;
    isLoadingSummaries: boolean;
    isLoadingMessages: boolean;
    abortController: AbortController | null;
    /** Model selected for the pending (not-yet-created) session */
    pendingModelId: string | null;
    /**
     * Job id of an in-flight background job (async send mode), or null.
     * ChatShell feeds this to `useJobStream` to subscribe to job progress.
     */
    activeJobId: string | null;
    /**
     * Pending tool confirmation data received via SSE `confirmation_required`.
     * When non-null, the ToolConfirmationDialog is shown.
     */
    pendingConfirmation: ConfirmationEventData | null;
    /** 当前 Agent 状态机状态（初始 idle；终态侧边状态为 error / cancelled）。 */
    agentState: AgentState;
    /** 当前轮工具调用进度（T13 渲染用；终态触发时清空）。 */
    activeToolCalls: ActiveToolCall[];

    // Actions - session list (layered loading)
    loadSessionSummaries: () => Promise<void>;
    loadSessionMessages: (sessionId: string) => Promise<void>;
    setSessionSummaries: (summaries: SessionSummary[]) => void;
    addSessionSummary: (summary: SessionSummary) => void;
    updateSessionSummary: (id: string, updates: Partial<SessionSummary>) => void;
    deleteSessionSummary: (id: string) => void;

    // Actions - session selection
    setSelectedSessionId: (id: string) => void;
    /** Enter "new session" mode without creating on backend */
    enterNewSession: () => void;
    /** Set model for pending session */
    setPendingModelId: (modelId: string | null) => void;
    /** Set/clear the active background job id (async send mode). */
    setActiveJobId: (jobId: string | null) => void;

    // Actions - message operations
    addMessage: (sessionId: string, message: Message) => void;
    /** updates 额外接受前端本地字段 timeline（过程时间线渲染，见 MessageWithTimeline）。 */
    updateMessage: (sessionId: string, messageId: string, updates: Partial<MessageWithTimeline>) => void;
    deleteMessage: (sessionId: string, messageId: string) => void;

    // Actions - business methods
    createSession: (params?: CreateSessionParams) => Promise<Session>;
    updateSession: (id: string, updates: Partial<CreateSessionParams>) => Promise<void>;
    sendMessage: (params: { sessionId: string; content: string; files?: File[] }) => Promise<void>;
    cancelStream: () => void;
    /** Resolve a pending tool confirmation (user clicked allow/deny). */
    resolveConfirmation: (approvalId: string, approved: boolean) => Promise<void>;
}

export const useSessionStore = create<SessionStore>()((set, get) => {
    /** 应用一次状态机转移；终态触发同时清空 activeToolCalls。 */
    const transition = (trigger: AgentStateTrigger): void => {
        set((state) => {
            const patch: { agentState: AgentState; activeToolCalls?: ActiveToolCall[] } = {
                agentState: transitionAgentState(state.agentState, trigger),
            };
            if (TERMINAL_AGENT_TRIGGERS.includes(trigger)) {
                patch.activeToolCalls = [];
            }
            return patch;
        });
    };

    /**
     * 把会话内最后一条 sending 状态的 assistant 占位消息收尾为 aborted。
     *
     * 回归修复：用户点击停止（或流异常断开）时，SSE 终态事件（done/error/
     * aborted）往往不会到达前端 —— cancelStream 主动断开 fetch 后
     * parseSSEStream 会静默返回，服务端写往已关闭连接的事件也无人接收。
     * 修复前占位消息会永远停留在 sending 状态，并保留 agent loop
     * 多轮拼接的全文（"好的，我来调用…好的，我再调用…"）。
     * 幂等：消息一旦离开 sending 状态，findSendingAssistantId 即不再命中。
     */
    const markSendingAssistantAborted = (sessionId: string): void => {
        const messages = get().messagesCache[sessionId] || [];
        const sendingId = findSendingAssistantId(messages);
        if (sendingId) {
            get().updateMessage(sessionId, sendingId, { status: 'aborted' });
        }
    };

    /**
     * 时间线维护（过程时间线设计的 store 侧核心）：对 sending assistant
     * 消息的 timeline 字段做函数式更新。所有 SSE 过程回调（reasoning /
     * delta / tool_call_* / tool_result / 终态收尾）经由这里读写条目。
     */
    const updateTimeline = (
        sessionId: string,
        fn: (entries: TimelineEntry[]) => TimelineEntry[],
    ): void => {
        const messages = get().messagesCache[sessionId] || [];
        const sendingId = findSendingAssistantId(messages);
        if (!sendingId) return;
        const msg = messages.find((m) => m.id === sendingId) as MessageWithTimeline;
        get().updateMessage(sessionId, sendingId, { timeline: fn(msg.timeline ?? []) });
    };

    /** 把最后一个未收尾的 reasoning 条目标记为 done（回答/工具开始时调用）。 */
    const closeOpenReasoning = (sessionId: string): void => {
        updateTimeline(sessionId, (entries) => {
            const last = entries[entries.length - 1];
            if (last?.kind === 'reasoning' && !last.done) {
                return [...entries.slice(0, -1), { ...last, done: true }];
            }
            return entries;
        });
    };

    /** 终态收尾：仍在 running 的工具条目落定（error 终态标 error，其余标 done）。 */
    const finalizeTimeline = (sessionId: string, asError: boolean): void => {
        updateTimeline(sessionId, (entries) =>
            entries.map((e) =>
                e.kind === 'tool' && e.status === 'running'
                    ? { ...e, status: asError ? 'error' : 'done' as const, endedAt: e.endedAt ?? Date.now() }
                    : e,
            ),
        );
    };

    return {
        // Initial state - layered loading architecture
        sessionSummaries: [],
        currentSession: null,
        messagesCache: {},
        selectedSessionId: '',
        isSending: false,
        isLoadingSummaries: false,
        isLoadingMessages: false,
        abortController: null,
        pendingModelId: null,
        activeJobId: null,
        pendingConfirmation: null,
        agentState: 'idle',
        activeToolCalls: [],

        // Load session summaries from server
        loadSessionSummaries: async () => {
            set({ isLoadingSummaries: true });
            try {
                const summaries = await api.fetchSessionSummaries();
                // Filter out empty "new conversation" entries
                const filtered = summaries.filter(
                    s => !(s.title === '新对话' && s.messageCount === 0)
                );
                set({ sessionSummaries: filtered, isLoadingSummaries: false });
            } catch (error) {
                console.error('Failed to load session summaries:', error);
                set({ isLoadingSummaries: false });
            }
        },

        // Load session messages on demand
        loadSessionMessages: async (sessionId: string) => {
            // Use cache if available
            const cached = get().messagesCache[sessionId];
            if (cached) {
                const summary = get().sessionSummaries.find(s => s.id === sessionId);
                if (summary) {
                    set({ currentSession: summary });
                }
                return;
            }

            set({ isLoadingMessages: true });
            try {
                const messages = await api.fetchSessionMessages(sessionId);
                const summary = get().sessionSummaries.find(s => s.id === sessionId);

                if (summary) {
                    set(state => ({
                        messagesCache: { ...state.messagesCache, [sessionId]: messages },
                        currentSession: summary,
                        isLoadingMessages: false,
                    }));
                } else {
                    set({ isLoadingMessages: false });
                }
            } catch (error) {
                console.error('Failed to load messages:', error);
                set({ isLoadingMessages: false });
            }
        },

        setSessionSummaries: (summaries) => set({ sessionSummaries: summaries }),

        addSessionSummary: (summary) =>
            set({ sessionSummaries: [summary, ...get().sessionSummaries] }),

        updateSessionSummary: (id, updates) =>
            set({
                sessionSummaries: get().sessionSummaries.map(s =>
                    s.id === id ? { ...s, ...updates } : s
                ),
            }),

        deleteSessionSummary: (id) => {
            set((state) => {
                const newCache = { ...state.messagesCache };
                delete newCache[id];
                return {
                    sessionSummaries: state.sessionSummaries.filter(s => s.id !== id),
                    messagesCache: newCache,
                    currentSession: state.currentSession?.id === id ? null : state.currentSession,
                };
            });
        },

        // Set selected session (triggers message loading)
        setSelectedSessionId: (id: string) => {
            if (!id) {
                set({ selectedSessionId: '', currentSession: null });
                return;
            }

            // Skip sentinel — handled by enterNewSession
            if (id === NEW_SESSION_SENTINEL) return;

            set({ selectedSessionId: id });

            const state = get();
            const summary = state.sessionSummaries.find(s => s.id === id);
            const cachedMessages = state.messagesCache[id];

            if (cachedMessages !== undefined && summary) {
                set({ currentSession: summary });
            } else if (summary) {
                get().loadSessionMessages(id);
            } else {
                set({ currentSession: null });
            }
        },

        // Enter "new session" mode — local only, no backend call
        enterNewSession: () => {
            set({
                selectedSessionId: NEW_SESSION_SENTINEL,
                currentSession: null,
            });
        },

        // Set model for pending (not-yet-created) session
        setPendingModelId: (modelId: string | null) => {
            set({ pendingModelId: modelId });
        },

        setActiveJobId: (jobId: string | null) => {
            // job 终态处理点：ChatShell 在 job done/failed/cancelled 后以 null 清空
            // activeJobId（现有逻辑），在此接 stream_done 使 agentState 归 idle。
            if (jobId === null) transition('stream_done');
            set({ activeJobId: jobId });
        },

        addMessage: (sessionId, message) => {
            set((state) => {
                const updatedMessages = [...(state.messagesCache[sessionId] || []), message];
                const updatedCache = { ...state.messagesCache, [sessionId]: updatedMessages };

                const updatedSummaries = state.sessionSummaries.map(s =>
                    s.id === sessionId
                        ? { ...s, updatedAt: Date.now(), messageCount: updatedMessages.length }
                        : s
                );

                return {
                    messagesCache: updatedCache,
                    sessionSummaries: updatedSummaries,
                };
            });
        },

        updateMessage: (sessionId, messageId, updates) => {
            set((state) => {
                const messages = state.messagesCache[sessionId] || [];
                const updatedMessages = messages.map(msg =>
                    msg.id === messageId ? { ...msg, ...updates } : msg
                );
                const updatedCache = { ...state.messagesCache, [sessionId]: updatedMessages };

                return { messagesCache: updatedCache };
            });
        },

        deleteMessage: (sessionId, messageId) => {
            set((state) => {
                const messages = state.messagesCache[sessionId] || [];
                const updatedMessages = messages.filter(msg => msg.id !== messageId);
                const updatedCache = { ...state.messagesCache, [sessionId]: updatedMessages };

                const updatedSummaries = state.sessionSummaries.map(s =>
                    s.id === sessionId
                        ? { ...s, updatedAt: Date.now(), messageCount: updatedMessages.length }
                        : s
                );

                return {
                    messagesCache: updatedCache,
                    sessionSummaries: updatedSummaries,
                };
            });
        },

        // Create a new session on the server
        createSession: async (params) => {
            const session = await api.createSession(params);
            // Add to local state
            const summary: SessionSummary = {
                ...session,
                messageCount: 0,
            };
            get().addSessionSummary(summary);
            set({ currentSession: session });
            return session;
        },

        // Update a session on the server
        updateSession: async (id, updates) => {
            const session = await api.updateSession(id, updates);
            set((state) => ({
                sessionSummaries: state.sessionSummaries.map((s) =>
                    s.id === id ? { ...s, ...session } : s
                ),
                currentSession:
                    state.currentSession?.id === id
                        ? { ...state.currentSession, ...session }
                        : state.currentSession,
            }));
        },

        // Send message via server SSE
        // If sessionId is the sentinel, lazily create the session first.
        sendMessage: async ({ sessionId, content, files }) => {
            transition('send');
            const { addMessage, updateMessage, updateSessionSummary, createSession, pendingModelId } = get();

            // Lazy-create session if needed
            let realSessionId = sessionId;
            if (sessionId === NEW_SESSION_SENTINEL) {
                const session = await createSession({
                    title: '新对话',
                    modelId: pendingModelId ?? undefined,
                });
                realSessionId = session.id;
                set({ selectedSessionId: realSessionId, pendingModelId: null });
            }

            // Optimistically add user message to local cache
            const userMessage: Message = {
                id: `temp-user-${Date.now()}`,
                sessionId: realSessionId,
                role: 'user',
                content,
                attachments: files?.map(f => ({ id: `att-${Date.now()}-${f.name}`, name: f.name, type: f.type, size: f.size })) || [],
                status: 'sending',
                createdAt: Date.now(),
            };
            addMessage(realSessionId, userMessage);

            // Create AbortController for cancellation
            const abortController = new AbortController();
            set({ abortController, isSending: true });

            try {
                const result = await api.sendMessage({ sessionId: realSessionId, content, files });
                updateMessage(realSessionId, userMessage.id, { status: 'sent' });

                // Async mode: the server accepted the message as a background job
                // (JSON `{ data: { jobId } }` instead of an SSE stream). Record the
                // jobId so ChatShell can subscribe via useJobStream, add a placeholder
                // assistant message, and stop — the job's progress is tracked separately.
                if (result.mode === 'async') {
                    set({ activeJobId: result.jobId });
                    const assistantMessage: Message = {
                        id: `job-${result.jobId}`,
                        sessionId: realSessionId,
                        role: 'assistant',
                        content: '',
                        attachments: [],
                        status: 'sending',
                        createdAt: Date.now(),
                    };
                    addMessage(realSessionId, assistantMessage);
                    return;
                }

                await parseSSEStream({
                    stream: result.stream,
                    signal: abortController.signal,
                    onPlaceholder: (msgId) => {
                        // Create assistant placeholder message with server's msgId
                        const assistantMessage: Message = {
                            id: msgId,
                            sessionId: realSessionId,
                            role: 'assistant',
                            content: '',
                            attachments: [],
                            status: 'sending',
                            createdAt: Date.now(),
                        };
                        addMessage(realSessionId, assistantMessage);
                    },
                    onDelta: (deltaContent) => {
                        transition('content_delta');
                        // Find the last assistant message that is still 'sending' and update its content
                        const messages = get().messagesCache[realSessionId] || [];
                        const sendingId = findSendingAssistantId(messages);
                        if (sendingId) {
                            const lastMsg = messages.find(m => m.id === sendingId)!;
                            updateMessage(realSessionId, sendingId, { content: lastMsg.content + deltaContent });
                            // 回答开始 → 收尾 reasoning 条目（"思考中…" → "思考过程"）
                            closeOpenReasoning(realSessionId);
                        }
                    },
                    // Extended Thinking（RFC §3）：推理增量累积为时间线 reasoning 条目
                    // （连续 delta 归并进同一条目；回答/工具开始时收尾为 done）。
                    onReasoning: (reasoningDelta) => {
                        updateTimeline(realSessionId, (entries) => {
                            const last = entries[entries.length - 1];
                            if (last?.kind === 'reasoning' && !last.done) {
                                return [...entries.slice(0, -1), { ...last, text: last.text + reasoningDelta }];
                            }
                            return [...entries, {
                                kind: 'reasoning',
                                id: `reason-${Date.now()}-${entries.length}`,
                                text: reasoningDelta,
                                done: false,
                            }];
                        });
                    },
                    // tool_call_* / tool_result 事件：维护时间线条目 + activeToolCalls
                    // （后者仅驱动 agentState 状态机）并驱动状态机
                    onToolCallStart: (msgId, index) => {
                        // 前导文本快照：本轮首个 tool_call_start 时，把气泡中累积的
                        // 当前轮文本移入时间线 lead 条目并清空气泡——正文只承载最终
                        // 回答，消灭"思考/前导写进气泡又被 onDone 覆盖删除"的闪动。
                        const messages = get().messagesCache[realSessionId] || [];
                        const sendingId = findSendingAssistantId(messages);
                        if (sendingId) {
                            const lastMsg = messages.find(m => m.id === sendingId)!;
                            if (lastMsg.content.trim().length > 0) {
                                const leadText = lastMsg.content;
                                closeOpenReasoning(realSessionId);
                                updateTimeline(realSessionId, (entries) => [...entries, {
                                    kind: 'lead',
                                    id: `lead-${Date.now()}-${entries.length}`,
                                    text: leadText,
                                }]);
                                updateMessage(realSessionId, sendingId, { content: '' });
                            } else {
                                closeOpenReasoning(realSessionId);
                            }
                            // 工具条目（组合键占位，tool_call_done 后换真实 id）
                            updateTimeline(realSessionId, (entries) => [...entries, {
                                kind: 'tool',
                                id: `${msgId}:${index}`,
                                name: '',
                                status: 'running',
                                startedAt: Date.now(),
                            }]);
                        }
                        set((state) => ({
                            activeToolCalls: [
                                ...state.activeToolCalls,
                                { id: toolCallKey(msgId, index), name: '', status: 'running' },
                            ],
                            agentState: transitionAgentState(state.agentState, 'tool_call_start'),
                        }));
                    },
                    onToolCallDelta: (msgId, index, _id, name) => {
                        // 只补全运行中的工具名，不影响状态机
                        if (name === undefined) return;
                        if (name) {
                            updateTimeline(realSessionId, (entries) => entries.map((e) =>
                                e.kind === 'tool' && e.status === 'running' && !e.name
                                    ? { ...e, name }
                                    : e,
                            ));
                        }
                        set((state) => ({
                            activeToolCalls: state.activeToolCalls.map(call =>
                                call.id === toolCallKey(msgId, index) && call.status === 'running'
                                    ? { ...call, name }
                                    : call
                            ),
                        }));
                    },
                    onToolCallDone: (msgId, index, id, name, args) => {
                        // 时间线：组合键 → 真实 id，回填名称与参数（执行仍在进行，
                        // tool_result 到达才算 done——修复旧 UI 在参数到齐时就打 ✓）
                        if (args !== undefined) {
                            updateTimeline(realSessionId, (entries) => entries.map((e) =>
                                e.kind === 'tool' && e.id === `${msgId}:${index}`
                                    ? { ...e, id, name, args }
                                    : e,
                            ));
                        }
                        set((state) => ({
                            activeToolCalls: state.activeToolCalls.map(call =>
                                call.id === toolCallKey(msgId, index)
                                    ? { ...call, id, name, status: 'done' }
                                    : call
                            ),
                            agentState: transitionAgentState(state.agentState, 'tool_call_done'),
                        }));
                    },
                    onToolResult: (_msgId, toolCallId, result, isError) => {
                        // 工具结果回填：状态 done/error + 结果文本 + 结束时间（耗时）
                        updateTimeline(realSessionId, (entries) => entries.map((e) =>
                            e.kind === 'tool' && e.id === toolCallId
                                ? {
                                    ...e,
                                    status: isError ? 'error' : 'done',
                                    result,
                                    isError,
                                    endedAt: Date.now(),
                                }
                                : e,
                        ));
                        // 工具结果到达时保持 done 状态（幂等）
                        set((state) => ({
                            activeToolCalls: state.activeToolCalls.map(call =>
                                call.id === toolCallId ? { ...call, status: 'done' } : call
                            ),
                        }));
                    },
                    onDone: (title, content) => {
                        transition('stream_done');
                        // Mark the last assistant message as sent
                        const messages = get().messagesCache[realSessionId] || [];
                        const sendingId = findSendingAssistantId(messages);
                        if (sendingId) {
                            // 终态收尾时间线（running 条目落定），时间线本身保留在消息上
                            finalizeTimeline(realSessionId, false);
                            updateMessage(realSessionId, sendingId, {
                                status: 'sent',
                                // Override locally-accumulated SSE deltas with the
                                // authoritative final content from the runner. Without
                                // this, multi-iteration agent loops (tool call →
                                // retry → retry) show every iteration's streamed text
                                // concatenated in the placeholder message.
                                ...(content !== undefined ? { content } : {}),
                            });
                        }
                        // Update session title if provided
                        if (title && title !== 'New Session') {
                            updateSessionSummary(realSessionId, { title });
                        }
                    },
                    onError: (errorMsg) => {
                        if (abortController.signal.aborted) return;
                        transition('stream_error');
                        const messages = get().messagesCache[realSessionId] || [];
                        const sendingId = findSendingAssistantId(messages);
                        if (sendingId) {
                            finalizeTimeline(realSessionId, true);
                            updateMessage(realSessionId, sendingId, {
                                status: 'failed',
                                error: errorMsg,
                            });
                        }
                    },
                    onAborted: () => {
                        transition('stream_aborted');
                        const messages = get().messagesCache[realSessionId] || [];
                        const sendingId = findSendingAssistantId(messages);
                        if (sendingId) {
                            finalizeTimeline(realSessionId, false);
                            updateMessage(realSessionId, sendingId, { status: 'aborted' });
                        }
                    },
                    onConfirmationRequired: (data) => {
                        set({ pendingConfirmation: data });
                    },
                });

                // 流已结束但终态回调（onDone/onError/onAborted）一个都没触发：
                // 服务端异常断流（崩溃、代理截断等）。此时占位消息仍处于
                // sending 状态 —— 回归修复：收尾为 aborted，避免僵尸消息。
                // 正常终态不命中 findSendingAssistantId，此守卫为 no-op。
                const leftoverMessages = get().messagesCache[realSessionId] || [];
                if (findSendingAssistantId(leftoverMessages)) {
                    transition('stream_aborted');
                    markSendingAssistantAborted(realSessionId);
                }
            } catch (error) {
                if (abortController.signal.aborted) {
                    // 用户主动停止：fetch 被 abort 后抛错。收尾占位消息与
                    // optimistic user 消息（回归修复：修复前直接 return，
                    // 占位消息永远停留在 sending）。
                    markSendingAssistantAborted(realSessionId);
                    const cachedUser = get().messagesCache[realSessionId]?.find(
                        (message) => message.id === userMessage.id,
                    );
                    if (cachedUser?.status === 'sending') {
                        updateMessage(realSessionId, userMessage.id, { status: 'aborted' });
                    }
                    return;
                }
                // 流建立失败或 SSE 解析抛错：与 onError 一致进入 error 终态
                transition('stream_error');
                console.error('Send message failed:', error);
                const cachedUserMessage = get().messagesCache[realSessionId]?.find(
                    (message) => message.id === userMessage.id,
                );
                if (cachedUserMessage?.status === 'sending') {
                    updateMessage(realSessionId, userMessage.id, {
                        status: 'failed',
                        error: error instanceof Error ? error.message : String(error),
                    });
                }
                throw error;
            } finally {
                set({ isSending: false, abortController: null });
            }
        },

        // Cancel current stream
        cancelStream: () => {
            const { abortController, selectedSessionId } = get();
            if (abortController) {
                abortController.abort();
                // 本地 abort 后进入 cancelled 终态
                transition('stream_aborted');
                // 收尾占位消息：SSE aborted 事件不会到达（连接已断），
                // 本地直接标记，避免僵尸 sending 消息。
                if (selectedSessionId && selectedSessionId !== NEW_SESSION_SENTINEL) {
                    markSendingAssistantAborted(selectedSessionId);
                }
                // Also notify server
                api.stopStream(selectedSessionId).catch(() => {});
                set({ abortController: null, isSending: false });
            }
        },

        // Resolve a pending tool confirmation
        resolveConfirmation: async (approvalId: string, approved: boolean) => {
            try {
                await api.confirmToolCall(approvalId, approved);
            } catch (error) {
                console.error('Failed to resolve tool confirmation:', error);
            } finally {
                set({ pendingConfirmation: null });
            }
        },
    };
});
