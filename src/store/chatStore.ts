//Zustand - Chat状态管理
import { create } from 'zustand';
import type { Chat, Message, CreateChatParams, SendMessageParams    } from '../types/chat';
import { MessageRole, MessageStatus } from '../types/chat';
//todo: 使用persist持久化
interface ChatStore {
    //状态
    chats: Chat[],
    selectedChatId: string,
    isSending: boolean,


    //Actions -聊天列表操作
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
        //初始状态
        chats: [],
        selectedChatId: '',
        isSending: false,

        // 设置聊天列表
        setChats: (chats: Chat[]) => set({ chats }),
        // 添加聊天
        addChat: (chat: Chat) => set({ chats: [chat, ...get().chats] }),
        // 更新聊天
        updateChat: (id: string, updates: Partial<Chat>) => set({ chats: get().chats.map(chat => chat.id === id ? { ...chat, ...updates } : chat) }),
        // 删除聊天
        deleteChat: (id: string) => set({ chats: get().chats.filter(chat => chat.id !== id) }),
        // 设置选中的聊天
        setSelectedChatId: (id) => set({ selectedChatId: id }),

        // 获取选中的聊天
        getSelectedChat: () => {
            const { chats, selectedChatId } = get();
            return chats.find((chat) => chat.id === selectedChatId);
        },
        // 添加消息
        addMessage: (chatId, message) =>
            set((state) => ({
                chats: state.chats.map((chat) =>
                    chat.id === chatId
                        ? {
                            ...chat,
                            messages: [...chat.messages, message],
                            updatedAt: Date.now(),
                        }
                        : chat
                ),
            })),

        // 更新消息
        updateMessage: (chatId, messageId, updates) =>
            set((state) => ({
                chats: state.chats.map((chat) =>
                    chat.id === chatId
                        ? {
                            ...chat,
                            messages: chat.messages.map((msg) =>
                                msg.id === messageId ? { ...msg, ...updates } : msg
                            ),
                            updatedAt: Date.now(),
                        }
                        : chat
                ),
            })),

        // 删除消息
        deleteMessage: (chatId, messageId) =>
            set((state) => ({
                chats: state.chats.map((chat) =>
                    chat.id === chatId
                        ? {
                            ...chat,
                            messages: chat.messages.filter((msg) => msg.id !== messageId),
                            updatedAt: Date.now(),
                        }
                        : chat
                ),
            })),

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
                pinned: false,
                archived: false,
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