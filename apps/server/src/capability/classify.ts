/** 学习闭环"能力性错误"分类器的输入（对齐 ProviderError 的可序列化字段）。 */
export interface ProviderErrorInput {
  statusCode: number;
  message: string;
  details?: unknown;
}

/**
 * 稳定错误码：provider 400 且判定为图片能力性错误时附加到 ProviderError
 * （对齐 PluginLifecycleError.errorCode 先例，供学习闭环等消费方复用）。
 */
export const CAPABILITY_VISION_UNSUPPORTED = 'capability_vision_unsupported';

/**
 * 图片能力性错误关键词（设计："unsupported modality / invalid content type 类关键词或结构"）。
 * 只做保守匹配——错判 no 会直接禁用图片入口，宁漏勿错。
 * 名词侧覆盖复数（images）与 modality/modalities；匹配前把 haystack 的
 * 下划线/连字符归一为空格（JSON details 常见 snake_case，如 unsupported_modality）。
 */
const MODALITY_NOUN = '(?:images?|vision|multimodal(?:ity)?|modalit(?:y|ies))';
const NOT_SUPPORTED =
  "(?:not supported|unsupported|does not support|doesn't support|don't support)";

const VISION_ERROR_PATTERNS: readonly RegExp[] = [
  new RegExp(`\\b${NOT_SUPPORTED}\\b[^.]{0,80}\\b${MODALITY_NOUN}\\b`, 'i'),
  new RegExp(`\\b${MODALITY_NOUN}\\b[^.]{0,80}\\b${NOT_SUPPORTED}\\b`, 'i'),
  /invalid content type/i,
  /unsupported (?:input )?modalit/i,
  /\bimage_url\b[^.]{0,80}\b(?:invalid|not (?:supported|allowed))\b/i,
];

/** 匹配前归一：下划线/连字符 → 空格（snake_case 错误码可读化）。 */
function normalizeForMatch(text: string): string {
  return text.replace(/[_-]+/g, ' ');
}

/**
 * 判定一个 provider 错误是否为"模型不支持图片输入"的能力性错误。
 *
 * 设计决策：仅 HTTP 400 反写 no——401/403（鉴权）、429（限流）、5xx（网络/上游）
 * 与图片能力无关，反写会把断网误记成"不支持"。
 */
export function isVisionCapabilityError(input: ProviderErrorInput): boolean {
  if (input.statusCode !== 400) return false;
  const haystacks = [input.message];
  if (input.details !== undefined) {
    try {
      haystacks.push(JSON.stringify(input.details));
    } catch {
      // details 不可序列化时仅按 message 判定
    }
  }
  return haystacks
    .map(normalizeForMatch)
    .some((h) => VISION_ERROR_PATTERNS.some((p) => p.test(h)));
}
