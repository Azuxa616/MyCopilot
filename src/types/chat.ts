/**
 * 消息角色类型
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * 消息角色常量
 */
export const MessageRole = {
  /** 用户消息 */
  USER: 'user' as const,
  /** AI助手消息 */
  ASSISTANT: 'assistant' as const,
  /** 系统消息 */
  SYSTEM: 'system' as const,
} as const;

/**
 * 消息状态类型
 */
export type MessageStatus = 'sending' | 'sent' | 'failed';

/**
 * 消息状态常量
 */
export const MessageStatus = {
  /** 发送中 */
  SENDING: 'sending' as const,
  /** 已发送 */
  SENT: 'sent' as const,
  /** 发送失败 */
  FAILED: 'failed' as const,
} as const;

/**
 * 消息接口
 */
export interface Message {
  /** 消息唯一标识 */
  id: string;
  /** 消息角色 */
  role: MessageRole;
  /** 消息内容 */
  content: string;
  /** 附件列表 */
  attachments: Attachment[];
  /** 创建时间戳 */
  timestamp: number;
  /** 消息状态（用于显示发送状态） */
  status?: MessageStatus;
  /** 错误信息（当消息发送失败时） */
  error?: string;
}

/**
 * 聊天摘要接口（用于列表展示，不包含完整消息）
 */
export interface ChatSummary {
  /** 对话唯一标识 */
  id: string;
  /** 对话标题 */
  title: string;
  /** 创建时间戳 */
  createdAt: number;
  /** 更新时间戳 */
  updatedAt: number;
  /** 消息总数（可选） */
  messageCount?: number;
}

/**
 * 对话/会话接口
 */
export interface Chat {
  /** 对话唯一标识 */
  id: string;
  /** 对话标题 */
  title: string;
  /** 消息列表 */
  messages: Message[];
  /** 创建时间戳 */
  createdAt: number;
  /** 更新时间戳 */
  updatedAt: number;
}

/**
 * 创建新对话的参数
 */
export interface CreateChatParams {
  /** 初始标题（可选，如果不提供则使用默认标题） */
  title?: string;
  /** 初始消息（可选） */
  initialMessage?: string;
}

/**
 * 发送消息的参数
 */
export interface SendMessageParams {
  /** 对话ID */
  chatId: string;
  /** 消息内容 */
  content: string;
  /** 附件列表 */
  attachments: Attachment[];
  /** 消息角色（默认为 USER） */
  role?: MessageRole;
}

export interface Attachment {
  /** 附件唯一标识 */
  id: string;
  /** 附件名称 */
  name: string;
  /** 附件类型 */
  type: string;
  /** 附件大小 */
  size: number;
}