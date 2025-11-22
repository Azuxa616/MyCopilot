/**
 * Real API 实现模块
 * 
 * 包含所有 Real 模式下的 API 实现，调用真实后端接口
 * 当前暂时复用 Mock 实现，后续逐步接入真实 API
 */

import type { ChatSummary, Message } from '../types/chat';
import type { User } from '../types/user';
import type { ApiResponse } from '../types/api';
import type { StreamAIResponseParams, StreamAIResponseData } from './types';
import {
  fetchChatSummariesMock,
  fetchChatMessagesMock,
  fetchUserMock,
  sendMessageMock,
  streamAIResponseMock,
} from './mock';

/**
 * Real: 获取聊天列表摘要
 * 
 * TODO: 接入真实后端接口
 * 当前暂时复用 Mock 实现，保证调用方逻辑稳定
 * 
 * @returns 聊天摘要列表
 */
export const fetchChatSummariesReal = async (): Promise<ApiResponse<ChatSummary[]>> => {
  // TODO: 使用 fetch 调用真实后端接口 GET /api/chats/summaries
  return fetchChatSummariesMock();
};

/**
 * Real: 获取指定聊天的完整消息列表
 * 
 * TODO: 接入真实后端接口
 * 当前暂时复用 Mock 实现，保证调用方逻辑稳定
 * 
 * @param chatId 聊天 ID
 * @returns 消息列表
 */
export const fetchChatMessagesReal = async (chatId: string): Promise<ApiResponse<Message[]>> => {
  // TODO: 使用 fetch 调用真实后端接口 GET /api/chats/:chatId/messages
  return fetchChatMessagesMock(chatId);
};

/**
 * Real: 获取用户信息
 * 
 * 当前暂时复用 Mock 实现，保证调用方逻辑稳定
 * 
 * @returns 用户信息
 */
export const fetchUserReal = async (): Promise<ApiResponse<User>> => {
  // TODO: 使用 fetch 调用真实后端接口 GET /api/user
  return fetchUserMock();
};

/**
 * Real: 发送消息（非流式）
 * 
 * TODO: 接入真实后端接口
 * 当前暂时复用 Mock 实现，保证调用方逻辑稳定
 * 
 * @param chatId 聊天 ID
 * @param content 消息内容
 * @returns 助手回复消息
 */
export const sendMessageReal = async (
  chatId: string,
  content: string,
): Promise<ApiResponse<Message>> => {
  // TODO: 使用 fetch 调用真实后端接口 POST /api/chats/:chatId/messages
  return sendMessageMock(chatId, content);
};

/**
 * Real: AI 流式回复
 * 
 * TODO: 使用标准 SSE 接口接入真实 AI 流式回复
 * 需要使用 fetch 调用真实后端 SSE 接口，从 response.body 获取 ReadableStream
 * 
 * @param params 流式回复参数
 * @returns 包含真实 SSE 流和相关元数据的响应
 */
export const streamAIResponseReal = async (
  params: StreamAIResponseParams,
): Promise<ApiResponse<StreamAIResponseData>> => {
  // TODO: 使用 fetch 调用真实后端 SSE 接口 POST /api/chats/:chatId/stream
  // 1. 设置 Accept: 'text/event-stream' 请求头
  // 2. 从 response.body 获取 ReadableStream<Uint8Array>
  // 3. 从响应头获取 requestId 和 tokenCount（如果有）
  // 4. 包装成 StreamAIResponseData 格式返回
  // 目前先占位，仍复用 Mock 实现，保证调用方逻辑稳定
  return streamAIResponseMock(params);
};

