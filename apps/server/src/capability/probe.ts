import type { Provider } from '@my-copilot/shared';
import { getAdapter, ProviderError } from '../llm/index.js';
import type { ChatMessage } from '../llm/index.js';

/**
 * 1×1 透明 PNG（探测只需 provider 接受 image block，像素内容无关紧要；
 * 单测校验 PNG 魔数，若替换请用任意工具重生成 1×1 PNG）。
 */
const TINY_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

/** 探测请求内嵌的小图 data URL。 */
export const PROBE_IMAGE_DATA_URL = `data:image/png;base64,${TINY_PNG_BASE64}`;

const PROBE_PROMPT = 'Reply with the single word: ok';
const PROBE_MAX_TOKENS = 64;
const PROBE_TIMEOUT_MS = 20_000;

/**
 * 用真实小图 chat 请求实测 vision 能力（设计 L4"测试图片输入"，openai 类型专用）。
 *
 * 经既有 provider adapter 发送（getAdapter → chatCompletionStream），图片走
 * `ChatMessage.images`（附件资产层计划 A 落地的正式多模态通道，adapter 序列化
 * 为 OpenAI content blocks；计划原文的受控 cast 已随 A 的落地移除）。
 *
 * @returns 'yes' —— 首个流事件即证明 provider 接受了图片输入
 * @throws ProviderError —— 能力性 400（由调用方分类为 no）或网络/上游错误
 */
export async function probeVisionByChat(provider: Provider, modelName: string): Promise<'yes'> {
  if (provider.type !== 'openai') {
    throw new Error('probeVisionByChat only supports openai-type providers (ollama 走 /api/show)');
  }

  const messages: ChatMessage[] = [
    {
      role: 'user',
      content: PROBE_PROMPT,
      images: [{ url: PROBE_IMAGE_DATA_URL }],
    },
  ];

  const adapter = getAdapter(provider.type);
  for await (const _event of adapter.chatCompletionStream(
    messages,
    { baseUrl: provider.baseUrl, apiKey: provider.apiKey, model: modelName },
    { maxTokens: PROBE_MAX_TOKENS, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) },
  )) {
    return 'yes'; // 首个事件即判定成功，不再消费后续流
  }
  throw new ProviderError('探测请求未返回任何事件（超时或被中断）', 502);
}
