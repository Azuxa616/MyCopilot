/**
 * 上下文预算降级（L2 必然触发并消耗一轮，评审 NEW-1）。
 *
 * 体积设计（token 估算 = ceil(chars/4)+4/消息，128k 默认总预算）：
 * - 工具参数 110,000 字符 → assistant toolCalls arguments ≈ 27,503 token（计入 toolOutputs 桶）；
 * - base64 输出 146,668 字符 → tool 消息 ≈ 36,681 token；
 * - toolOutputs 用量 ≈ 64,184 > 预算 35,840（28%）→ 降级链启动。
 *
 * 第二次迭代的装配过程（assembler.ts:341-409）：
 * 1. L1 滑窗按 estimateMessagesTokens 口径（不含 toolCalls arguments）≈ 36.7k
 *    ≤ history 桶 43,520 → 快速路径全量保留；
 * 2. L2（无旁路，FakeAdapter 恒在）真调 summarizeHistory → 消耗第 2 轮脚本；
 * 3. L3 把 tool 消息 content 截断到 2000 字符 + '…[truncated]' 后缀 → degraded=true。
 *
 * 评分注记：degraded 断言必须辅以「发给 adapter 的最终消息里该 tool 消息
 * content 以 TOOL_OUTPUT_TRUNCATED_SUFFIX（assembler.ts:183）结尾且长度
 * ≤ 2000+后缀」的校验；禁止以 trace 的 resultPreview 断言（截断发生在
 * 装配期，原始结果预览不含后缀，且与 preview 截断标记同形无鉴别力）。
 * 注：截断只作用于装配副本，messages 表原始 tool 消息保留全量。
 *
 * runner 级惰性摘要（默认阈值 30k）在第 2 次迭代被 MIN_MESSAGES_TO_SUMMARIZE=5
 * 挡住（history 仅 2 条合成消息），不会额外消耗脚本轮。
 */
import type { EvalScenario } from '@my-copilot/shared';
import { finalRound, toolRound } from './events.js';

const HUGE_TEXT = 'x'.repeat(110_000);

export const contextDegradation: EvalScenario = {
  id: 'context-degradation',
  name: '上下文预算降级',
  description:
    '三轮脚本：[base64 编码超长文本(110k 字符参数), L2 摘要 prose 轮(被降级链消耗), 文本收尾]。断言 degraded=true + run 完成；评分须校验装配后 tool 消息以 …[truncated] 结尾且 ≤2000+后缀，禁用 resultPreview 断言。',
  category: 'context',
  mode: 'deterministic',
  tools: ['base64_encode'],
  userMessage: '请用 base64_encode 工具编码这段超长文本，并告诉我结果是如何处理的。',
  replayable: true,
  script: [
    toolRound({
      content: '开始编码超长文本。',
      calls: [{ id: 'call-b64-1', name: 'base64_encode', args: { text: HUGE_TEXT } }],
    }),
    finalRound('（历史压缩摘要）用户请求编码一段超长文本，工具已返回大体积 base64 结果。'),
    finalRound('编码完成，超长工具输出已按上下文预算截断展示。'),
  ],
  assertions: [
    { kind: 'status', expected: 'completed' },
    { kind: 'degraded', expected: true },
    { kind: 'tool_sequence', expected: ['base64_encode'] },
  ],
};
