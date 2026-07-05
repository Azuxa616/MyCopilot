import { describe, it, expect } from 'vitest';
import { ApiStatusCode } from '../api.js';
import type { ApiResponse } from '../api.js';

describe('ApiStatusCode', () => {
  it('should have correct values', () => {
    expect(ApiStatusCode.SUCCESS).toBe(0);
    expect(ApiStatusCode.BAD_REQUEST).toBe(400);
    expect(ApiStatusCode.UNAUTHORIZED).toBe(401);
    expect(ApiStatusCode.FORBIDDEN).toBe(403);
    expect(ApiStatusCode.NOT_FOUND).toBe(404);
    expect(ApiStatusCode.CONFLICT).toBe(409);
    expect(ApiStatusCode.PAYLOAD_TOO_LARGE).toBe(413);
    expect(ApiStatusCode.SERVER_ERROR).toBe(500);
    expect(ApiStatusCode.SERVICE_UNAVAILABLE).toBe(503);
  });
});

describe('ApiResponse', () => {
  it('should create a valid response object', () => {
    const response: ApiResponse<string> = {
      code: 0,
      msg: 'success',
      data: 'hello',
    };
    expect(response.code).toBe(0);
    expect(response.msg).toBe('success');
    expect(response.data).toBe('hello');
  });

  it('should allow null data', () => {
    const response: ApiResponse<null> = {
      code: 404,
      msg: 'not found',
      data: null,
    };
    expect(response.data).toBeNull();
  });
});
