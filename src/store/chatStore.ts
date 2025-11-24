//Zustand - Chat状态管理
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Chat, ChatSummary, Message, CreateChatParams, SendMessageParams } from '../types/chat';
import { MessageRole, MessageStatus } from '../types/chat';
import { api } from '../api';
import { handleStreamResponse } from '../utils/streamUtils';
import { useConfigStore } from './configStore';
interface ChatStore {
    //状态 - 分层加载架构
    chatSummaries: ChatSummary[]; // 聊天列表摘要（轻量数据）
    currentChat: Chat | null; // 当前选中聊天的完整数据
    messagesCache: Record<string, Message[]>; // 消息缓存（按聊天ID）
    selectedChatId: string;
    isSending: boolean;
    isLoadingSummaries: boolean; // 加载聊天列表状态
    isLoadingMessages: boolean; // 加载消息状态
    abortController: AbortController | null; // 用于中断流式请求

    // 向后兼容：保留 chats（基于 chatSummaries 和 messagesCache 计算）
    chats: Chat[];

    //Actions -聊天列表操作（分层加载）
    loadChatSummaries: () => Promise<void>;
    loadChatMessages: (chatId: string) => Promise<void>;
    setChatSummaries: (summaries: ChatSummary[]) => void;
    addChatSummary: (summary: ChatSummary) => void;
    updateChatSummary: (id: string, updates: Partial<ChatSummary>) => void;
    deleteChatSummary: (id: string) => void;

    //Actions -向后兼容的聊天列表操作
    setChats: (chats: Chat[]) => void;
    addChat: (chat: Chat) => void;
    updateChat: (id: string, updates: Partial<Chat>) => void;
    deleteChat: (id: string) => void;

    //Actions -选中对话操作
    setSelectedChatId: (id: string) => void;
    getSelectedChat: () => Chat | undefined;
    
    //Actions -消息操作
    addMessage: (chatId: string, message: Message) => void;
    updateMessage: (chatId: string, messageId: string, updates: Partial<Message>) => void;
    deleteMessage: (chatId: string, messageId: string) => void;

    //Actions -业务方法
    createChat: (params: CreateChatParams) => Chat;
    sendMessage: (params: SendMessageParams) => Promise<void>;
    cancelStream: () => void; // 中断当前流式生成

}

type ApiMode = 'mock' | 'real';

interface PersistedChatState {
    chatSummaries: ChatSummary[];
    messagesCache: Record<string, Message[]>;
    selectedChatId: string;
}

const REAL_STORAGE_KEY = 'my-copilot-chat-real';
const isBrowser = typeof window !== 'undefined';

// 从 localStorage 直接读取配置模式
const getApiModeFromStorage = (): ApiMode => {
    if (!isBrowser) {
        return 'mock';
    }
    try {
        const configStr = window.localStorage.getItem('my-copilot-config');
        if (configStr) {
            const config = JSON.parse(configStr);
            return config?.state?.apiMode === 'real' ? 'real' : 'mock';
        }
    } catch (error) {
        console.warn('读取配置模式失败:', error);
    }
    return 'mock';
};

// 自定义 storage，只在 real 模式下持久化
const createConditionalStorage = () => {
    const baseStorage = localStorage;
    return {
        getItem: (name: string): string | null => {
            if (!isBrowser) {
                return null;
            }
            // 直接从 localStorage 读取配置模式，避免依赖 configStore 初始化顺序
            const currentMode = getApiModeFromStorage();
            // 只在 real 模式下读取持久化数据
            if (currentMode !== 'real') {
                return null;
            }
            try {
                return baseStorage.getItem(name);
            } catch (error) {
                console.warn('读取本地存储失败:', error);
                return null;
            }
        },
        setItem: (name: string, value: string): void => {
            if (!isBrowser) {
                return;
            }
            // 检查当前模式（优先使用 configStore，如果未初始化则从 localStorage 读取）
            const currentMode = useConfigStore.getState().apiMode || getApiModeFromStorage();
            // 只在 real 模式下写入持久化数据
            if (currentMode !== 'real') {
                return;
            }
            try {
                baseStorage.setItem(name, value);
            } catch (error) {
                console.warn('保存本地存储失败:', error);
            }
        },
        removeItem: (name: string): void => {
            if (!isBrowser) {
                return;
            }
            try {
                baseStorage.removeItem(name);
            } catch (error) {
                console.warn('删除本地存储失败:', error);
            }
        },
    };
};
//计算当前选中聊天
const deriveCurrentChat = (state: Partial<ChatStore>): Chat | null => {
    const { chatSummaries, messagesCache, selectedChatId } = state;
    if (!chatSummaries || !messagesCache) {
        return null;
    }
    const targetId = selectedChatId || chatSummaries[0]?.id;
    if (!targetId) {
        return null;
    }
    const summary = chatSummaries.find(s => s.id === targetId);
    if (!summary) {
        return null;
    }
    return {
        id: summary.id,
        title: summary.title,
        messages: messagesCache[targetId] || [],
        createdAt: summary.createdAt,
        updatedAt: summary.updatedAt,
    };
};

const resetChatData = () => ({
    chatSummaries: [],
    currentChat: null,
    messagesCache: {},
    selectedChatId: '',
    isLoadingSummaries: false,
    isLoadingMessages: false,
    isSending: false,
    abortController: null as AbortController | null,
});

const reloadChatStoreForMode = (mode: ApiMode) => {
    // 重置状态
    useChatStore.setState(resetChatData());
    
    if (mode === 'real') {
        // real 模式下，persist middleware 会自动从 localStorage 恢复数据
        // 但需要手动触发恢复，因为模式切换时 storage 的 getItem 会返回数据
        const storage = createConditionalStorage();
        const persisted = storage.getItem(REAL_STORAGE_KEY);
        if (persisted && typeof persisted === 'string') {
            try {
                const parsed = JSON.parse(persisted) as PersistedChatState;
                useChatStore.setState({
                    chatSummaries: parsed.chatSummaries ?? [],
                    messagesCache: parsed.messagesCache ?? {},
                    selectedChatId: parsed.selectedChatId ?? '',
                    currentChat: deriveCurrentChat({
                        chatSummaries: parsed.chatSummaries ?? [],
                        messagesCache: parsed.messagesCache ?? {},
                        selectedChatId: parsed.selectedChatId ?? '',
                    }),
                });
            } catch (error) {
                console.warn('恢复持久化数据失败:', error);
            }
        }
    } else if (mode === 'mock') {
        // 模式切换到 mock 时，重新加载 mock 数据
        useChatStore.getState().loadChatSummaries();
    }
};

export const useChatStore = create<ChatStore>()(
    persist(
        (set, get) => ({
            //初始状态 - 分层加载架构
            chatSummaries: [],
            currentChat: null,
            messagesCache: {},
            selectedChatId: '',
            isSending: false,
            isLoadingSummaries: false,
            isLoadingMessages: false,
            abortController: null,
        
        // 向后兼容：基于 chatSummaries 和 messagesCache 计算 chats
        get chats(): Chat[] {
            const { chatSummaries, messagesCache } = get();
            return chatSummaries.map(summary => ({
                id: summary.id,
                title: summary.title,
                messages: messagesCache[summary.id] || [],
                createdAt: summary.createdAt,
                updatedAt: summary.updatedAt,
            }));
        },

        // 加载聊天列表摘要
        loadChatSummaries: async () => {
            set({ isLoadingSummaries: true });
            try {
                const summaries = await api.fetchChatSummaries();
                const currentState = get();
                
                // 过滤掉服务器返回的空"新对话"（消息数为0的），避免重复
                const filteredSummaries = summaries.filter(
                    s => !(s.title === '新对话' && s.messageCount === 0)
                );
                
                // 合并服务器返回的列表和本地新创建的聊天（保留本地新创建的聊天在列表前面）
                const localNewChats = currentState.chatSummaries.filter(
                    local => !filteredSummaries.some(server => server.id === local.id)
                );
                const mergedSummaries = [...localNewChats, ...filteredSummaries];
                
                set({ chatSummaries: mergedSummaries, isLoadingSummaries: false });
                
                // 注意：不再自动选择第一个聊天，由调用方决定选择哪个聊天
            } catch (error) {
                console.error('加载聊天列表失败:', error);
                set({ isLoadingSummaries: false });
            }
        },

        // 按需加载聊天消息
        loadChatMessages: async (chatId: string) => {
            // 如果已缓存，直接使用
            if (get().messagesCache[chatId]) {
                const summary = get().chatSummaries.find(s => s.id === chatId);
                if (summary) {
                    set({
                        currentChat: {
                            ...summary,
                            messages: get().messagesCache[chatId],
                        },
                    });
                }
                return;
            }

            set({ isLoadingMessages: true });
            try {
                const messages = await api.fetchChatMessages(chatId);
                const summary = get().chatSummaries.find(s => s.id === chatId);
                
                if (summary) {
                    // 更新缓存
                    set((state) => ({
                        messagesCache: { ...state.messagesCache, [chatId]: messages },
                        currentChat: {
                            ...summary,
                            messages,
                        },
                        isLoadingMessages: false,
                    }));
                }
            } catch (error) {
                console.error('加载消息失败:', error);
                set({ isLoadingMessages: false });
            }
        },

        // 设置聊天列表摘要
        setChatSummaries: (summaries: ChatSummary[]) => set({ chatSummaries: summaries }),
        
        // 添加聊天摘要
        addChatSummary: (summary: ChatSummary) => 
            set({ chatSummaries: [summary, ...get().chatSummaries] }),
        
        // 更新聊天摘要
        updateChatSummary: (id: string, updates: Partial<ChatSummary>) => 
            set({ 
                chatSummaries: get().chatSummaries.map(summary => 
                    summary.id === id ? { ...summary, ...updates } : summary
                ),
            }),
        
        // 删除聊天摘要
        deleteChatSummary: (id: string) => {
            set((state) => {
                const newCache = { ...state.messagesCache };
                delete newCache[id];
                return {
                    chatSummaries: state.chatSummaries.filter(s => s.id !== id),
                    messagesCache: newCache,
                    currentChat: state.currentChat?.id === id ? null : state.currentChat,
                };
            });
        },

        // 向后兼容：设置聊天列表（转换为摘要）
        setChats: (chats: Chat[]) => {
            const summaries: ChatSummary[] = chats.map(chat => ({
                id: chat.id,
                title: chat.title,
                createdAt: chat.createdAt,
                updatedAt: chat.updatedAt,
                messageCount: chat.messages.length,
            }));
            
            const cache: Record<string, Message[]> = {};
            chats.forEach(chat => {
                cache[chat.id] = chat.messages;
            });
            
            set({ chatSummaries: summaries, messagesCache: cache });
        },
        
        // 向后兼容：添加聊天
        addChat: (chat: Chat) => {
            const summary: ChatSummary = {
                id: chat.id,
                title: chat.title,
                createdAt: chat.createdAt,
                updatedAt: chat.updatedAt,
                messageCount: chat.messages.length,
            };
            
            set((state) => ({
                chatSummaries: [summary, ...state.chatSummaries],
                messagesCache: { ...state.messagesCache, [chat.id]: chat.messages },
            }));
        },
        
        // 向后兼容：更新聊天
        updateChat: (id: string, updates: Partial<Chat>) => {
            const chat = get().chats.find(c => c.id === id);
            if (!chat) return;
            
            const updatedChat = { ...chat, ...updates };
            const summary: ChatSummary = {
                id: updatedChat.id,
                title: updatedChat.title,
                createdAt: updatedChat.createdAt,
                updatedAt: updatedChat.updatedAt,
                messageCount: updatedChat.messages.length,
            };
            
            set((state) => ({
                chatSummaries: state.chatSummaries.map(s => s.id === id ? summary : s),
                messagesCache: { ...state.messagesCache, [id]: updatedChat.messages },
                currentChat: state.currentChat?.id === id ? updatedChat : state.currentChat,
            }));
        },
        
        // 向后兼容：删除聊天
        deleteChat: (id: string) => {
            set((state) => {
                const newCache = { ...state.messagesCache };
                delete newCache[id];
                return {
                    chatSummaries: state.chatSummaries.filter(s => s.id !== id),
                    messagesCache: newCache,
                    currentChat: state.currentChat?.id === id ? null : state.currentChat,
                };
            });
        },
        
        // 设置选中的聊天（触发消息加载）
        setSelectedChatId: (id: string) => {
            if (!id) {
                set({ selectedChatId: '', currentChat: null });
                return;
            }
            
            set({ selectedChatId: id });
            
            const state = get();
            const summary = state.chatSummaries.find(s => s.id === id);
            const cachedMessages = state.messagesCache[id];
            
            // 如果消息已缓存，直接设置 currentChat
            if (cachedMessages !== undefined && summary) {
                set({
                    currentChat: {
                        ...summary,
                        messages: cachedMessages,
                    },
                });
            } else if (summary) {
                // 如果有 summary 但消息未加载，则加载消息
                get().loadChatMessages(id);
            } else {
                // 如果 summary 不存在，可能是新创建的聊天，等待一下再重试
                // 这种情况不应该发生，但为了安全起见，我们设置一个空状态
                set({ currentChat: null });
            }
        },

        // 获取选中的聊天（使用 currentChat）
        getSelectedChat: () => {
            return get().currentChat || undefined;
        },
        // 添加消息
        addMessage: (chatId, message) => {
            set((state) => {
                const updatedMessages = [...(state.messagesCache[chatId] || []), message];
                const updatedCache = { ...state.messagesCache, [chatId]: updatedMessages };
                
                // 更新摘要的更新时间
                const updatedSummaries = state.chatSummaries.map(summary =>
                    summary.id === chatId
                        ? {
                            ...summary,
                            updatedAt: Date.now(),
                            messageCount: updatedMessages.length,
                        }
                        : summary
                );
                
                return {
                    messagesCache: updatedCache,
                    chatSummaries: updatedSummaries,
                    currentChat: state.currentChat?.id === chatId
                        ? { ...state.currentChat, messages: updatedMessages, updatedAt: Date.now() }
                        : state.currentChat,
                };
            });
        },

        // 更新消息
        updateMessage: (chatId, messageId, updates) => {
            set((state) => {
                const messages = state.messagesCache[chatId] || [];
                const updatedMessages = messages.map((msg) =>
                    msg.id === messageId ? { ...msg, ...updates } : msg
                );
                const updatedCache = { ...state.messagesCache, [chatId]: updatedMessages };
                
                return {
                    messagesCache: updatedCache,
                    currentChat: state.currentChat?.id === chatId
                        ? { ...state.currentChat, messages: updatedMessages, updatedAt: Date.now() }
                        : state.currentChat,
                };
            });
        },

        // 删除消息
        deleteMessage: (chatId, messageId) => {
            set((state) => {
                const messages = state.messagesCache[chatId] || [];
                const updatedMessages = messages.filter((msg) => msg.id !== messageId);
                const updatedCache = { ...state.messagesCache, [chatId]: updatedMessages };
                
                // 更新摘要
                const updatedSummaries = state.chatSummaries.map(summary =>
                    summary.id === chatId
                        ? {
                            ...summary,
                            updatedAt: Date.now(),
                            messageCount: updatedMessages.length,
                        }
                        : summary
                );
                
                return {
                    messagesCache: updatedCache,
                    chatSummaries: updatedSummaries,
                    currentChat: state.currentChat?.id === chatId
                        ? { ...state.currentChat, messages: updatedMessages, updatedAt: Date.now() }
                        : state.currentChat,
                };
            });
        },

        // 创建新聊天
        createChat: (params) => {
            const newChat: Chat = {
                id: `chat-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                title: params?.title || '新对话',
                messages: params?.initialMessage
                    ? [
                        {
                            id: `msg-${Date.now()}`,
                            role: MessageRole.USER,
                            content: params.initialMessage,
                            timestamp: Date.now(),
                            status: MessageStatus.SENT,
                            attachments: [],
                        },
                    ]
                    : [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            get().addChat(newChat);
            
            // 创建后立即设置 currentChat，确保新聊天能正确显示
            const summary: ChatSummary = {
                id: newChat.id,
                title: newChat.title,
                createdAt: newChat.createdAt,
                updatedAt: newChat.updatedAt,
                messageCount: newChat.messages.length,
            };
            
            set({
                currentChat: {
                    ...summary,
                    messages: newChat.messages,
                },
            });
            
            return newChat;
        },

        // 发送消息
        sendMessage: async (params) => {
            const { chatId, content, role = MessageRole.USER, attachments = [] } = params;
            const { addMessage, updateMessage } = get();

            // 创建 AbortController 用于中断请求
            const abortController = new AbortController();
            set({ abortController, isSending: true });

            // 创建用户消息
            const userMessage: Message = {
                id: `msg-${Date.now()}`,
                role,
                content,
                timestamp: Date.now(),
                status: MessageStatus.SENDING,
                attachments,
            };

            addMessage(chatId, userMessage);

            // 在添加助手占位消息之前，记录当前对话历史用于真实大模型调用
            const messagesForLLM = [...(get().messagesCache[chatId] || [])];

            // 创建一个空的助手消息，占位用于后续流式追加内容
            const assistantMessageId = `msg-${Date.now()}-assistant`;
            const assistantMessage: Message = {
                id: assistantMessageId,
                role: MessageRole.ASSISTANT,
                content: '',
                timestamp: Date.now(),
                status: MessageStatus.SENDING,
                attachments: [],
            };

            addMessage(chatId, assistantMessage);

            try {
                // 启动 AI 流式回复，传递 AbortSignal
                const streamAIResponse = await api.streamAIResponse({
                    chatId,
                    prompt: content,
                    messages: messagesForLLM,
                    signal: abortController.signal,
                });

                // 用户消息发送成功
                updateMessage(chatId, userMessage.id, {
                    status: MessageStatus.SENT,
                });

                // 处理 SSE 流式响应
                await handleStreamResponse({
                    chatId,
                    assistantMessageId,
                    streamAIResponse,
                    onContentUpdate: (chatId, messageId, content) => {
                        // 检查是否已中断
                        if (abortController.signal.aborted) {
                            return;
                        }
                        updateMessage(chatId, messageId, { content });
                    },
                    onError: (chatId, messageId, error) => {
                        // 如果是中断操作，不标记为失败
                        if (abortController.signal.aborted) {
                            updateMessage(chatId, messageId, {
                                status: MessageStatus.SENT,
                            });
                            return;
                        }
                        updateMessage(chatId, messageId, {
                            status: MessageStatus.FAILED,
                            error,
                        });
                    },
                });

                // 流式结束，标记助手消息已发送（如果未被中断）
                if (!abortController.signal.aborted) {
                    updateMessage(chatId, assistantMessageId, {
                        status: MessageStatus.SENT,
                    });
                }
            } catch (error) {
                // 如果是中断操作，不标记为失败
                if (abortController.signal.aborted) {
                    updateMessage(chatId, userMessage.id, {
                        status: MessageStatus.SENT,
                    });
                    updateMessage(chatId, assistantMessageId, {
                        status: MessageStatus.SENT,
                    });
                } else {
                    // 更新消息状态为失败
                    updateMessage(chatId, userMessage.id, {
                        status: MessageStatus.FAILED,
                        error: error instanceof Error ? error.message : '发送失败',
                    });
                    updateMessage(chatId, assistantMessageId, {
                        status: MessageStatus.FAILED,
                        error: error instanceof Error ? error.message : '生成失败',
                    });
                }
            } finally {
                set({ isSending: false, abortController: null });
            }
        },

        // 中断当前流式生成
        cancelStream: () => {
            const { abortController } = get();
            if (abortController) {
                abortController.abort();
                set({ abortController: null, isSending: false });
            }
        },

        }),
        {
            name: REAL_STORAGE_KEY,
            storage: createJSONStorage(() => createConditionalStorage()),
            // 只持久化这些字段
            partialize: (state) => ({
                chatSummaries: state.chatSummaries,
                messagesCache: state.messagesCache,
                selectedChatId: state.selectedChatId,
            } as Partial<ChatStore>),
            // 恢复时计算 currentChat
            onRehydrateStorage: () => (state) => {
                if (state) {
                    state.currentChat = deriveCurrentChat(state);
                }
            },
        }
    )
);

//监听配置模式变化，切换聊天数据存储模式
if (isBrowser) {
    // 监听配置模式变化，切换聊天数据存储模式
    let lastMode: ApiMode = useConfigStore.getState().apiMode;
    useConfigStore.subscribe((state) => {
        if (state.apiMode === lastMode) {
            return;
        }
        lastMode = state.apiMode;
        reloadChatStoreForMode(state.apiMode as ApiMode);
    });
}