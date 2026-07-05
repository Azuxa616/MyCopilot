export interface ApiResponse<T> {
  code: number;
  msg: string;
  data: T | null;
}

export const ApiStatusCode = {
  SUCCESS: 0,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  PAYLOAD_TOO_LARGE: 413,
  SERVER_ERROR: 500,
  SERVICE_UNAVAILABLE: 503,
} as const;
