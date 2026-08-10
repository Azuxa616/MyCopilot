/**
 * Lifecycle Hooks Extension Point - TypeScript 类型。
 *
 * 自包含模块：无 import。可用
 * `tsc --noEmit docs/rfc/types/extension-points/lifecycle-hooks.d.ts` 独立通过类型检查。
 *
 * 镜像 docs/rfc/schemas/extension-points/lifecycle-hooks.schema.json。
 *
 * 决策 A3 的 hook 子集：
 *   on_app_loaded, on_message_received, on_llm_request, on_llm_response,
 *   on_tool_call, on_plugin_loaded, on_plugin_unloaded
 *
 * 桥接目标：apps/server/src/agent-loop/runner.ts 的 onEvent 回调。
 */

/** 插件可以订阅的七个运行内 hook 事件（决策 A3）。 */
export type LifecycleHookEvent =
  | 'on_app_loaded'
  | 'on_message_received'
  | 'on_llm_request'
  | 'on_llm_response'
  | 'on_tool_call'
  | 'on_plugin_loaded'
  | 'on_plugin_unloaded';

/** payload 按事件不同；host 只填充其已有的字段。 */
export interface LifecycleHookPayload {
  sessionId?: string;
  agentId?: string;
  runId?: string;
  messageId?: string;
  /** on_tool_call 时存在。 */
  toolName?: string;
  toolCallId?: string;
  toolArguments?: Record<string, unknown>;
  /** on_llm_request / on_llm_response 时存在。 */
  model?: string;
  /** on_message_received 时存在。 */
  userContent?: string;
  /** 调用方 plugin id，由服务端强制。 */
  pluginId: string;
}

/** 运行单个 hook handler 的结果。 */
export interface LifecycleHookResult {
  /** 'continue' 让 agent loop 继续；'abort' 停止运行。 */
  action: 'continue' | 'abort';
  /** 当 action === 'abort' 时向用户浮现的可选 reason。 */
  reason?: string;
  /** 可选的 telemetry；host 永不解释其内容。 */
  meta?: Record<string, unknown>;
}

/** 当匹配事件触发时 host 调用的 handler。 */
export interface LifecycleHookHandler {
  event: LifecycleHookEvent;
  handle(payload: LifecycleHookPayload): Promise<LifecycleHookResult>;
}

/** host 为每个已启用插件保留的注册记录。 */
export interface LifecycleHookRegistration {
  pluginId: string;
  handlers: LifecycleHookHandler[];
}

/** 预算；按 handler 的硬上限（T4 规范第 10 节）。 */
export interface LifecycleHookBudget {
  /** 每次 handler 调用的最大 ms 数。默认 5000。 */
  handlerTimeoutMs: number;
  /** 单个插件最多可注册的 handler 数。默认 16。 */
  maxHandlersPerPlugin: number;
}

export declare const DEFAULT_LIFECYCLE_HOOK_BUDGET: LifecycleHookBudget;
