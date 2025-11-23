/**
 * Mock API 实现模块
 * 
 * 包含所有 Mock 模式下的 API 实现，从本地 JSON 文件读取数据
 */

import type { ChatSummary, Message } from '../types/chat';
import type { User } from '../types/user';
import type { ApiResponse } from '../types/api';
import { ApiStatusCode } from '../types/api';
import type { StreamAIResponseParams, StreamAIResponseData } from './types';
import { StreamError, AbortError } from './errors';
import chatData from '../../mock/chat.json';
import userData from '../../mock/user.json';

/**
 * 模拟网络延迟
 * 
 * @param ms 延迟时间（毫秒）
 * @returns Promise，在指定时间后 resolve
 */
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Mock 模式下使用的固定 Markdown 测试文案
 * 覆盖 MarkdownRenderer 支持的所有语法元素，用于测试渲染效果
 */
const MOCK_MARKDOWN_RESPONSE = `
# 一级标题：Markdown 全量测试

欢迎来到 **AI Markdown** 测试区，这里将覆盖 *所有* MarkdownRenderer 支持的元素。

---

# 一级标题
## 二级标题
### 三级标题
#### 四级标题
##### 五级标题
###### 六级标题

---

## 列表与引用
- 无序列表项一，包含 ~~删除线~~ 与 \`inline code\`。
- 无序列表项二，包含 [跳转链接](https://zh-hans.react.dev/)。

1. 有序列表第一项
2. 有序列表第二项（含 **粗体** 与 *斜体*）。

> 引用段落：结合 *斜体*、**粗体** 与 ~~删除线~~，还可以继续换行。

## 代码块
\`\`\`ts
function greet(name: string) {
  console.log(\`Hello, \${name}!\`);
}
\`\`\`

\`\`\`java
public class HelloWorld {
  public static void main(String[] args) {
    System.out.println("Hello, World!");
  }
}
\`\`\`

***
`;

/**
 * Mock SSE 流选项
 */
interface MockSseOptions {
  /** 可选的取消信号 */
  signal?: AbortSignal;
  /** 每个数据块的推送间隔（毫秒） */
  chunkDelay?: number;
}

/**
 * 默认的字符推送间隔（毫秒）
 * 用于模拟真实的流式响应速度
 * 逐字输出时，建议使用较小的延迟值（如 30-50ms）以获得流畅的打字效果
 */
const DEFAULT_CHUNK_DELAY = 50;

/**
 * 将内容按字符分割为字符数组
 * 用于逐字流式输出
 * 
 * @param content 要分割的内容
 * @returns 字符数组（包括换行符等特殊字符）
 */
const chunkContentByChar = (content: string): string[] => {
  // 将字符串转换为字符数组，包括换行符等特殊字符
  return Array.from(content);
};

/**
 * 将单个字符格式化为 SSE 标准格式
 * SSE 格式要求每行以 "data: " 开头，并以两个换行符结尾
 * 
 * @param char 单个字符
 * @returns 格式化后的 SSE 数据
 */
const formatSsePayload = (char: string): string => {
  // 对于换行符，需要特殊处理
  if (char === '\n') {
    return `data: \n\n`;
  }
  // 普通字符直接推送
  return `data: ${char}\n\n`;
};

/**
 * 创建 Mock SSE 流
 * 
 * 将内容按字符分割后，以 SSE 格式逐字推送，模拟真实的流式响应
 * 支持通过 AbortSignal 取消，支持自定义推送间隔
 * 
 * @param content 要流式推送的内容
 * @param options 流选项（取消信号、推送间隔等）
 * @returns 包含流对象、关闭函数和数据块数量的对象
 */
const createMockSseStream = (content: string, options: MockSseOptions = {}) => {
  const { signal, chunkDelay = DEFAULT_CHUNK_DELAY } = options;
  // 按字符分割内容，实现逐字输出
  const chunks = chunkContentByChar(content);
  const encoder = new TextEncoder();

  // 流控制器引用，用于推送数据和关闭流
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;
  // 定时器句柄，用于控制推送间隔
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  // 流是否已关闭
  let closed = false;
  // AbortSignal 的事件处理器
  let abortHandler: (() => void) | null = null;

  /**
   * 停止定时器
   */
  const stopTimer = () => {
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  };

  /**
   * 关闭流并清理资源
   */
  const closeStream = () => {
    if (closed) {
      return;
    }
    closed = true;
    stopTimer();
    // 移除 AbortSignal 监听器
    if (signal && abortHandler) {
      signal.removeEventListener('abort', abortHandler);
    }
    abortHandler = null;
    // 关闭流控制器
    if (controllerRef) {
      controllerRef.close();
      controllerRef = null;
    }
  };

  // 创建 ReadableStream，实现 SSE 流式推送
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
      if (closed) {
        controller.close();
        return;
      }

      let index = 0;
      // 推送下一个字符逐字推送，实现打字机效果
      const pushChunk = () => {
        if (closed) {
          return;
        }

        // 所有字符推送完毕，发送结束事件
        if (index >= chunks.length) {
          controller.enqueue(encoder.encode('event: done\ndata: [DONE]\n\n'));
          closeStream();
          return;
        }

        // 推送当前字符（格式化为 SSE 格式）
        controller.enqueue(encoder.encode(formatSsePayload(chunks[index] ?? '')));
        index += 1;
        // 设置定时器，延迟推送下一个字符
        timeoutHandle = setTimeout(pushChunk, chunkDelay);
      };

      // 开始推送第一个字符
      pushChunk();

      // 如果提供了 AbortSignal，监听取消事件
      if (signal) {
        abortHandler = () => {
          if (closed) {
            return;
          }
          // 发送错误事件
          if (controllerRef) {
            try {
              controllerRef.enqueue(encoder.encode('event: error\ndata: Stream aborted\n\n'));
            } catch (error) {
              // 流可能已经关闭，忽略错误
            }
          }
          closeStream();
        };
        signal.addEventListener('abort', abortHandler);
      }
    },
    /**
     * 流被取消时的回调
     */
    cancel() {
      closeStream();
    },
  });

  /**
   * 手动关闭流的函数
   */
  const manualClose = () => {
    if (closed) {
      return;
    }
    closeStream();
  };

  return {
    /** SSE 流对象 */
    stream,
    /** 手动关闭流的函数 */
    close: manualClose,
    /** 字符总数（用于统计） */
    chunkCount: chunks.length,
  };
};

// ===== 各业务能力的 Mock 实现 =====

/**
 * Mock: 获取聊天列表摘要
 * 
 * 从本地 JSON 文件读取聊天数据，提取摘要信息（不含完整消息）
 * 
 * @returns 聊天摘要列表
 */
export const fetchChatSummariesMock = async (): Promise<ApiResponse<ChatSummary[]>> => {
  await delay(300);

  const summaries = (chatData.chats as any[]).map(chat => ({
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    messageCount: chat.messages.length,
  }));

  return {
    code: ApiStatusCode.SUCCESS,
    msg: '获取聊天列表成功',
    data: summaries,
  };
};

/**
 * Mock: 获取指定聊天的完整消息列表
 * 
 * 从本地 JSON 文件中查找指定聊天 ID 的消息列表
 * 
 * @param chatId 聊天 ID
 * @returns 消息列表，如果聊天不存在则返回空数组
 */
export const fetchChatMessagesMock = async (chatId: string): Promise<ApiResponse<Message[]>> => {
  await delay(500);

  const chats = chatData.chats as any[];
  const chat = chats.find(c => c.id === chatId);
  if (!chat) {
    return {
      code: ApiStatusCode.NOT_FOUND,
      msg: `ID 为 ${chatId} 的对话不存在`,
      data: [],
    };
  }

  return {
    code: ApiStatusCode.SUCCESS,
    msg: '获取消息成功',
    data: chat.messages as Message[],
  };
};

/**
 * Mock: 获取用户信息
 * 
 * 从本地 JSON 文件读取用户信息
 * 
 * @returns 用户信息
 */
export const fetchUserMock = async (): Promise<ApiResponse<User>> => {
  await delay(300);

  return {
    code: ApiStatusCode.SUCCESS,
    msg: '获取用户信息成功',
    data: (userData as any).user as User,
  };
};

/**
 * Mock: 发送消息（非流式）
 * 
 * 模拟发送消息并返回一个简单的回复
 * 注意：实际业务中应使用 streamAIResponse 进行流式回复
 * 
 * @param chatId 聊天 ID
 * @param content 消息内容
 * @returns 模拟的助手回复消息
 * @throws {BusinessError} 当 chatId 为 chat-005 或内容包含 "模拟失败" 时抛出错误
 */
export const sendMessageMock = async (
  chatId: string,
  content: string,
): Promise<ApiResponse<Message>> => {
  await delay(1000);

  // 模拟失败场景：chat-005 或消息内容包含 "模拟失败"
  if (chatId === 'chat-005' || content.includes('模拟失败')) {
    return {
      code: ApiStatusCode.SERVER_ERROR,
      msg: '网络连接失败，请检查网络设置后重试',
      data: {
        id: `msg-${Date.now()}`,
        role: 'assistant',
        content: '',
        timestamp: Date.now(),
        status: 'failed',
      } as any,
    };
  }

  return {
    code: ApiStatusCode.SUCCESS,
    msg: '消息发送成功',
    data: {
      id: `msg-${Date.now()}`,
      role: 'assistant',
      content: `这是对 "${content}" 的模拟回复`,
      timestamp: Date.now(),
      status: 'sent',
    } as any,
  };
};

/**
 * Mock: AI 流式回复
 * 
 * 创建基于固定测试文案的 SSE 流，模拟 AI 流式回复
 * 
 * @param params 流式回复参数
 * @returns 包含 SSE 流和相关元数据的响应
 */
export const streamAIResponseMock = async (
  params: StreamAIResponseParams,
): Promise<ApiResponse<StreamAIResponseData>> => {
  try {
    // 检查是否已被取消
    if (params.signal?.aborted) {
      throw new AbortError();
    }

    await delay(300);

    // 再次检查是否在延迟期间被取消
    if (params.signal?.aborted) {
      throw new AbortError();
    }

    const { signal, chunkDelay, prompt, chatId } = params;

    // 模拟失败场景：chat-005 或提示词包含 "模拟失败"
    if (chatId === 'chat-005' || prompt.includes('模拟失败')) {
      throw new StreamError(
        '网络连接失败，请检查网络设置后重试',
        `stream-${Date.now()}`,
      );
    }

    const requestId = `stream-${Date.now()}`;
    const { stream, close, chunkCount } = createMockSseStream(MOCK_MARKDOWN_RESPONSE, {
      signal,
      chunkDelay,
    });

    return {
      code: ApiStatusCode.SUCCESS,
      msg: 'AI 流式回复已开始',
      data: {
        stream,
        close,
        requestId,
        contentType: 'text/event-stream',
        tokenCount: chunkCount,
      },
    };
  } catch (error) {
    // 如果已经是 StreamError 或 AbortError，直接抛出
    if (error instanceof StreamError || error instanceof AbortError) {
      throw error;
    }
    // 其他错误包装为 StreamError
    throw new StreamError(
      `创建流式响应失败: ${error instanceof Error ? error.message : String(error)}`,
      undefined,
      error,
    );
  }
};

