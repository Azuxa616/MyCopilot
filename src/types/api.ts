/**
 * API 状态码常量对象
 */
export const ApiStatusCode = {
  SUCCESS: 200,
  BAD_REQUEST: 400,
  NOT_FOUND: 404,
  SERVER_ERROR: 500,
} as const;

/**
 * API 状态码类型
 */
export type ApiStatusCode = (typeof ApiStatusCode)[keyof typeof ApiStatusCode];

export interface ApiResponse<T> {
  code: ApiStatusCode | number;
  msg: string;
  data: T;
}

