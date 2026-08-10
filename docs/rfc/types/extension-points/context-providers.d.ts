/**
 * Context Providers Extension Point - TypeScript 类型。
 *
 * 自包含模块：无 import。可用
 * `tsc --noEmit docs/rfc/types/extension-points/context-providers.d.ts` 独立通过类型检查。
 *
 * 镜像 docs/rfc/schemas/extension-points/context-providers.schema.json。
 *
 * 桥接目标：apps/server/src/prompt/assembler.ts (assembleMessages)。
 */

/** provider 的外部地址：`pluginId:providerName`。 */
export type NamespacedProviderId = string;

/** provider 可检视的会话只读视图。 */
export interface ContextProviderInput {
  sessionId: string;
  agentId?: string;
  /** 当前用户轮次的文本。 */
  query: string;
  /** 已过滤为 status 'sent' 的截断消息历史。 */
  recentMessages: Array<{
    role: 'user' | 'assistant' | 'system';
    content: string;
  }>;
  signal?: AbortSignal;
}

/** 注入 system prompt 的单个块。 */
export interface ContextProviderOutput {
  /** 稳定的 label，便于 host 去重和审计。 */
  label: string;
  /** prompt 文本。空字符串会被 assembler 丢弃。 */
  text: string;
  /** 可选的排序提示；数值小者先运行。默认 100。 */
  priority?: number;
}

/** 插件实现的 provider 接口。 */
export interface ContextProvider {
  /** 稳定的 id；在 system prompt label 中以 `pluginId:providerId` 形式出现。 */
  id: string;
  /**
   * 产生一个或多个注入块。返回空数组是合法的，表示“本轮无需添加”。
   */
  provide(input: ContextProviderInput): Promise<ContextProviderOutput[]>;
}

/** 装配后的输出在 system prompt 栈中的插入位置。 */
export type ContextInjectionSlot = 'after-skills' | 'before-history';

/** 预算；默认值保持 prompt 装配有界。 */
export interface ContextProviderBudget {
  /** 一轮中所有 provider 合计的 ms 数。默认 2000。 */
  totalTimeoutMs: number;
  /** 单个 provider 最多可贡献的字符数。默认 4000。 */
  maxCharsPerProvider: number;
}

export declare const DEFAULT_CONTEXT_PROVIDER_BUDGET: ContextProviderBudget;
