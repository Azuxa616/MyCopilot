/**
 * Memory Backends Extension Point - TypeScript 类型。
 *
 * 自包含模块：无 import。可用
 * `tsc --noEmit docs/rfc/types/extension-points/memory-backends.d.ts` 独立通过类型检查。
 *
 * 镜像 docs/rfc/schemas/extension-points/memory-backends.schema.json。
 *
 * 桥接目标：T3 Context Management v2 Memory 协议以及 T4
 * plugin_data SQLite 表 + PluginStore API（决策 A5）。
 */

/** backend 的外部地址：`pluginId:backendName`。 */
export type NamespacedBackendId = string;

/** 由 get / search 返回的单条 memory 记录。 */
export interface MemoryRecord {
  /** 在 backend 内唯一的稳定 id。 */
  id: string;
  /** 命名空间；通常是 session id，但由 backend 定义。 */
  namespace: string;
  /** 自由格式文本，host 将其作为 context 转发给 LLM。 */
  content: string;
  /** 可选的结构化 metadata；host 永不检视。 */
  metadata?: Record<string, unknown>;
  /** Epoch 毫秒数。 */
  createdAt: number;
  updatedAt: number;
}

/** 传给 search() 的检索过滤器。 */
export interface MemorySearchParams {
  namespace?: string;
  query: string;
  /** 返回结果的最大数量。默认 10，硬上限 50。 */
  limit?: number;
}

/** search() 的结果行。 */
export interface MemorySearchHit {
  record: MemoryRecord;
  /** 由 backend 定义的相关性 score，取值 [0, 1]；越大越好。 */
  score: number;
}

/**
 * 插件实现的 memory backend 接口。get/set/search/delete
 * 镜像 plugin-manifest.d.ts 中的 PluginStore 形态，但操作的是
 * 类型化记录，而非不透明的 JSON 值。
 */
export interface MemoryBackend {
  /** 稳定的 id；外部以 `pluginId:backendId` 形式出现。 */
  id: string;
  get(namespace: string, id: string): Promise<MemoryRecord | undefined>;
  set(namespace: string, record: Omit<MemoryRecord, 'createdAt' | 'updatedAt'>): Promise<MemoryRecord>;
  search(params: MemorySearchParams): Promise<MemorySearchHit[]>;
  delete(namespace: string, id: string): Promise<void>;
}

/** 预算；保护 agent loop 免受慢 backend 影响。 */
export interface MemoryBackendBudget {
  /** 每次调用的最大 ms 数。默认 3000。 */
  callTimeoutMs: number;
  /** search 可返回的最大记录数。默认 10，硬上限 50。 */
  searchHardCap: number;
}

export declare const DEFAULT_MEMORY_BACKEND_BUDGET: MemoryBackendBudget;
