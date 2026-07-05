import type { Context } from 'hono';
import { successResponse } from '../utils/response.js';
import { abortStream } from './registry.js';

/** Parameters for the stop stream handler. */
export interface StopStreamParams {
  sessionId: string;
}

/**
 * Handler for the /api/sessions/:sessionId/stop endpoint.
 * Aborts the active SSE stream for a session.
 */
export function stopStreamHandler(c: Context, params: StopStreamParams): Response {
  const stopped = abortStream(params.sessionId);
  return successResponse(c, { stopped });
}
