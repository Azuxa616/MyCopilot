// ---------------------------------------------------------------------------
// Agent 状态机（RFC agent-loop-v2 §7：SSE 事件到 UI 状态的可推导投影）
// ---------------------------------------------------------------------------

/** 前端 Agent 状态机状态；语义对齐 RFC §7，与后端 RunStatus 不直接共用枚举。 */
export type AgentState = 'idle' | 'thinking' | 'tool_running' | 'responding' | 'error' | 'cancelled';

/** 驱动状态机的触发事件，与 SSE 流生命周期 1:1。 */
export type AgentStateTrigger =
    | 'send'
    | 'content_delta'
    | 'tool_call_start'
    | 'tool_call_done'
    | 'stream_done'
    | 'stream_error'
    | 'stream_aborted';

/** 当前轮单个工具调用的进度（tool_call_start → tool_result），供 UI 渲染。 */
export interface ActiveToolCall {
    id: string;
    name: string;
    status: 'running' | 'done';
}

/**
 * Pending ask_user 提问（整卡等待用户作答）。restoreSessionLiveState 或
 * confirmation_required(toolName='ask_user') 事件设置；submitQuestionAnswer
 * 提交后清除（后续 tool_result 事件把结果回填进时间线）。
 */
export interface PendingQuestion {
    approvalId: string;
    toolCallId: string;
    messageId: string;
    /** 到期时间戳（ms）；0 = 无超时。 */
    expiresAt: number;
}

/**
 * 状态机转移表（RFC agent-loop-v2 §7）。非法前置状态保持不变：
 *
 * | trigger          | 转移                                        |
 * |------------------|---------------------------------------------|
 * | send             | idle → thinking（非 idle 保持）             |
 * | content_delta    | thinking / tool_running → responding        |
 * | tool_call_start  | thinking / responding → tool_running        |
 * | tool_call_done   | 保持（等 content_delta 回 responding）      |
 * | stream_done      | 任意 → idle                                 |
 * | stream_error     | 任意 → error                                |
 * | stream_aborted   | 任意 → cancelled                            |
 */
export function transitionAgentState(current: AgentState, trigger: AgentStateTrigger): AgentState {
    switch (trigger) {
        case 'send':
            return current === 'idle' ? 'thinking' : current;
        case 'content_delta':
            return current === 'thinking' || current === 'tool_running' ? 'responding' : current;
        case 'tool_call_start':
            return current === 'thinking' || current === 'responding' ? 'tool_running' : current;
        case 'tool_call_done':
            return current;
        case 'stream_done':
            return 'idle';
        case 'stream_error':
            return 'error';
        case 'stream_aborted':
            return 'cancelled';
    }
}

/** 终态触发：进入终态的同时清空当前轮 activeToolCalls。 */
export const TERMINAL_AGENT_TRIGGERS: ReadonlyArray<AgentStateTrigger> = [
    'stream_done',
    'stream_error',
    'stream_aborted',
];
