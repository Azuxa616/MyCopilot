import type { ChatSummary, Message, Chat } from '../types/chat';
import type { User } from '../types/user';
import chatData from '../../mock/chat.json';

/**
 * 模拟网络延迟
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Mock API 服务
 * 模拟后端 API 调用，用于开发和测试
 */
export const mockApi = {
  /**
   * 获取聊天列表摘要（轻量数据，不含完整消息）
   */
  async getChatSummaries(): Promise<ChatSummary[]> {
    await delay(300); // 模拟网络延迟
    
    return (chatData.chats as Chat[]).map(chat => ({
      id: chat.id,
      title: chat.title,
      createdAt: chat.createdAt,
      updatedAt: chat.updatedAt,
      messageCount: chat.messages.length,
    }));
  },

  /**
   * 按需加载单个聊天的完整消息列表
   */
  async getChatMessages(chatId: string): Promise<Message[]> {
    await delay(500); // 模拟网络延迟
    
    const chat = (chatData.chats as Chat[]).find(c => c.id === chatId);
    if (!chat) {
      throw new Error(`Chat with id ${chatId} not found`);
    }
    
    return chat.messages;
  },

  /**
   * 获取用户信息
   */
  async getUser(): Promise<User> {
    await delay(300); // 模拟网络延迟
    
    return {
      username: 'Azuxa616',
      email: 'azuxa616@gmail.com',
      avatarUrl: 'https://avatars.githubusercontent.com/u/123456789?v=4',
    };
  },

  /**
   * 发送消息（模拟）
   */
  async sendMessage(_chatId: string, content: string): Promise<Message> {
    await delay(1000); // 模拟网络延迟
    
    return {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content: `这是对 "${content}" 的模拟回复`,
      timestamp: Date.now(),
      status: 'sent',
    };
  },
};

