/**
 * API 请求包装器模块
 * 
 * 提供通用的请求包装函数，包括超时控制、自动重试和错误处理
 */

import {
  ApiError,
  NetworkError,
  HttpError,
  AbortError,
  isRetryableError,
} from './errors';

/**
 * 请求配置选项
 */
export interface RequestOptions extends RequestInit {
  /** 超时时间（毫秒），默认 30000（30秒） */
  timeout?: number;
  /** 是否启用自动重试，默认 false */
  retry?: boolean;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
  /** 重试延迟函数，接收当前重试次数，返回延迟时间（毫秒） */
  retryDelay?: (attempt: number) => number;
}

/**
 * 默认超时时间（30秒）
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * 默认最大重试次数
 */
const DEFAULT_MAX_RETRIES = 3;

/**
 * 默认重试延迟策略：指数退避
 * 第1次重试：1秒
 * 第2次重试：2秒
 * 第3次重试：4秒
 * 
 * @param attempt 当前重试次数（从1开始）
 * @returns 延迟时间（毫秒）
 */
const defaultRetryDelay = (attempt: number): number => {
  return Math.min(1000 * Math.pow(2, attempt - 1), 10000); // 最大10秒
};


/**
 * 统一处理 fetch 错误
 * 
 * 将各种 fetch 错误转换为对应的 ApiError 类型
 * 
 * @param error 原始错误
 * @param url 请求 URL
 * @param method 请求方法
 * @returns ApiError 实例
 */
function handleFetchError(error: unknown, url?: string, method?: string): ApiError {
  // 如果已经是 ApiError，直接返回
  if (error instanceof ApiError) {
    return error;
  }

  // AbortError（请求取消）
  if (error instanceof Error && error.name === 'AbortError') {
    return new AbortError(url, method);
  }

  // TypeError（通常是网络错误）
  if (error instanceof TypeError) {
    return new NetworkError(
      `网络请求失败: ${error.message}`,
      error,
      url,
      method,
    );
  }

  // 其他未知错误
  return new NetworkError(
    `请求失败: ${error instanceof Error ? error.message : String(error)}`,
    error,
    url,
    method,
  );
}

/**
 * 解析响应并处理 HTTP 错误
 * 
 * @param response fetch 响应对象
 * @param url 请求 URL
 * @param method 请求方法
 * @returns 解析后的响应数据
 * @throws {HttpError} 当响应状态码不是 2xx 时抛出
 */
async function parseResponse<T>(
  response: Response,
  url?: string,
  method?: string,
): Promise<T> {
  if (!response.ok) {
    const contentType = response.headers.get('content-type');
    let responseBody: unknown;
    try {
      responseBody = contentType?.includes('application/json')
        ? await response.json()
        : await response.text();
    } catch {
      responseBody = undefined;
    }
    throw new HttpError(
      `HTTP ${response.status}: ${response.statusText}`,
      response.status,
      responseBody,
      url,
      method,
    );
  }

  try {
    const contentType = response.headers.get('content-type');
    return contentType?.includes('application/json')
      ? ((await response.json()) as T)
      : ((await response.text()) as T);
  } catch (error) {
    throw new NetworkError(
      `解析响应失败: ${error instanceof Error ? error.message : String(error)}`,
      error,
      url,
      method,
    );
  }
}

/**
 * 带重试的请求执行
 * 
 * @param requestFn 请求函数
 * @param options 请求选项
 * @param attempt 当前尝试次数（从1开始）
 * @returns 请求结果
 */
async function requestWithRetry<T>(
  requestFn: () => Promise<T>,
  options: RequestOptions,
  attempt: number = 1,
): Promise<T> {
  try {
    return await requestFn();
  } catch (error) {
    const { maxRetries = DEFAULT_MAX_RETRIES, retryDelay = defaultRetryDelay } = options;

    // 检查是否应该重试
    if (attempt >= maxRetries || !isRetryableError(error)) {
      throw error;
    }

    // 计算延迟时间
    const delay = retryDelay(attempt);

    // 等待后重试
    await new Promise(resolve => setTimeout(resolve, delay));

    // 递归重试
    return requestWithRetry(requestFn, options, attempt + 1);
  }
}

/**
 * 增强的 fetch 函数
 * 
 * 提供超时控制、自动重试和统一的错误处理
 * 
 * @param url 请求 URL
 * @param options 请求选项（包括超时、重试等配置）
 * @returns 解析后的响应数据
 * @throws {ApiError} 各种 API 错误类型
 * 
 * @example
 * ```ts
 * // 基础用法
 * const data = await enhancedFetch<ApiResponse<User>>('/api/user');
 * 
 * // 带超时和重试
 * const data = await enhancedFetch<ApiResponse<ChatSummary[]>>('/api/chats', {
 *   timeout: 10000,
 *   retry: true,
 *   maxRetries: 3,
 * });
 * ```
 */
export async function enhancedFetch<T>(
  url: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    timeout = DEFAULT_TIMEOUT,
    retry = false,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelay = defaultRetryDelay,
    signal,
    ...fetchOptions
  } = options;

  // 创建超时控制器
  const timeoutController = new AbortController();
  const timeoutId = setTimeout(() => timeoutController.abort(), timeout);

  // 合并 signal：如果提供了自定义 signal，任一取消都会触发请求取消
  let finalSignal: AbortSignal = timeoutController.signal;
  if (signal) {
    const combinedController = new AbortController();
    const abort = () => combinedController.abort();
    signal.addEventListener('abort', abort);
    timeoutController.signal.addEventListener('abort', abort);
    finalSignal = combinedController.signal;
  }

  // 请求函数
  const requestFn = async (): Promise<T> => {
    try {
      const response = await fetch(url, {
        ...fetchOptions,
        signal: finalSignal,
      });
      clearTimeout(timeoutId);
      return await parseResponse<T>(response, url, options.method);
    } catch (error) {
      clearTimeout(timeoutId);
      throw handleFetchError(error, url, options.method);
    }
  };

  return retry
    ? requestWithRetry(requestFn, { maxRetries, retryDelay })
    : requestFn();
}

/**
 * 创建带超时控制的 AbortSignal
 * 
 * @param timeout 超时时间（毫秒）
 * @returns AbortSignal 和清理函数
 */
export function createTimeoutSignal(timeout: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeout);

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timeoutId);
    },
  };
}

