import { setModelVisionCapability } from '../repo/model.js';
import { CAPABILITY_VISION_UNSUPPORTED } from './classify.js';
// 直接取 base.js（而非 llm/index.js barrel）：消费方（学习闭环）与构造方
// （adapter）必须共享同一个类定义，instanceof 才成立；也便于测试隔离 mock。
import { ProviderError } from '../llm/base.js';

/** 学习闭环输入：AgentLoopResult 的可判定子集（cause 为原始错误对象）。 */
export interface LearningLoopResult {
  status: string;
  cause?: unknown;
}

/**
 * 学习闭环（设计 docs/2026-09-30-model-capability-design.md）：
 *
 * **仅降级，不升格**（2026-10-01 实证修正，会话 290a7ec1）：DeepSeek 对非
 * vision 模型不返回 400，而是 200 + SSE 流 + 模型侧 "Unsupported Image" 占位
 * 降级——请求成功不构成图片被感知的证据，成功升格 yes 会误判此类模型。
 * 升格只走两条可信路径：探测端点（答案验证，capability/probe.ts）与手动设置。
 *
 * - 失败且为 HTTP 400 + 能力性错误（ProviderError.errorCode）→ 降 `no`
 * - 成功 / 网络 / 鉴权 / 限流 / abort 一律不写
 * - manual 锁与幂等由 repo 层 setModelVisionCapability 强制
 *
 * 同步（lifecycle）与异步（runAgentLoopAsJob）两条链路共用本单点实现。
 */
export function applyVisionLearningLoop(params: {
  modelId: string;
  outboundHasImage: boolean;
  result: LearningLoopResult;
}): void {
  if (!params.outboundHasImage) return;
  const { result } = params;

  if (result.status !== 'error') return;

  const cause = result.cause;
  if (
    cause instanceof ProviderError &&
    cause.statusCode === 400 &&
    cause.errorCode === CAPABILITY_VISION_UNSUPPORTED
  ) {
    setModelVisionCapability(params.modelId, 'no', 'probe');
  }
}
