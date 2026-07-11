// Zustand - Session state management
import { create } from 'zustand';
import type { Session, SessionSummary, CreateSessionParams, Message } from '@my-copilot/shared';
import { api } from '../api';
import { parseSSEStream } from '../utils/streamUtils';

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
    updateMessage: (sessionId: string, messageId: string, updates: Partial<Message>) => void;
    deleteMessage: (sessionId: string, messageId: string) => void;

    // Actions - business methods
    createSession: (params?: CreateSessionParams) => Promise<Session>;
    updateSession: (id: string, updates: Partial<CreateSessionParams>) => Promise<void>;
    sendMessage: (params: { sessionId: string; content: string; files?: File[] }) => Promise<void>;
    cancelStream: () => void;
}

export const useSessionStore = create<SessionStore>()(
    (set, get) => ({
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
                status: 'sent',
                createdAt: Date.now(),
            };
            addMessage(realSessionId, userMessage);

            // Create AbortController for cancellation
            const abortController = new AbortController();
            set({ abortController, isSending: true });

            try {
                const result = await api.sendMessage({ sessionId: realSessionId, content, files });

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
                        // Find the last assistant message that is still 'sending' and update its content
                        const messages = get().messagesCache[realSessionId] || [];
                        const sendingId = findSendingAssistantId(messages);
                        if (sendingId) {
                            const lastMsg = messages.find(m => m.id === sendingId)!;
                            updateMessage(realSessionId, sendingId, { content: lastMsg.content + deltaContent });
                        }
                    },
                    onDone: (title) => {
                        // Mark the last assistant message as sent
                        const messages = get().messagesCache[realSessionId] || [];
                        const sendingId = findSendingAssistantId(messages);
                        if (sendingId) {
                            updateMessage(realSessionId, sendingId, { status: 'sent' });
                        }
                        // Update session title if provided
                        if (title && title !== 'New Session') {
                            updateSessionSummary(realSessionId, { title });
                        }
                    },
                    onError: (errorMsg) => {
                        if (abortController.signal.aborted) return;
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
                        const messages = get().messagesCache[realSessionId] || [];
                        const sendingId = findSendingAssistantId(messages);
                        if (sendingId) {
                            updateMessage(realSessionId, sendingId, { status: 'aborted' });
                        }
                    },
                });
            } catch (error) {
                if (abortController.signal.aborted) return;
                console.error('Send message failed:', error);
            } finally {
                set({ isSending: false, abortController: null });
            }
        },

        // Cancel current stream
        cancelStream: () => {
            const { abortController, selectedSessionId } = get();
            if (abortController) {
                abortController.abort();
                // Also notify server
                api.stopStream(selectedSessionId).catch(() => {});
                set({ abortController: null, isSending: false });
            }
        },
    })
);
