/**
 * 惰性摘要触发（评审 NEW-4 ≥5 条消息前提 + NEW-8 replayable: true）。
 *
 * requiredEnv CONTEXT_SUMMARIZE_THRESHOLD=2000（runner.ts:192-194 每次调用
 * 读取，eval CLI 子进程注入生效）。
 *
 * 体积设计（token = ceil(chars/4)+4/消息）：
 * - 每轮 assistant content 恰好 1700 字符 → 4+425 = 429 token；
 * - calculator 结果消息 ≈ 21-22 token；
 * - 4 轮后 history ≈ 1801（+用户消息 ≈17）≤ 2000 → 不触发；
 * - 5 轮后 ≈ 2251（+17）> 2000 → 第 6 次迭代顶部 maybeSummarizeHistory
 *   真调 adapter，消耗第 6 轮脚本并写 message_summaries。
 *
 * 「≥5 条非空 user/assistant 消息」前提（runner.ts:145/211-217）：五轮
 * assistant content 各 1700 字符非空，加用户消息共 6 条，两种 history
 * 构造口径（含/不含用户消息）均满足。各轮表达式互不相同，避免被重复
 * 调用熔断干扰真实执行。脚本共 7 轮 = 5 工具轮 + 1 摘要消耗轮 + 1 收尾轮。
 */
import type { EvalScenario } from '@my-copilot/shared';
import { fillerText, finalRound, toolRound } from './events.js';

const ROUND_FILLER = fillerText(
  1700,
  '用户要求依次计算多个算术表达式，助手每轮调用 calculator 记录结果后继续下一轮计算。',
);

const EXPRESSIONS = ['2+3', '10*2', '7-3', '100/4', '6**2'] as const;

export const summarizationTrigger: EvalScenario = {
  id: 'summarization-trigger',
  name: '惰性摘要触发',
  description:
    'history 累计超过 CONTEXT_SUMMARIZE_THRESHOLD=2000 且满足 ≥5 条非空 user/assistant 消息后，第 6 次迭代触发惰性摘要并消耗一轮脚本；断言 summary_created + message_summaries 新增。',
  category: 'context',
  mode: 'deterministic',
  tools: ['calculator'],
  userMessage: '请依次用 calculator 计算：2+3、10*2、7-3、100/4、6**2。',
  replayable: true,
  requiredEnv: { CONTEXT_SUMMARIZE_THRESHOLD: '2000' },
  script: [
    ...EXPRESSIONS.map((expression, i) =>
      toolRound({
        content: ROUND_FILLER,
        calls: [
          { id: `call-sum-${i + 1}`, name: 'calculator', args: { expression } },
        ],
      }),
    ),
    finalRound('（会话摘要）用户连续提出五个算式，助手逐一用计算器求解并汇报结果。'),
    finalRound('五次计算全部完成，结果依次为 5、20、4、25、36。'),
  ],
  assertions: [
    { kind: 'status', expected: 'completed' },
    { kind: 'summary_created', expected: true },
  ],
};
