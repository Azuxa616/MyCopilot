// Zustand - Session state management
import { create } from 'zustand';
import type { Session, SessionSummary, CreateSessionParams, Message, QuestionAnswerEntry } from '@my-copilot/shared';
import { api } from '../api';
import { parseSSEStream, type ConfirmationEventData } from '../utils/streamUtils';
import type { MessageWithTimeline } from '../types/timeline';
import {
    transitionAgentState,
    TERMINAL_AGENT_TRIGGERS,
    type AgentState,
    type AgentStateTrigger,
    type ActiveToolCall,
    type PendingQuestion,
} from './agent-state';
import { findSendingAssistantId } from './session-store-types';
import { createStreamHandlers } from './stream-handlers';

// 兼容导出：Agent 状态机与 SSE 回调工厂已拆分至 ./agent-state 与
// ./stream-handlers，此处保持既有导入路径不变。
export { transitionAgentState } from './agent-state';
export { toolCallKey } from './session-store-types';
export type {
    AgentState,
    AgentStateTrigger,
    ActiveToolCall,
    PendingQuestion,
} from './agent-state';

// Sentinel value for a "pending" (not-yet-created) session
export const NEW_SESSION_SENTINEL = '__new__';

/**
 * 根据 toolCallId 在消息缓存中定位宿主 assistant 消息 id。
 * 依次查消息的 toolCalls[] 与本地时间线条目（刷新恢复路径使用）。
 */
function findMessageIdByToolCall(messages: Message[], toolCallId: string): string | undefined {
    for (const m of messages) {
        if (m.role === 'assistant' && m.toolCalls?.some((c) => c.id === toolCallId)) return m.id;
        const timeline = (m as MessageWithTimeline).timeline;
        if (timeline?.some((e) => e.kind === 'tool' && e.id === toolCallId)) return m.id;
    }
    return undefined;
}

export interface SessionStore {
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
    /** 当前等待用户作答的 ask_user 提问（问答卡片）；null = 无。 */
    pendingQuestion: PendingQuestion | null;
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
    sendMessage: (params: {
        sessionId: string;
        content: string;
        /** 引用已上传资产的 id（服务端解析注入；含 @file chip 载荷）。 */
        assetIds?: string[];
        /** / 命令携带的手动激活 skill 名（chip 载荷）。 */
        enforcedSkillIds?: string[];
        /** @会话 引用携带的目标会话 id（chip 载荷）。 */
        referencedSessionIds?: string[];
        /** 仅用于乐观渲染本地用户消息的附件卡片（可选）。 */
        attachments?: Message['attachments'];
    }) => Promise<void>;
    cancelStream: () => void;
    /** Resolve a pending tool confirmation (user clicked allow/deny). */
    resolveConfirmation: (approvalId: string, approved: boolean) => Promise<void>;
    /** 提交 ask_user 问答卡片的回答（整卡一次提交），成功后清除 pendingQuestion。 */
    submitQuestionAnswer: (
        approvalId: string,
        answer: { status: 'answered' | 'skipped'; answers: QuestionAnswerEntry[] },
    ) => Promise<void>;
    /** 刷新恢复：还原 pending 提问/确认并重连会话事件流（SSE 重放缓冲帧）。 */
    restoreSessionLiveState: (sessionId: string) => Promise<void>;
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

    /** SSE 回调工厂（实现见 ./stream-handlers）：注入 zustand set/get 与
     *  store 内的 transition 助手，在线流与刷新恢复重放流共用同一套逻辑。 */
    const streamHandlers = (sessionId: string) =>
        createStreamHandlers(sessionId, set, get, transition);

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
        pendingQuestion: null,
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
        sendMessage: async ({ sessionId, content, assetIds, enforcedSkillIds, referencedSessionIds, attachments }) => {
            transition('send');
            const { addMessage, updateMessage, createSession, pendingModelId } = get();

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
                attachments: attachments ?? [],
                status: 'sending',
                createdAt: Date.now(),
            };
            addMessage(realSessionId, userMessage);

            // Create AbortController for cancellation
            const abortController = new AbortController();
            set({ abortController, isSending: true });

            try {
                // 本地乐观 userMessage 保持纯 content 投影——chip 不进本地消息缓存，与 DB 侧一致。
                const result = await api.sendMessage({
                    sessionId: realSessionId,
                    content,
                    ...(assetIds && assetIds.length > 0 ? { assetIds } : {}),
                    ...(enforcedSkillIds && enforcedSkillIds.length > 0 ? { enforcedSkillIds } : {}),
                    ...(referencedSessionIds && referencedSessionIds.length > 0 ? { referencedSessionIds } : {}),
                });
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
                    // 与刷新恢复路径共用同一套 reducer（问答卡片/确认挂起、
                    // 时间线维护、状态机转移见 createStreamHandlers）。
                    ...streamHandlers(realSessionId),
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

        // 提交 ask_user 问答卡片（整卡一次提交）。成功后清除 pendingQuestion，
        // 后续 tool_result 事件把 QuestionCardAnswer 回填进时间线（已答态）。
        // 失败时保留挂起态，由调用方（QuestionCard）反馈错误。
        submitQuestionAnswer: async (approvalId, answer) => {
            await api.submitQuestionAnswer(approvalId, answer);
            if (get().pendingQuestion?.approvalId === approvalId) {
                set({ pendingQuestion: null });
            }
        },

        // 刷新恢复：还原 pending 提问/确认；若有挂起项则重连会话事件流，
        // 重放缓冲帧后接续直播（终止事件后服务端关闭连接）。
        restoreSessionLiveState: async (sessionId) => {
            try {
                // messageId 解析与占位幂等依赖消息缓存。
                if (!get().messagesCache[sessionId]) {
                    await get().loadSessionMessages(sessionId);
                }
                const approvals = await api.fetchPendingApprovals(sessionId);
                if (approvals.length === 0) return;

                const messages = get().messagesCache[sessionId] || [];
                for (const approval of approvals) {
                    const messageId =
                        findMessageIdByToolCall(messages, approval.toolCallId) ?? '';
                    if (approval.toolName === 'ask_user') {
                        set({
                            pendingQuestion: {
                                approvalId: approval.approvalId,
                                toolCallId: approval.toolCallId,
                                messageId,
                                expiresAt: approval.expiresAt,
                            },
                        });
                    } else {
                        set({
                            pendingConfirmation: {
                                approvalId: approval.approvalId,
                                messageId,
                                toolCallId: approval.toolCallId,
                                toolName: approval.toolName,
                                arguments: approval.arguments,
                                resourceScope: '',
                                source: approval.source,
                                sourceMcpId: approval.sourceMcpId,
                                safetyLevel: approval.safetyLevel,
                                expiresAt: approval.expiresAt,
                            },
                        });
                    }
                }

                // 重连事件流：重放缓冲帧（placeholder/tool_call_*/confirmation_required…）
                // 后接续直播；idle 事件被解析器忽略，流自然结束即无活动 Run。
                const response = await api.attachSessionEvents(sessionId);
                if (!response.body) return;
                const controller = new AbortController();
                set({ abortController: controller, isSending: true });
                await parseSSEStream({
                    stream: response.body,
                    signal: controller.signal,
                    ...streamHandlers(sessionId),
                });
                // 重放/直播结束但占位消息仍 sending：服务端异常断流，收尾为 aborted。
                const leftoverMessages = get().messagesCache[sessionId] || [];
                if (findSendingAssistantId(leftoverMessages)) {
                    transition('stream_aborted');
                    markSendingAssistantAborted(sessionId);
                }
            } catch (error) {
                console.error('Failed to restore session live state:', error);
            } finally {
                set({ isSending: false, abortController: null });
            }
        },
    };
});
