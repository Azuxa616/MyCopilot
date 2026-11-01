// SSE 回调工厂：sendMessage（在线流）与 restoreSessionLiveState（刷新后
// 重连 /api/sessions/:id/events 重放流）共用同一套 reducer 逻辑 —— 占位
// 消息、正文/推理累积、时间线条目、activeToolCalls、状态机转移、确认与
// 提问挂起全部收敛于此，两条路径行为严格一致。
//
// 注意流引用与 AbortSignal 不在工厂内：由调用方（各自路径）持有。
// zustand 的 set/get 与 store 内的 transition 助手由调用方以参数注入，
// 避免与 sessionStore 形成运行时循环引用（SessionStore 仅作类型导入）。
import type { Message } from '@my-copilot/shared';
import type { ConfirmationEventData } from '../utils/streamUtils';
import type { MessageWithTimeline, TimelineEntry } from '../types/timeline';
import type { AgentStateTrigger } from './agent-state';
import { transitionAgentState } from './agent-state';
import { findSendingAssistantId, toolCallKey } from './session-store-types';
import type { SessionStore } from './sessionStore';

/** store 内 zustand set 的窄化签名（仅覆盖本模块用到的调用形态）。 */
type SessionSet = (
    partial: Partial<SessionStore> | ((state: SessionStore) => Partial<SessionStore>),
) => void;
/** store 内 zustand get 的签名。 */
type SessionGet = () => SessionStore;
/** 应用一次状态机转移；终态触发同时清空 activeToolCalls（实现在 sessionStore）。 */
export type TransitionFn = (trigger: AgentStateTrigger) => void;

/**
 * 时间线维护（过程时间线设计的 store 侧核心）：对 sending assistant
 * 消息的 timeline 字段做函数式更新。所有 SSE 过程回调（reasoning /
 * delta / tool_call_* / tool_result / 终态收尾）经由这里读写条目。
 */
const updateTimeline = (
    sessionId: string,
    get: SessionGet,
    fn: (entries: TimelineEntry[]) => TimelineEntry[],
): void => {
    const messages = get().messagesCache[sessionId] || [];
    const sendingId = findSendingAssistantId(messages);
    if (!sendingId) return;
    const msg = messages.find((m) => m.id === sendingId) as MessageWithTimeline;
    get().updateMessage(sessionId, sendingId, { timeline: fn(msg.timeline ?? []) });
};

/** 把最后一个未收尾的 reasoning 条目标记为 done（回答/工具开始时调用）。 */
const closeOpenReasoning = (sessionId: string, get: SessionGet): void => {
    updateTimeline(sessionId, get, (entries) => {
        const last = entries[entries.length - 1];
        if (last?.kind === 'reasoning' && !last.done) {
            return [...entries.slice(0, -1), { ...last, done: true }];
        }
        return entries;
    });
};

/** 终态收尾：仍在 running 的工具条目落定（error 终态标 error，其余标 done）。 */
const finalizeTimeline = (sessionId: string, get: SessionGet, asError: boolean): void => {
    updateTimeline(sessionId, get, (entries) =>
        entries.map((e) =>
            e.kind === 'tool' && e.status === 'running'
                ? { ...e, status: asError ? 'error' : 'done' as const, endedAt: e.endedAt ?? Date.now() }
                : e,
        ),
    );
};

export function createStreamHandlers(sessionId: string, set: SessionSet, get: SessionGet, transition: TransitionFn) {
    return {
        onPlaceholder: (msgId: string) => {
            // 幂等：刷新重连的重放流会对已持久化的占位消息重发 placeholder ——
            // 缓存里已有同 id 消息时跳过，避免重复追加。
            const existing = (get().messagesCache[sessionId] || []).some((m) => m.id === msgId);
            if (existing) return;
            const assistantMessage: Message = {
                id: msgId,
                sessionId,
                role: 'assistant',
                content: '',
                attachments: [],
                status: 'sending',
                createdAt: Date.now(),
            };
            get().addMessage(sessionId, assistantMessage);
        },
        onDelta: (deltaContent: string) => {
            transition('content_delta');
            const messages = get().messagesCache[sessionId] || [];
            const sendingId = findSendingAssistantId(messages);
            if (sendingId) {
                const lastMsg = messages.find((m) => m.id === sendingId)!;
                get().updateMessage(sessionId, sendingId, { content: lastMsg.content + deltaContent });
                closeOpenReasoning(sessionId, get);
            }
        },
        onReasoning: (reasoningDelta: string) => {
            updateTimeline(sessionId, get, (entries) => {
                const last = entries[entries.length - 1];
                if (last?.kind === 'reasoning' && !last.done) {
                    return [...entries.slice(0, -1), { ...last, text: last.text + reasoningDelta }];
                }
                return [...entries, {
                    kind: 'reasoning',
                    id: `reason-${Date.now()}-${entries.length}`,
                    text: reasoningDelta,
                    done: false,
                }];
            });
        },
        onToolCallStart: (msgId: string, index: number) => {
            // 前导文本快照：本轮首个 tool_call_start 时，把气泡中累积的当前轮
            // 文本移入时间线 lead 条目并清空气泡（正文只承载最终回答）。
            const messages = get().messagesCache[sessionId] || [];
            const sendingId = findSendingAssistantId(messages);
            if (sendingId) {
                const lastMsg = messages.find((m) => m.id === sendingId)!;
                if (lastMsg.content.trim().length > 0) {
                    const leadText = lastMsg.content;
                    closeOpenReasoning(sessionId, get);
                    updateTimeline(sessionId, get, (entries) => [...entries, {
                        kind: 'lead',
                        id: `lead-${Date.now()}-${entries.length}`,
                        text: leadText,
                    }]);
                    get().updateMessage(sessionId, sendingId, { content: '' });
                } else {
                    closeOpenReasoning(sessionId, get);
                }
                updateTimeline(sessionId, get, (entries) => [...entries, {
                    kind: 'tool',
                    id: `${msgId}:${index}`,
                    name: '',
                    status: 'running',
                    startedAt: Date.now(),
                }]);
            }
            set((state) => ({
                activeToolCalls: [
                    ...state.activeToolCalls,
                    { id: toolCallKey(msgId, index), name: '', status: 'running' },
                ],
                agentState: transitionAgentState(state.agentState, 'tool_call_start'),
            }));
        },
        onToolCallDelta: (msgId: string, index: number, _id?: string, name?: string) => {
            if (name === undefined) return;
            if (name) {
                updateTimeline(sessionId, get, (entries) => entries.map((e) =>
                    e.kind === 'tool' && e.status === 'running' && !e.name
                        ? { ...e, name }
                        : e,
                ));
            }
            set((state) => ({
                activeToolCalls: state.activeToolCalls.map((call) =>
                    call.id === toolCallKey(msgId, index) && call.status === 'running'
                        ? { ...call, name }
                        : call
                ),
            }));
        },
        onToolCallDone: (msgId: string, index: number, id: string, name: string, args?: string) => {
            if (args !== undefined) {
                updateTimeline(sessionId, get, (entries) => entries.map((e) =>
                    e.kind === 'tool' && e.id === `${msgId}:${index}`
                        ? { ...e, id, name, args }
                        : e,
                ));
            }
            set((state) => ({
                activeToolCalls: state.activeToolCalls.map((call) =>
                    call.id === toolCallKey(msgId, index)
                        ? { ...call, id, name, status: 'done' }
                        : call
                ),
                agentState: transitionAgentState(state.agentState, 'tool_call_done'),
            }));
        },
        onToolResult: (_msgId: string, toolCallId: string, result: string, isError: boolean) => {
            updateTimeline(sessionId, get, (entries) => entries.map((e) =>
                e.kind === 'tool' && e.id === toolCallId
                    ? {
                        ...e,
                        status: isError ? 'error' : 'done',
                        result,
                        isError,
                        endedAt: Date.now(),
                    }
                    : e,
            ));
            set((state) => ({
                activeToolCalls: state.activeToolCalls.map((call) =>
                    call.id === toolCallId ? { ...call, status: 'done' } : call
                ),
                // ask_user 提问的结果已到达（作答/跳过/超时）：清除挂起提问。
                ...(state.pendingQuestion?.toolCallId === toolCallId
                    ? { pendingQuestion: null }
                    : {}),
            }));
        },
        onDone: (title: string, content?: string) => {
            transition('stream_done');
            const messages = get().messagesCache[sessionId] || [];
            const sendingId = findSendingAssistantId(messages);
            if (sendingId) {
                finalizeTimeline(sessionId, get, false);
                get().updateMessage(sessionId, sendingId, {
                    status: 'sent',
                    ...(content !== undefined ? { content } : {}),
                });
            }
            if (title && title !== 'New Session') {
                get().updateSessionSummary(sessionId, { title });
            }
        },
        onError: (errorMsg: string) => {
            if (get().abortController?.signal.aborted) return;
            transition('stream_error');
            const messages = get().messagesCache[sessionId] || [];
            const sendingId = findSendingAssistantId(messages);
            if (sendingId) {
                finalizeTimeline(sessionId, get, true);
                get().updateMessage(sessionId, sendingId, {
                    status: 'failed',
                    error: errorMsg,
                });
            }
        },
        onAborted: () => {
            transition('stream_aborted');
            const messages = get().messagesCache[sessionId] || [];
            const sendingId = findSendingAssistantId(messages);
            if (sendingId) {
                finalizeTimeline(sessionId, get, false);
                get().updateMessage(sessionId, sendingId, { status: 'aborted' });
            }
        },
        onConfirmationRequired: (data: ConfirmationEventData) => {
            if (data.toolName === 'ask_user') {
                // 提问不弹确认窗：渲染为时间线内的问答卡片。
                set({
                    pendingQuestion: {
                        approvalId: data.approvalId,
                        toolCallId: data.toolCallId,
                        messageId: data.messageId,
                        expiresAt: data.expiresAt,
                    },
                });
            } else {
                set({ pendingConfirmation: data });
            }
        },
    };
}
