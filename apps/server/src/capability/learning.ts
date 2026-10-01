import type { CapabilityState } from '@my-copilot/shared';
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
 * 出站含 image part 时，用真实请求成败反写能力记录。
 *
 * - 成功（completed / length_limited / max_iterations——provider 已接受图片）
 *   且当前非 yes → 升 `yes`（source=probe）
 * - 失败且为 HTTP 400 + 能力性错误（ProviderError.errorCode）→ 降 `no`
 * - 网络/鉴权/限流/abort 一律不反写
 * - manual 锁与幂等由 repo 层 setModelVisionCapability 强制（调用方无需预判）
 *
 * 同步（lifecycle）与异步（runAgentLoopAsJob）两条链路共用本单点实现。
 */
export function applyVisionLearningLoop(params: {
  modelId: string;
  outboundHasImage: boolean;
  /** 同步路径可传当前能力值（已是 yes 则跳过升格调用，省一次幂等写判断）。 */
  modelVision?: CapabilityState;
  result: LearningLoopResult;
}): void {
  if (!params.outboundHasImage) return;
  const { result } = params;

  if (result.status === 'error') {
    const cause = result.cause;
    if (
      cause instanceof ProviderError &&
      cause.statusCode === 400 &&
      cause.errorCode === CAPABILITY_VISION_UNSUPPORTED
    ) {
      setModelVisionCapability(params.modelId, 'no', 'probe');
    }
    return;
  }

  if (result.status !== 'aborted' && params.modelVision !== 'yes') {
    setModelVisionCapability(params.modelId, 'yes', 'probe');
  }
}
