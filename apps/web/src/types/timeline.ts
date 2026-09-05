// timeline.ts — assistant 消息的「过程时间线」前端本地类型契约。
//
// 设计参考：ChatGPT "Thought for Xs" 折叠胶囊 / claude.ai 流式思考折叠区 /
// Cursor 工具卡片（密度分级）。思考、工具调用、每轮前导文本统一为时间线
// 条目，挂在 assistant 消息上（气泡内、正文之上），流式时实时展开、完成后
// 全部折叠为单行摘要——正文气泡只承载最终回答，消灭"思考写了又删"。
//
// 生命周期：
// - 流式期间：sessionStore 的 SSE 回调实时追加/更新条目（live 路径）
// - 刷新后：utils/timeline.ts 从服务端消息（assistant(toolCalls) + role=tool）
//   聚组重建同样结构（rebuild 路径；reasoning 不持久化，刷新后不回放）
import type { Message } from '@my-copilot/shared';

/**
 * 时间线条目判别联合。
 * - reasoning：Extended Thinking 推理文本（流式累积；done=false 表示仍在思考）
 * - lead：某轮工具调用前的前导文本（"好的，我来调用…"），不再进正文气泡
 * - tool：一次工具调用（running → done/error，含参数与结果回填）
 */
export type TimelineEntry =
  | {
      kind: 'reasoning';
      id: string;
      /** 累积中的推理文本（流式期间增长）。 */
      text: string;
      /** 回答/工具调用开始后置 true（用于"思考中…"→"思考过程"的文案切换）。 */
      done: boolean;
    }
  | {
      kind: 'lead';
      id: string;
      /** 本轮前导文本（通常一行）。 */
      text: string;
    }
  | {
      kind: 'tool';
      /** tool_call_start 阶段为组合键 `${messageId}:${index}`，tool_call_done 后替换为服务端真实 id。 */
      id: string;
      name: string;
      status: 'running' | 'done' | 'error';
      /** JSON 编码的调用参数（tool_call_done 时回填）。 */
      args?: string;
      /** 原始结果 JSON 字符串（tool_result 时回填）。 */
      result?: string;
      /** 工具结果是否为错误（tool_result 的 isError）。 */
      isError?: boolean;
      /** 开始时间戳（条目创建时）。 */
      startedAt: number;
      /** 结束时间戳（tool_result 回填；用于展示耗时）。 */
      endedAt?: number;
    };

/**
 * 前端本地的 assistant 消息扩展（同 reasoningText 的先例：仅存在于
 * messagesCache 用于渲染，不持久化、不上行 server，故不进 shared Message）。
 */
export type MessageWithTimeline = Message & { timeline?: TimelineEntry[] };
