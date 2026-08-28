/**
 * 内置评估场景集（todo 7）。
 *
 * 确定性场景（≥9）：FakeAdapter 轮次脚本 + 真实 runtime/工具执行，零网络。
 * live 场景（≥10）：真实 LLM 围绕 demo 白名单 7 工具的任务，trials=3 做
 * pass^k 一致性统计，replayable=false。
 *
 * 本目录仅依赖 @my-copilot/shared 类型与纯数据构造（todo 8 的 eval-env
 * 静态表因此可安全先于本模块求值）；执行入口是 todo 8 的 eval runner/CLI。
 */
import type { EvalScenario } from '@my-copilot/shared';

import { approvalApproveFlow } from './approval-approve-flow.js';
import { approvalRejectFlow } from './approval-reject-flow.js';
import { contextDegradation } from './context-degradation.js';
import { liveBase64Roundtrip } from './live-base64-roundtrip.js';
import { liveCalculatorArithmetic } from './live-calculator-arithmetic.js';
import { liveCalculatorRecovery } from './live-calculator-recovery.js';
import { liveCurrentDatetime } from './live-current-datetime.js';
import { liveHashText } from './live-hash-text.js';
import { liveJsonFormatSort } from './live-json-format-sort.js';
import { liveJsonValidateError } from './live-json-validate-error.js';
import { liveMultiToolComposite } from './live-multi-tool-composite.js';
import { liveUuidAndBase64 } from './live-uuid-and-base64.js';
import { liveUuidV4Check } from './live-uuid-v4-check.js';
import { maxStepsTermination } from './max-steps-termination.js';
import { multiStepToolChain } from './multi-step-tool-chain.js';
import { repeatCallGuard } from './repeat-call-guard.js';
import { summarizationTrigger } from './summarization-trigger.js';
import { toolErrorRecovery } from './tool-error-recovery.js';
import { userAbortPartial } from './user-abort-partial.js';

/** 全部内置场景（确定性 + live），eval CLI 与回放端点的唯一数据源。 */
export const BUILTIN_SCENARIOS: EvalScenario[] = [
  // --- 确定性（FakeAdapter 脚本 + 真实执行） ---
  multiStepToolChain,
  repeatCallGuard,
  toolErrorRecovery,
  contextDegradation,
  summarizationTrigger,
  approvalApproveFlow,
  approvalRejectFlow,
  maxStepsTermination,
  userAbortPartial,
  // --- live（真实 LLM，trials=3） ---
  liveCalculatorArithmetic,
  liveCurrentDatetime,
  liveUuidAndBase64,
  liveJsonFormatSort,
  liveHashText,
  liveBase64Roundtrip,
  liveMultiToolComposite,
  liveCalculatorRecovery,
  liveUuidV4Check,
  liveJsonValidateError,
];
