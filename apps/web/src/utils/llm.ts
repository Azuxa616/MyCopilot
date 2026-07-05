import { createParser } from 'eventsource-parser';

import type { Message } from '../types/chat';
import type { StreamAIResponseData } from '../api/types';
import { StreamError, AbortError } from '../api/errors';

interface OpenAIChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIClientConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export interface StreamChatCompletionOptions {
  config: OpenAIClientConfig;
  messages: Message[];
  signal?: AbortSignal;
}

const CHAT_COMPLETIONS_PATH = '/v1/chat/completions';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const BASE_SYSTEM_PROMPT = [
  '你现在是 “MyCopilot”，一名务实可靠的中文 AI 搭档，专注于代码解读、调试、架构设计与产品文案。',
  '回答要求：',
  '1. 默认使用中文回复，除非用户明确指定其他语言；描述技术细节时可穿插少量英文术语。',
  '2. 引用代码、接口或文件路径时请使用 Markdown 代码块或反引号标注，并以简明解释说明设计理由。',
  '3. 遇到需求不完整时先提出澄清，再给出可能的假设；若有安全/合规风险需直接点出。',
  '4. 如果无法完成，请解释原因并给出可行的下一步建议，而不是编造答案。',
  '5. 保持协作语气，鼓励迭代，必要时提供测试建议或潜在风险提示。',
].join('\n');

/**
 * 将项目内的 Message 列表转换为带系统提示词的 OpenAI 消息格式
 */
export const convertMessagesToOpenAIFormat = (messages: Message[]): OpenAIChatMessage[] => {
  const history = messages
    .filter(message => Boolean(message.content?.trim()))
    .map<OpenAIChatMessage>(message => ({
      role: normalizeRole(message.role),
      content: message.content,
    }));

  return [
    {
      role: 'system',
      content: BASE_SYSTEM_PROMPT,
    },
    ...history,
  ];
};

/**
 * 调用 OpenAI Chat Completions（流式）
 */
export const streamChatCompletion = async (
  options: StreamChatCompletionOptions,
): Promise<StreamAIResponseData> => {
  const { config, messages, signal } = options;

  validateConfig(config);

  if (signal?.aborted) {
    throw new AbortError();
  }

  const payloadMessages = convertMessagesToOpenAIFormat(messages);
  if (payloadMessages.length === 0) {
    throw new StreamError('没有可用于生成的消息内容');
  }

  const requestController = new AbortController();
  const abortHandler = () => requestController.abort();

  if (signal) {
    signal.addEventListener('abort', abortHandler);
  }

  try {
    const response = await fetch(buildEndpoint(config.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: payloadMessages,
        stream: true,
      }),
      signal: requestController.signal,
    });

    if (!response.ok) {
      throw await createStreamErrorFromResponse(response);
    }

    if (!response.body) {
      throw new StreamError('OpenAI 响应体为空');
    }

    const requestId = response.headers.get('x-request-id') || `openai-${Date.now()}`;
    const stream = convertOpenAIStreamToSSE(response.body, requestId, requestController);

    return {
      stream,
      close: () => requestController.abort(),
      requestId,
      contentType: 'text/event-stream',
      tokenCount: 0,
    };
  } catch (error) {
    if (requestController.signal.aborted) {
      throw new AbortError();
    }
    if (error instanceof StreamError || error instanceof AbortError) {
      throw error;
    }
    throw new StreamError(
      `OpenAI 请求失败: ${error instanceof Error ? error.message : String(error)}`,
      undefined,
      error,
    );
  } finally {
    if (signal) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
};
//将项目内的 Message 角色转换为 OpenAI 消息格式
function normalizeRole(role: Message['role']): OpenAIChatMessage['role'] {
  if (role === 'assistant' || role === 'system' || role === 'user') {
    return role;
  }
  return 'user';
}

//验证配置是否完整
function validateConfig(config: OpenAIClientConfig) {
  if (!config.apiKey || !config.baseUrl || !config.model) {
    throw new StreamError('OpenAI 配置不完整，请检查 API Key、Base URL 和模型');
  }
}

//构建 OpenAI 请求 URL
function buildEndpoint(baseUrl: string): string {
  const normalized = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
  return `${normalized}${CHAT_COMPLETIONS_PATH}`;
}

//创建流式错误
async function createStreamErrorFromResponse(response: Response): Promise<StreamError> {
  let message = `HTTP ${response.status}: ${response.statusText}`;

  try {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const body = await response.json();
      const errorMessage = body?.error?.message ?? body?.message;
      if (errorMessage) {
        message = errorMessage;
      }
    } else {
      const text = await response.text();
      if (text) {
        message = text;
      }
    }
  } catch {
    // ignore parsing errors
  }

  return new StreamError(`OpenAI 请求失败: ${message}`);
}

//将 OpenAI 流式响应转换为 SSE 格式
function convertOpenAIStreamToSSE(
  sourceStream: ReadableStream<Uint8Array>,
  requestId: string,
  controller: AbortController,
): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(targetController) {
      const reader = sourceStream.getReader();
      const parser = createParser(event => {
        if (event.type !== 'event') {
          return;
        }

        const data = event.data ?? '';
        if (data === '[DONE]') {
          safeEnqueue(targetController, formatSseEvent('done', '[DONE]'));
          targetController.close();
          return;
        }

        if (!data) {
          return;
        }

        try {
          const payload = JSON.parse(data) as OpenAIStreamChunk;
          const delta = payload.choices?.[0]?.delta;
          const content = delta?.content;
          if (content) {
            safeEnqueue(targetController, formatSseData(content));
          }
        } catch (error) {
          targetController.error(
            new StreamError(
              '解析 OpenAI 流失败',
              requestId,
              error,
            ),
          );
          controller.abort();
        }
      });

      const readStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) {
              targetController.close();
              break;
            }
            if (value) {
              parser.feed(decoder.decode(value, { stream: true }));
            }
          }
        } catch (error) {
          if (!controller.signal.aborted) {
            targetController.error(
              new StreamError(
                '读取 OpenAI 流失败',
                requestId,
                error,
              ),
            );
          }
        } finally {
          reader.releaseLock();
        }
      };

      readStream();
    },
    cancel() {
      controller.abort();
    },
  });
}

//OpenAI 流式响应格式
interface OpenAIStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      role?: string;
    };
  }>;
}

//安全入队
function safeEnqueue(target: ReadableStreamDefaultController<Uint8Array>, chunk: Uint8Array) {
  try {
    target.enqueue(chunk);
  } catch {
    // ignore if stream already closed
  }
}

//格式化 SSE 数据
function formatSseData(content: string): Uint8Array {
  const sanitized = content.replace(/\r/g, '');
  const lines = sanitized.split('\n');
  const payload = lines.map(line => `data: ${line}`).join('\n');
  return encoder.encode(`${payload}\n\n`);
}

//格式化 SSE 事件
function formatSseEvent(eventName: string, data: string): Uint8Array {
  return encoder.encode(`event: ${eventName}\ndata: ${data}\n\n`);
}

