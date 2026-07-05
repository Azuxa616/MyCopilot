/**
 * Global API error handler
 *
 * Provides unified error handling for API calls:
 * - NetworkError → show network error alert
 * - HttpError 401 → TokenModal (handled by request.ts already)
 * - HttpError 4xx → show business error message
 * - StreamError → show stream interrupted alert
 */

import {
    NetworkError,
    HttpError,
    StreamError,
} from '../api/errors';
import { showMessageAlert } from '../components/common/Alert/alertUtils';

export function handleApiError(err: unknown): void {
    // Network errors
    if (err instanceof NetworkError) {
        showMessageAlert.error('网络连接失败，请检查网络后重试');
        return;
    }

    // HTTP errors
    if (err instanceof HttpError) {
        // 401 is handled by request.ts (triggers TokenModal)
        if (err.status === 401) {
            return;
        }

        // 4xx client errors - show business message
        if (err.status >= 400 && err.status < 500) {
            const message =
                typeof err.responseBody === 'string'
                    ? err.responseBody
                    : err.message;
            showMessageAlert.error(message || '请求参数错误');
            return;
        }

        // 5xx server errors
        if (err.status >= 500) {
            showMessageAlert.error('服务器错误，请稍后重试');
            return;
        }
    }

    // Stream errors
    if (err instanceof StreamError) {
        showMessageAlert.error('流式响应中断，请重试');
        return;
    }

    // Unknown errors
    console.error('Unhandled API error:', err);
    showMessageAlert.error('发生未知错误，请稍后重试');
}
