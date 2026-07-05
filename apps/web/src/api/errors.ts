/**
 * API 错误类型定义模块
 * 
 * 提供统一的错误类型系统，用于分类和处理各种 API 请求错误
 */

/**
 * API 错误基类
 * 
 * 所有 API 相关错误都继承自此基类，提供统一的错误信息结构
 */
export class ApiError extends Error {
  /** 错误码（可以是 HTTP 状态码或业务错误码） */
  public readonly code: number;
  /** 原始错误对象（如果有） */
  public readonly originalError?: unknown;
  /** 请求 URL（如果有） */
  public readonly url?: string;
  /** 请求方法（如果有） */
  public readonly method?: string;

  constructor(
    message: string,
    code: number = 0,
    originalError?: unknown,
    url?: string,
    method?: string,
  ) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.originalError = originalError;
    this.url = url;
    this.method = method;

    // 保持正确的原型链
    Object.setPrototypeOf(this, ApiError.prototype);
  }
}

/**
 * 网络连接错误
 * 
 * 当 fetch 请求失败、网络断开、CORS 错误等时抛出
 */
export class NetworkError extends ApiError {
  constructor(message: string, originalError?: unknown, url?: string, method?: string) {
    super(message, 0, originalError, url, method);
    Object.setPrototypeOf(this, NetworkError.prototype);
  }
}

/**
 * HTTP 错误
 * 
 * 当服务器返回非 2xx 状态码时抛出
 */
export class HttpError extends ApiError {
  /** HTTP 状态码 */
  public readonly status: number;
  /** 响应体（如果有） */
  public readonly responseBody?: unknown;

  constructor(
    message: string,
    status: number,
    responseBody?: unknown,
    url?: string,
    method?: string,
  ) {
    super(message, status, undefined, url, method);
    this.status = status;
    this.responseBody = responseBody;
    Object.setPrototypeOf(this, HttpError.prototype);
  }
}

/**
 * 请求超时错误
 * 
 * 当请求超过指定时间未完成时抛出
 */
export class TimeoutError extends ApiError {
  /** 超时时间（毫秒） */
  public readonly timeout: number;

  constructor(timeout: number, url?: string, method?: string) {
    super(`请求超时（${timeout}ms）`, 408, undefined, url, method);
    this.timeout = timeout;
    Object.setPrototypeOf(this, TimeoutError.prototype);
  }
}

/**
 * 业务逻辑错误
 * 
 * 当后端返回非成功的业务响应码时抛出
 */
export class BusinessError extends ApiError {
  /** 业务错误消息 */
  public readonly businessMessage: string;

  constructor(message: string, code: number, businessMessage: string, url?: string) {
    super(message, code, undefined, url);
    this.businessMessage = businessMessage;
    Object.setPrototypeOf(this, BusinessError.prototype);
  }
}

/**
 * 请求取消错误
 * 
 * 当请求被 AbortSignal 取消时抛出
 */
export class AbortError extends ApiError {
  constructor(url?: string, method?: string) {
    super('请求已取消', 499, undefined, url, method);
    Object.setPrototypeOf(this, AbortError.prototype);
  }
}

/**
 * 流式请求错误
 * 
 * 当流式请求（SSE）过程中发生错误时抛出
 */
export class StreamError extends ApiError {
  /** 流请求 ID（如果有） */
  public readonly requestId?: string;

  constructor(message: string, requestId?: string, originalError?: unknown) {
    super(message, 0, originalError);
    this.requestId = requestId;
    Object.setPrototypeOf(this, StreamError.prototype);
  }
}

// ===== 错误工具函数 =====

/**
 * 判断是否为 API 错误
 * 
 * @param error 要检查的错误对象
 * @returns 是否为 ApiError 实例
 */
export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

/**
 * 获取用户友好的错误消息
 * 
 * 根据错误类型返回适合展示给用户的错误消息
 * 
 * @param error 错误对象
 * @returns 用户友好的错误消息
 */
export function getErrorMessage(error: unknown): string {
  if (isApiError(error)) {
    // 业务错误直接返回业务消息
    if (error instanceof BusinessError) {
      return error.businessMessage || error.message;
    }
    // 其他 API 错误返回错误消息
    return error.message;
  }

  // 原生 Error 对象
  if (error instanceof Error) {
    return error.message;
  }

  // 字符串错误
  if (typeof error === 'string') {
    return error;
  }

  // 未知错误
  return '发生未知错误，请稍后重试';
}

/**
 * 获取错误码
 * 
 * @param error 错误对象
 * @returns 错误码，如果不是 API 错误则返回 0
 */
export function getErrorCode(error: unknown): number {
  if (isApiError(error)) {
    return error.code;
  }
  return 0;
}

/**
 * 判断错误是否可重试
 * 
 * 网络错误、超时错误和 5xx 错误通常可以重试
 * 
 * @param error 错误对象
 * @returns 是否可重试
 */
export function isRetryableError(error: unknown): boolean {
  if (isApiError(error)) {
    // 网络错误和超时错误可以重试
    if (error instanceof NetworkError || error instanceof TimeoutError) {
      return true;
    }
    // 5xx 服务器错误可以重试
    if (error instanceof HttpError && error.status >= 500) {
      return true;
    }
    // 请求取消和业务错误不应该重试
    if (error instanceof AbortError || error instanceof BusinessError) {
      return false;
    }
  }
  return false;
}

