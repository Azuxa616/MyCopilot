import type { Model } from './provider.js';

/** 单项能力的取值。 */
export type CapabilityState = 'yes' | 'no' | 'unknown';

/** 能力值的来源。 */
export type CapabilitySource = 'manual' | 'catalog' | 'provider' | 'probe';

export interface ModelCapabilities {
  /** 图片输入能力。缺省视为 unknown。 */
  vision?: CapabilityState;
  /** 各能力的来源标注（键同名）。 */
  sources?: Partial<Record<'vision', CapabilitySource>>;
  /** 探测时间戳（source = probe 时有意义）。 */
  probedAt?: number;
}

/**
 * 内置"已知模型名 → vision 能力"目录规则（设计：只收录确认过的条目，宁缺毋滥，
 * 错判 no 比漏判 yes 更伤——直接禁用了入口）。随宿主版本发布，不做热更新。
 *
 * 语义：对 trim + 小写归一后的模型名做**前缀匹配**，按数组顺序首个命中生效。
 */
export const VISION_CATALOG_RULES: ReadonlyArray<readonly [RegExp, CapabilityState]> = [
  [/^gpt-4o/, 'yes'],
  [/^deepseek-flash/, 'yes'],
  [/^deepseek-v4-pro/, 'no'],
  [/^(llava|qwen[\w.-]*-vl|glm-4v)/, 'yes'],
];

/** 目录匹配：命中返回能力值，未命中返回 undefined（= unknown，交给上层解析链）。 */
export function matchVisionCatalog(modelName: string): CapabilityState | undefined {
  const name = modelName.trim().toLowerCase();
  if (!name) return undefined;
  for (const [pattern, state] of VISION_CATALOG_RULES) {
    if (pattern.test(name)) return state;
  }
  return undefined;
}

/** POST /api/models/:id/probe-vision 的响应载荷。 */
export interface ProbeVisionResponse {
  /** 探测后的最新模型记录（manual 锁命中时为原记录）。 */
  model: Model;
  probe: {
    /** 探测方式：chat = 真实小图请求；provider-show = ollama /api/show；skipped = manual 锁命中。 */
    method: 'chat' | 'provider-show' | 'skipped';
    vision: CapabilityState;
    source?: CapabilitySource;
    /** true = 手动锁命中，本次探测未写库。 */
    locked?: boolean;
    /** 失败判定（vision = no）时的上游错误摘要。 */
    message?: string;
  };
}
