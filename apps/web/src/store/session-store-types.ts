// sessionStore 与 stream-handlers 共用的纯函数帮助器（避免两个模块互相引用）。
import type { Message } from '@my-copilot/shared';

/**
 * Find the last assistant message still in 'sending' state within a session's cache.
 * Returns its id, or undefined if none. Shared by the SSE callbacks in sendMessage.
 */
export function findSendingAssistantId(messages: Message[]): string | undefined {
    for (let i = messages.length - 1; i >= 0; i--) {
        const m = messages[i];
        if (m.role === 'assistant' && m.status === 'sending') return m.id;
    }
    return undefined;
}

/**
 * tool_call_start 只携带 (messageId, index)，尚无工具调用 id/name；
 * 先用组合键占位，tool_call_done 到达后再替换为服务端真实 id。
 */
export function toolCallKey(messageId: string, index: number): string {
    return `${messageId}:${index}`;
}
