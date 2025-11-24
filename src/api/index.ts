/**
 * API 统一入口模块
 * 
 * 功能：
 * 1. 统一管理所有 API 调用，支持 Mock 和 Real 两种模式切换
 * 2. Mock 模式下从本地 JSON 文件读取数据，用于开发和测试
 * 3. Real 模式下调用真实后端接口（逐步接入）
 * 4. 提供流式 SSE 接口用于 AI 回复
 * 
 * 使用方式：
 * ```ts
 * import { api } from './api';
 * const summaries = await api.fetchChatSummaries();
 * ```
 */

import type { ChatSummary, Message } from '../types/chat';
import type { User } from '../types/user';
import type { ApiResponse } from '../types/api';
import { ApiStatusCode } from '../types/api';
import type { StreamAIResponseParams, StreamAIResponseData } from './types';
import { BusinessError, isApiError } from './errors';
import { useConfigStore } from '../store/configStore';
import {
  fetchChatSummariesMock,
  fetchChatMessagesMock,
  fetchUserMock,
  sendMessageMock,
  streamAIResponseMock,
} from './mock';
import {
  fetchChatSummariesReal,
  fetchChatMessagesReal,
  fetchUserReal,
  sendMessageReal,
  streamAIResponseReal,
} from './real';

// 导出类型定义
export type { StreamAIResponseParams, StreamAIResponseData } from './types';

/**
 * 通用响应解包工具
 * 
 * 将后端返回的 ApiResponse<T> 格式解包为业务数据类型 T
 * 如果响应码不是成功，则抛出 BusinessError
 * 同时捕获网络层面的错误并保持错误类型
 * 
 * @template T 业务数据类型
 * @param request API 请求 Promise
 * @returns 解包后的业务数据
 * @throws {BusinessError} 当响应码不是成功时抛出业务错误
 * @throws {ApiError} 当发生网络错误、超时等时抛出对应的 API 错误
 */
const unwrapResponse = async <T>(request: Promise<ApiResponse<T>>): Promise<T> => {
  try {
    const response = await request;
    if (response.code === ApiStatusCode.SUCCESS) {
      return response.data;
    }
    throw new BusinessError(
      response.msg || '请求失败',
      response.code,
      response.msg || '请求失败',
    );
  } catch (error) {
    // 如果已经是 ApiError，直接抛出；否则包装为 BusinessError
    if (isApiError(error)) {
      throw error;
    }
    throw new BusinessError(
      error instanceof Error ? error.message : String(error),
      0,
      error instanceof Error ? error.message : '未知错误',
    );
  }
};

// ===== API 模式定义与切换 =====

/**
 * API 模式常量
 * 
 * - MOCK: 使用本地 mock 数据（从 mock/*.json 读取）
 * - REAL: 使用真实后端 API（逐步接入中）
 */
export const ApiMode = {
  /** Mock 模式：使用本地 JSON 数据 */
  MOCK: 'mock',
  /** Real 模式：使用真实后端接口 */
  REAL: 'real',
} as const;

/**
 * API 模式类型
 */
export type ApiMode = (typeof ApiMode)[keyof typeof ApiMode];

/**
 * 获取当前 API 模式（从 configStore 读取）
 * 
 * @returns 当前 API 模式
 */
export const getApiMode = (): ApiMode => {
  return useConfigStore.getState().apiMode;
};

// ===== 统一对外 API（根据模式切换实现）=====

/**
 * 统一对外 API 对象
 * 
 * 所有 API 调用都通过此对象进行，内部根据当前 apiMode 自动选择 Mock 或 Real 实现
 * 
 * 使用示例：
 * ```ts
 * import { api } from './api';
 * 
 * // 获取聊天列表
 * const summaries = await api.fetchChatSummaries();
 * 
 * // 获取消息
 * const messages = await api.fetchChatMessages('chat-123');
 * 
 * // 流式 AI 回复
 * const streamData = await api.streamAIResponse({
 *   chatId: 'chat-123',
 *   prompt: '你好',
 * });
 * const reader = streamData.stream.getReader();
 * // ... 读取流数据
 * ```
 */
export const api = {
  /**
   * 获取聊天列表摘要
   * 
   * 返回所有聊天的摘要信息（不含完整消息），用于列表展示
   * 
   * @returns 聊天摘要列表
   * @throws {Error} 当请求失败时抛出错误
   * 
   * @example
   * ```ts
   * const summaries = await api.fetchChatSummaries();
   * console.log(summaries); // [{ id: 'chat-1', title: '对话1', ... }, ...]
   * ```
   */
  fetchChatSummaries: (): Promise<ChatSummary[]> =>
    unwrapResponse(
      getApiMode() === ApiMode.MOCK ? fetchChatSummariesMock() : fetchChatSummariesReal(),
    ),

  /**
   * 获取指定聊天的完整消息列表
   * 
   * 按需加载单个聊天的所有消息，用于消息列表展示
   * 
   * @param chatId 聊天 ID
   * @returns 消息列表
   * @throws {Error} 当请求失败或聊天不存在时抛出错误
   * 
   * @example
   * ```ts
   * const messages = await api.fetchChatMessages('chat-123');
   * console.log(messages); // [{ id: 'msg-1', role: 'user', content: '...', ... }, ...]
   * ```
   */
  fetchChatMessages: (chatId: string): Promise<Message[]> =>
    unwrapResponse(
      getApiMode() === ApiMode.MOCK
        ? fetchChatMessagesMock(chatId)
        : fetchChatMessagesReal(chatId),
    ),

  /**
   * 获取当前用户信息
   * 
   * @returns 用户信息
   * @throws {Error} 当请求失败时抛出错误
   * 
   * @example
   * ```ts
   * const user = await api.fetchUser();
   * console.log(user); // { id: 'user-1', name: '张三', avatar: '...', ... }
   * ```
   */
  fetchUser: (): Promise<User> =>
    unwrapResponse(getApiMode() === ApiMode.MOCK ? fetchUserMock() : fetchUserReal()),

  /**
   * 发送消息（非流式）
   * 
   * 发送一条消息并等待完整回复
   * 
   * 注意：推荐使用 streamAIResponse 进行流式回复，以获得更好的用户体验
   * 
   * @param chatId 聊天 ID
   * @param content 消息内容
   * @returns 助手回复消息
   * @throws {Error} 当请求失败时抛出错误
   * 
   * @example
   * ```ts
   * const reply = await api.sendMessage('chat-123', '你好');
   * console.log(reply.content); // '这是对 "你好" 的回复'
   * ```
   */
  sendMessage: (chatId: string, content: string): Promise<Message> =>
    unwrapResponse(
      getApiMode() === ApiMode.MOCK
        ? sendMessageMock(chatId, content)
        : sendMessageReal(chatId, content),
    ),

  /**
   * AI 流式回复
   * 
   * 启动 AI 流式回复，返回 SSE 流对象，可以实时读取 AI 回复内容
   * 
   * @param params 流式回复参数
   * @param params.chatId 聊天 ID
   * @param params.prompt 用户输入的提示词
   * @param params.signal 可选的取消信号，用于中断流式请求
   * @param params.chunkDelay 仅 mock 模式下有效，控制推送间隔（毫秒）
   * @returns 包含 SSE 流和相关元数据的响应
   * @throws {Error} 当请求失败时抛出错误
   * 
   * @example
   * ```ts
   * const streamData = await api.streamAIResponse({
   *   chatId: 'chat-123',
   *   prompt: '请介绍一下 TypeScript',
   * });
   * 
   * const reader = streamData.stream.getReader();
   * const decoder = new TextDecoder();
   * 
   * while (true) {
   *   const { value, done } = await reader.read();
   *   if (done) break;
   *   
   *   const chunk = decoder.decode(value);
   *   // 解析 SSE 格式并更新 UI
   * }
   * 
   * // 或手动关闭流
   * streamData.close();
   * ```
   */
  streamAIResponse: (params: StreamAIResponseParams): Promise<StreamAIResponseData> =>
    unwrapResponse(
      getApiMode() === ApiMode.MOCK
        ? streamAIResponseMock(params)
        : streamAIResponseReal(params),
    ),
};

// ===== 导出错误类型和工具函数 =====

// 导出错误类型
export {
  ApiError,
  NetworkError,
  HttpError,
  TimeoutError,
  BusinessError,
  AbortError,
  StreamError,
} from './errors';

// 导出错误工具函数
export {
  isApiError,
  getErrorMessage,
  getErrorCode,
  isRetryableError,
} from './errors';

// 导出请求工具函数
export { enhancedFetch, createTimeoutSignal } from './request';
export type { RequestOptions } from './request';
