/**
 * eval 进程级环境注入（todo 8）。
 *
 * ⚠️ 必须是 cli.ts（以及任何 eval 测试文件）的第一个 import：ESM 按声明序
 * 求值模块，本模块体先于 builtins/index.ts 等模块求值期读取的 env 生效，
 * 解决 MYCOPILOT_E2E_TOOLS（builtins/index.ts:25-31 模块求值期读取）的
 * 注入时序问题。
 *
 * - 静态常量表写死各场景 requiredEnv 的聚合结果；**不得 import scenarios/**
 *   （ESM 提升会使 scenarios 依赖先于本模块体求值，若其传递依赖触及
 *   builtins 则 env 注入失效）；
 * - 与场景 requiredEnv 的键集一致性由 scenarios.test.ts 后续升级校验
 *   （白名单 { MYCOPILOT_E2E_TOOLS, CONTEXT_SUMMARIZE_THRESHOLD }）；
 * - 无条件覆盖：保证确定性回放不受宿主 shell 环境影响（双跑一致性前提）。
 */
export const EVAL_ENV: Readonly<Record<string, string>> = {
  // 审批流场景（approval-approve/reject-flow）的 e2e_danger_tool 注册开关。
  MYCOPILOT_E2E_TOOLS: '1',
  // summarization-trigger 的惰性摘要阈值（runner.ts 每次调用读取）。
  CONTEXT_SUMMARIZE_THRESHOLD: '2000',
};

for (const [key, value] of Object.entries(EVAL_ENV)) {
  process.env[key] = value;
}
