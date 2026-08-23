// Zustand - Session state management
import { create } from 'zustand';
import type { Session, SessionSummary, CreateSessionParams, Message } from '@my-copilot/shared';
import { api } from '../api';
import { parseSSEStream, type ConfirmationEventData } from '../utils/streamUtils';

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
 * 前端本地的 assistant 消息扩展：Extended Thinking 推理文本（RFC agent-loop-v2 §3）。
 * 仅存在于前端消息缓存用于渲染，不持久化、不上行 server，故不进 shared Message 类型。
 */
export type MessageWithReasoning = Message & { reasoningText?: string };

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
    /** updates 额外接受前端本地字段 reasoningText（Extended Thinking 渲染，见 MessageWithReasoning）。 */
    updateMessage: (sessionId: string, messageId: string, updates: Partial<MessageWithReasoning>) => void;
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
                        }
                    },
                    // Extended Thinking（RFC §3）：推理增量累积到当前 sending assistant 消息的
                    // 前端本地字段 reasoningText（MessageWithReasoning），UI 侧默认折叠渲染。
                    onReasoning: (reasoningDelta) => {
                        const messages = get().messagesCache[realSessionId] || [];
                        const sendingId = findSendingAssistantId(messages);
                        if (sendingId) {
                            const lastMsg = messages.find(m => m.id === sendingId)!;
                            const prev = (lastMsg as MessageWithReasoning).reasoningText ?? '';
                            updateMessage(realSessionId, sendingId, { reasoningText: prev + reasoningDelta });
                        }
                    },
                    // tool_call_* 事件：维护 activeToolCalls 进度并驱动状态机
                    onToolCallStart: (msgId, index) => {
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
                        set((state) => ({
                            activeToolCalls: state.activeToolCalls.map(call =>
                                call.id === toolCallKey(msgId, index) && call.status === 'running'
                                    ? { ...call, name }
                                    : call
                            ),
                        }));
                    },
                    onToolCallDone: (msgId, index, id, name) => {
                        set((state) => ({
                            activeToolCalls: state.activeToolCalls.map(call =>
                                call.id === toolCallKey(msgId, index)
                                    ? { ...call, id, name, status: 'done' }
                                    : call
                            ),
                            agentState: transitionAgentState(state.agentState, 'tool_call_done'),
                        }));
                    },
                    onToolResult: (_msgId, toolCallId) => {
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
                            updateMessage(realSessionId, sendingId, { status: 'aborted' });
                        }
                    },
                    onConfirmationRequired: (data) => {
                        set({ pendingConfirmation: data });
                    },
                });
            } catch (error) {
                if (abortController.signal.aborted) return;
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
