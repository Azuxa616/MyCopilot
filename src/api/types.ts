/**
 * API 类型定义模块
 * 
 * 包含所有 API 相关的类型和接口定义
 */

/**
 * AI 流式回复请求参数
 */
export interface StreamAIResponseParams {
  /** 对话 ID */
  chatId: string;
  /** 用户输入的提示词 */
  prompt: string;
  /** 可选的取消信号，用于中断流式请求 */
  signal?: AbortSignal;
  /** 
   * 仅 mock 模式下使用，控制每个数据块的推送间隔（毫秒）
   * 真实模式下此参数无效
   */
  chunkDelay?: number;
}

/**
 * AI 流式回复响应数据
 */
export interface StreamAIResponseData {
  /** SSE 流对象，用于读取流式数据 */
  stream: ReadableStream<Uint8Array>;
  /** 手动关闭流的函数 */
  close: () => void;
  /** 请求唯一标识 */
  requestId: string;
  /** 内容类型，固定为 'text/event-stream' */
  contentType: 'text/event-stream';
  /** 预计的 token 数量（用于统计） */
  tokenCount: number;
}

