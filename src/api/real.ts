/**
 * Real API 实现模块
 * 
 * 包含所有 Real 模式下的 API 实现，调用真实后端接口
 * 当前暂时复用 Mock 实现，后续逐步接入真实 API
 */

import type { ChatSummary, Message } from '../types/chat';
import type { User } from '../types/user';
import type { ApiResponse } from '../types/api';
import { ApiStatusCode } from '../types/api';
import type { StreamAIResponseParams, StreamAIResponseData } from './types';
// import { enhancedFetch } from './request';
// import type { RequestOptions } from './request';
import { StreamError } from './errors';
import { streamChatCompletion } from '../utils/llm';
import { useConfigStore } from '../store/configStore';
import {
  fetchChatSummariesMock,
  fetchChatMessagesMock,
  fetchUserMock,
  sendMessageMock,
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
  // TODO: 使用 enhancedFetch 调用真实后端接口 GET /api/chats/summaries
  // const options: RequestOptions = {
  //   method: 'GET',
  //   timeout: 30000,
  //   retry: true,
  //   maxRetries: 3,
  // };
  // return await enhancedFetch<ApiResponse<ChatSummary[]>>('/api/chats/summaries', options);
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
  // TODO: 使用 enhancedFetch 调用真实后端接口 GET /api/chats/:chatId/messages
  // const options: RequestOptions = {
  //   method: 'GET',
  //   timeout: 30000,
  //   retry: true,
  //   maxRetries: 3,
  // };
  // return await enhancedFetch<ApiResponse<Message[]>>(`/api/chats/${chatId}/messages`, options);
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
  // TODO: 使用 enhancedFetch 调用真实后端接口 GET /api/user
  // const options: RequestOptions = {
  //   method: 'GET',
  //   timeout: 30000,
  //   retry: true,
  //   maxRetries: 3,
  // };
  // return await enhancedFetch<ApiResponse<User>>('/api/user', options);
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
  // TODO: 使用 enhancedFetch 调用真实后端接口 POST /api/chats/:chatId/messages
  // const options: RequestOptions = {
  //   method: 'POST',
  //   headers: {
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({ content }),
  //   timeout: 60000, // 消息发送可能需要更长时间
  //   retry: true,
  //   maxRetries: 2, // 消息发送重试次数较少
  // };
  // return await enhancedFetch<ApiResponse<Message>>(`/api/chats/${chatId}/messages`, options);
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
  const config = useConfigStore.getState().openaiConfig;

  if (!config) {
    throw new StreamError('OpenAI 配置缺失，请在设置中填写 API Key、Base URL 和模型');
  }

  const messages = ensureMessagesPayload(params);

  const streamData = await streamChatCompletion({
    config,
    messages,
    signal: params.signal,
  });

  return {
    code: ApiStatusCode.SUCCESS,
    msg: 'AI 流式回复已开始',
    data: streamData,
  };
};

//确保消息内容不为空
function ensureMessagesPayload(params: StreamAIResponseParams): Message[] {
  if (params.messages && params.messages.length > 0) {
    return params.messages;
  }

  return [
    {
      id: `prompt-${Date.now()}`,
      role: 'user',
      content: params.prompt,
      timestamp: Date.now(),
      attachments: [],
    },
  ];
}

