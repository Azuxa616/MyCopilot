import type {
  CapabilitySource,
  CapabilityState,
  Model,
  ModelCapabilities,
  Provider,
} from '@my-copilot/shared';
import { matchVisionCatalog } from '@my-copilot/shared';
import { setModelVisionCapability } from '../repo/model.js';
import { ProviderError } from '../llm/index.js';

/** 解析结果：vision = unknown 时无来源标注。 */
export interface VisionResolution {
  vision: CapabilityState;
  source?: CapabilitySource;
}

/** 注入的 provider 探测实现（纯函数单测零网络）。 */
export interface ResolveIo {
  fetchOllamaShow?: (provider: Provider, modelName: string) => Promise<string[] | undefined>;
}

/**
 * 四层解析（设计"解析算法"章节）：
 *   1. manual   —— capabilities.sources.vision = manual 时直接返回（最终仲裁）
 *   2. provider —— ollama POST /api/show 读 capabilities 数组；含 'vision' → yes；
 *                  明确不含 → 保持 catalog 判定（show 可能滞后于模型替换）
 *   3. catalog  —— 内置前缀规则表（@my-copilot/shared，随版本发布）
 *   4. 默认     —— unknown
 */
export async function resolveVisionCapability(
  model: Model,
  provider: Provider,
  io: ResolveIo = {},
): Promise<VisionResolution> {
  const caps: ModelCapabilities | undefined = model.capabilities;

  // 1. manual
  if (caps?.sources?.vision === 'manual' && caps.vision) {
    return { vision: caps.vision, source: 'manual' };
  }

  // 2. provider（仅 ollama 有原生能力信息；openai 兼容生态 /models 不携带）
  if (provider.type === 'ollama' && io.fetchOllamaShow) {
    try {
      const shown = await io.fetchOllamaShow(provider, model.name);
      if (shown?.includes('vision')) {
        return { vision: 'yes', source: 'provider' };
      }
    } catch {
      // provider 层失败不阻塞解析，落入 catalog
    }
  }

  // 3. catalog
  const catalogState = matchVisionCatalog(model.name);
  if (catalogState) {
    return { vision: catalogState, source: 'catalog' };
  }

  // 4. 默认 unknown
  return { vision: 'unknown' };
}

// ---------------------------------------------------------------------------
// provider 层实现：ollama /api/show（惰性探测 + 内存 TTL 缓存）
// ---------------------------------------------------------------------------

const SHOW_CACHE_TTL_MS = 5 * 60 * 1000;
const SHOW_TIMEOUT_MS = 5_000;

const showCache = new Map<string, { capabilities: string[]; fetchedAt: number }>();

/** 清空 /api/show 缓存（测试与手动刷新用）。 */
export function clearOllamaShowCache(): void {
  showCache.clear();
}

/** POST {baseUrl}/api/show {"model": name} → capabilities 数组（官方 docs/api.md）。 */
export async function fetchOllamaShowCapabilities(
  provider: Provider,
  modelName: string,
): Promise<string[] | undefined> {
  const key = `${provider.id}:${modelName}`;
  const cached = showCache.get(key);
  if (cached && Date.now() - cached.fetchedAt < SHOW_CACHE_TTL_MS) {
    return cached.capabilities;
  }

  const normalized = provider.baseUrl.endsWith('/')
    ? provider.baseUrl.slice(0, -1)
    : provider.baseUrl;
  const response = await fetch(`${normalized}/api/show`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelName }),
    signal: AbortSignal.timeout(SHOW_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new ProviderError(`Ollama /api/show failed: HTTP ${response.status}`, 502);
  }
  const body = (await response.json()) as { capabilities?: string[] };
  const capabilities = Array.isArray(body.capabilities) ? body.capabilities : [];
  showCache.set(key, { capabilities, fetchedAt: Date.now() });
  return capabilities;
}

/**
 * 解析 + 持久化：供探测端点 ollama 分支与附件资产层（A 计划）的出口门控复用。
 * 写入经 repo 层 manual 锁；解析为 unknown 时不写库。
 */
export async function resolveAndPersistVision(
  model: Model,
  provider: Provider,
): Promise<Model | undefined> {
  const resolution = await resolveVisionCapability(model, provider, {
    fetchOllamaShow: fetchOllamaShowCapabilities,
  });
  if (resolution.vision === 'unknown' || !resolution.source) {
    return model;
  }
  if (
    model.capabilities?.vision === resolution.vision &&
    model.capabilities?.sources?.vision === resolution.source
  ) {
    return model; // 幂等
  }
  return setModelVisionCapability(model.id, resolution.vision, resolution.source);
}
