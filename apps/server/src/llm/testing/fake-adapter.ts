/**
 * 共享 FakeProviderAdapter —— 脚本化 StreamEvent 回放（测试 / eval 复用）。
 *
 * 仅被测试与评估链路 import，绝不注册进生产启动路径。
 * 用法：createFakeAdapter(script) 传入每轮 chatCompletionStream 要回放的
 * 事件数组；runner 每调一次弹下一轮，轮次耗尽仍被调用则抛「回放脚本太短」。
 */
import type { StreamEvent } from '@my-copilot/shared';
import type { AdapterConfig, ProviderAdapter } from '../base.js';

/** 测试/评估共用的适配器配置（fake 不消费它，仅满足接口透传）。 */
export const TEST_ADAPTER_CONFIG: AdapterConfig = {
  baseUrl: 'http://localhost',
  apiKey: 'test-key',
  model: 'test-model',
};

/**
 * 事件序列 → 异步生成器（原各测试文件内联的 generatorFrom 逻辑）。
 *
 * 可选 signal：每次产出前检查，已中断则抛错——对齐真实 adapter 的
 * fetch abort → 流抛 AbortError 行为，使 abort 场景可确定性回放。
 */
export function recordFromEvents(
  events: StreamEvent[],
  signal?: AbortSignal,
): AsyncGenerator<StreamEvent, void, unknown> {
  return (async function* () {
    for (const event of events) {
      if (signal?.aborted) {
        throw new Error('FakeProviderAdapter stream aborted');
      }
      yield event;
    }
  })();
}

/**
 * 构造脚本化 ProviderAdapter：每次 chatCompletionStream 依序弹出
 * script 的下一轮事件数组转为异步流；轮次耗尽被调用则抛
 * 「回放脚本太短」（暴露测试/场景脚本欠指定，而非静默挂起）。
 */
export function createFakeAdapter(script: StreamEvent[][]): ProviderAdapter {
  let round = 0;
  return {
    type: 'openai',
    chatCompletionStream: (_messages, _config, options) => {
      const events = script[round];
      round += 1;
      if (!events) {
        throw new Error(
          `回放脚本太短：第 ${round} 次 chatCompletionStream 调用无事件可回放` +
            `（script 仅 ${script.length} 轮）`,
        );
      }
      return recordFromEvents(events, options?.signal);
    },
  };
}
