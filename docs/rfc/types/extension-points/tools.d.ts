/**
 * Tools Extension Point - TypeScript 类型。
 *
 * 自包含模块：无 import。可用
 * `tsc --noEmit docs/rfc/types/extension-points/tools.d.ts` 独立通过类型检查。
 *
 * 镜像 docs/rfc/schemas/extension-points/tools.schema.json 以及
 * docs/rfc/plugin-extension-points.md 的 Tools EP 章节。
 *
 * 桥接目标：apps/server/src/tools/registry.ts (ToolExecutor) 以及
 * apps/server/src/tools/executor.ts (3 级安全 + stricterLevel)。
 */

/** 继承自既有 executor 的 3 级安全层级取值。 */
export type SafetyLevel = 'safe' | 'restricted' | 'danger';

/** 插件注册 tool 的外部地址：`pluginId:toolName`。 */
export type NamespacedToolName = string;

/** 向 LLM 和前端广播的静态描述符。 */
export interface PluginToolDescriptor {
  /** 全限定名 `pluginId:toolName`。 */
  name: NamespacedToolName;
  /** 展示给 LLM 的可读摘要。 */
  description: string;
  /** 由 LLM 填写的 JSON-schema 输入形态。 */
  inputSchema: Record<string, unknown>;
  /** 声明的安全层级。插件 tool 默认为 'restricted'。 */
  safetyLevel: SafetyLevel;
}

/** 统一的结果形态，与 registry.ts 中的 ToolExecutionResult 相同。 */
export interface PluginToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

/** 交给每个插件 tool executor 的运行时上下文。 */
export interface PluginToolContext {
  signal?: AbortSignal;
  sessionId: string;
  agentId?: string;
  runId?: string;
  jobId?: string;
  /** 调用方 plugin id，由服务端强制（调用方无法伪造）。 */
  pluginId: string;
}

/**
 * 插件实现的 Tool Executor 接口。它与 apps/server/src/tools/registry.ts 中的
 * `ToolExecutor` 结构相同，因此既有的 registry 和 executor 代码路径无需改动即可工作。
 */
export interface PluginToolExecutor {
  execute(
    args: Record<string, unknown>,
    context: PluginToolContext,
  ): Promise<PluginToolResult>;
  describe(): PluginToolDescriptor;
}

/** host 从一个已启用插件收到的注册请求。 */
export interface ToolRegistration {
  pluginId: string;
  executor: PluginToolExecutor;
}

/** 名字已被占用时返回的错误。 */
export interface NamespaceConflictError {
  errorCode: 'namespace_conflict';
  fullyQualifiedName: NamespacedToolName;
  message: string;
}

/** 按调用的覆盖值；受 30 秒默认预算约束。 */
export interface ToolCallBudget {
  /** 以 ms 计的硬上限。默认 30000。最大 30000。 */
  timeoutMs: number;
}

/** host 编码的默认值；数值由 T4 规范第 10 节固定。 */
export declare const DEFAULT_TOOL_BUDGET: ToolCallBudget;
