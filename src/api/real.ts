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
// import { enhancedFetch } from './request';
// import type { RequestOptions } from './request';
// import { StreamError } from './errors';
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
  // TODO: 使用 fetch 调用真实后端 SSE 接口 POST /api/chats/:chatId/stream
  // try {
  //   const { chatId, prompt, signal } = params;
  //   const controller = new AbortController();
  //   
  //   // 合并用户提供的 signal 和超时 signal
  //   if (signal) {
  //     signal.addEventListener('abort', () => controller.abort());
  //   }
  //   
  //   const response = await fetch(`/api/chats/${chatId}/stream`, {
  //     method: 'POST',
  //     headers: {
  //       'Content-Type': 'application/json',
  //       'Accept': 'text/event-stream',
  //     },
  //     body: JSON.stringify({ prompt }),
  //     signal: controller.signal,
  //   });
  //   
  //   if (!response.ok) {
  //     throw new StreamError(`流式请求失败: HTTP ${response.status}`, undefined);
  //   }
  //   
  //   if (!response.body) {
  //     throw new StreamError('响应体为空', undefined);
  //   }
  //   
  //   const requestId = response.headers.get('X-Request-Id') || `stream-${Date.now()}`;
  //   const tokenCount = parseInt(response.headers.get('X-Token-Count') || '0', 10);
  //   
  //   // 包装流，添加错误处理
  //   const stream = wrapStreamWithErrorHandling(response.body, requestId);
  //   
  //   return {
  //     code: ApiStatusCode.SUCCESS,
  //     msg: 'AI 流式回复已开始',
  //     data: {
  //       stream,
  //       close: () => controller.abort(),
  //       requestId,
  //       contentType: 'text/event-stream',
  //       tokenCount,
  //     },
  //   };
  // } catch (error) {
  //   if (error instanceof StreamError) {
  //     throw error;
  //   }
  //   throw new StreamError(
  //     `流式请求失败: ${error instanceof Error ? error.message : String(error)}`,
  //     undefined,
  //     error,
  //   );
  // }
  
  // 目前先占位，仍复用 Mock 实现，保证调用方逻辑稳定
  return streamAIResponseMock(params);
};

// TODO: 真实 API 接入时，取消注释以下函数用于包装 SSE 流
// /**
//  * 包装流并添加错误处理
//  * 
//  * @param stream 原始流
//  * @param requestId 请求 ID
//  * @returns 包装后的流
//  */
// function wrapStreamWithErrorHandling(
//   stream: ReadableStream<Uint8Array>,
//   requestId: string,
// ): ReadableStream<Uint8Array> {
//   const reader = stream.getReader();
//
//   return new ReadableStream<Uint8Array>({
//     async start(controller) {
//       try {
//         while (true) {
//           const { done, value } = await reader.read();
//           if (done) {
//             controller.close();
//             break;
//           }
//           controller.enqueue(value);
//         }
//       } catch (error) {
//         // 流读取错误
//         controller.error(
//           new StreamError(
//             `流读取失败: ${error instanceof Error ? error.message : String(error)}`,
//             requestId,
//             error,
//           ),
//         );
//       } finally {
//         reader.releaseLock();
//       }
//     },
//     cancel() {
//       reader.cancel();
//     },
//   });
// }

