//Zustand - Chat状态管理
import { create } from 'zustand';
import type { Chat, ChatSummary, Message, CreateChatParams, SendMessageParams } from '../types/chat';
import { MessageRole, MessageStatus } from '../types/chat';
import { mockApi } from '../utils/mockApi';
//todo: 使用persist持久化
interface ChatStore {
    //状态 - 分层加载架构
    chatSummaries: ChatSummary[]; // 聊天列表摘要（轻量数据）
    currentChat: Chat | null; // 当前选中聊天的完整数据
    messagesCache: Record<string, Message[]>; // 消息缓存（按聊天ID）
    selectedChatId: string;
    isSending: boolean;
    isLoadingSummaries: boolean; // 加载聊天列表状态
    isLoadingMessages: boolean; // 加载消息状态

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

}

export const useChatStore = create<ChatStore>(
    (set, get) => ({
        //初始状态 - 分层加载架构
        chatSummaries: [],
        currentChat: null,
        messagesCache: {},
        selectedChatId: '',
        isSending: false,
        isLoadingSummaries: false,
        isLoadingMessages: false,
        
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
                const summaries = await mockApi.getChatSummaries();
                set({ chatSummaries: summaries, isLoadingSummaries: false });
                
                // 如果有聊天且没有选中，默认选中第一个
                if (summaries.length > 0 && !get().selectedChatId) {
                    get().setSelectedChatId(summaries[0].id);
                }
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
                const messages = await mockApi.getChatMessages(chatId);
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
            set({ selectedChatId: id });
            // 如果消息未加载，则加载
            if (id && !get().messagesCache[id]) {
                get().loadChatMessages(id);
            } else if (id) {
                // 如果已缓存，直接设置 currentChat
                const summary = get().chatSummaries.find(s => s.id === id);
                if (summary) {
                    set({
                        currentChat: {
                            ...summary,
                            messages: get().messagesCache[id],
                        },
                    });
                }
            } else {
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
                        },
                    ]
                    : [],
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };

            get().addChat(newChat);
            return newChat;
        },

        // 发送消息
        sendMessage: async (params) => {
            const { chatId, content, role = MessageRole.USER } = params;
            const { addMessage, updateMessage } = get();

            // 创建用户消息
            const userMessage: Message = {
                id: `msg-${Date.now()}`,
                role,
                content,
                timestamp: Date.now(),
                status: MessageStatus.SENDING,
            };

            addMessage(chatId, userMessage);

            // 更新发送状态
            set({ isSending: true });

            try {
                // TODO: 调用 API 发送消息
                // const response = await api.sendMessage(params);

                // 模拟 API 调用
                await new Promise((resolve) => setTimeout(resolve, 1000));

                // 更新消息状态为已发送
                updateMessage(chatId, userMessage.id, {
                    status: MessageStatus.SENT,
                });

                // TODO: 添加 AI 回复消息
                // const assistantMessage = await api.getAssistantResponse(chatId);
                // addMessage(chatId, assistantMessage);

            } catch (error) {
                // 更新消息状态为失败
                updateMessage(chatId, userMessage.id, {
                    status: MessageStatus.FAILED,
                    error: error instanceof Error ? error.message : '发送失败',
                });
            } finally {
                set({ isSending: false });
            }
        },

    }),
)