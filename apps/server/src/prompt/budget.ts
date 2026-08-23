/**
 * 五桶预算模型 + 按桶 token 统计器（Context Management v2，T4）。
 *
 * 对应 RFC docs/rfc/context-management-v2.md §1：将模型上下文窗口切分为
 * system（系统提示 + skills）、tools（工具 schema）、history（历史消息）、
 * toolOutputs（工具结果）、working（当前轮附件 + 用户输入）五个功能桶，
 * 外加永不分配的 headroom 预留。
 *
 * token 估算全部复用 token-counter.ts 的 chars/4 近似，不引入精确分词器。
 */
import type {
  BudgetBreakdown,
  BudgetConfig,
  TokenUsage,
  Tool,
} from '@my-copilot/shared';
import { DEFAULT_BUDGET_CONFIG } from '@my-copilot/shared';
import type { ChatMessage } from '../llm/base.js';
import { estimateMessageTokens, estimateTokens } from './token-counter.js';

/**
 * 预算总盘的默认值：按 128k token 上下文窗口规划。
 *
 * 仅是兜底默认，调用方可按实际所选模型的 contextWindowTokens 覆盖。
 */
export const DEFAULT_TOTAL_CONTEXT_TOKENS = 128_000;

/** estimateTokenUsage 的输入参数。 */
export interface TokenUsageParams {
  /** 组装后的消息列表；其中 system 角色消息不计入任何桶，system 桶以 systemPrompt + skillsText 为准 */
  messages: ChatMessage[];
  /** 本轮暴露给 LLM 的工具定义 */
  tools: Tool[];
  /** 默认系统提示文本 */
  systemPrompt: string;
  /** 注入的 skills 文本（可选） */
  skillsText?: string;
  /** 解析后的附件文本（可选） */
  attachmentsText?: string;
  /** 当前轮用户输入（可选） */
  userContent?: string;
}

/**
 * 按六桶比例切分总上下文预算。
 *
 * 各桶（含 headroom）= floor(totalContextTokens × pct)，未指定的比例沿用
 * DEFAULT_BUDGET_CONFIG；`total` 字段回填原始的 totalContextTokens
 * （floor 造成的取整损耗留在 total 与桶和之差里，不补派给任何桶）。
 *
 * @param totalContextTokens - 模型上下文窗口的 token 总量，必须为正数
 * @param config - 可选的桶比例覆盖（字段级覆盖，其余沿用默认）
 * @returns 各桶分配的 token 数（含 total 汇总）
 * @throws RangeError 当 totalContextTokens <= 0
 */
export function computeBudget(
  totalContextTokens: number,
  config?: BudgetConfig,
): BudgetBreakdown {
  if (totalContextTokens <= 0) {
    throw new RangeError(
      `totalContextTokens 必须为正数，实际收到：${totalContextTokens}`,
    );
  }

  // 默认配置打底，调用方按字段覆盖；解构默认值 0 仅为满足 strict 类型，
  // 运行时 DEFAULT_BUDGET_CONFIG 六个字段全部就位。
  const {
    systemPct = 0,
    toolsPct = 0,
    historyPct = 0,
    toolOutputsPct = 0,
    workingPct = 0,
    headroomPct = 0,
  } = { ...DEFAULT_BUDGET_CONFIG, ...config };

  const alloc = (pct: number): number => Math.floor(totalContextTokens * pct);

  return {
    system: alloc(systemPct),
    tools: alloc(toolsPct),
    history: alloc(historyPct),
    toolOutputs: alloc(toolOutputsPct),
    working: alloc(workingPct),
    headroom: alloc(headroomPct),
    total: totalContextTokens,
  };
}

/**
 * 按五桶口径统计当前上下文的实际 token 用量（headroom 为预留，不计量）。
 *
 * 各桶口径：
 * - system：systemPrompt + skillsText 的文本估算之和
 * - tools：每个 Tool 的 name + description + inputSchema 三字段
 *   JSON 序列化后的估算之和（不含 id/safetyLevel 等与 LLM 请求无关的字段）
 * - history：messages 中 user / assistant 消息（含 4 token 消息框架开销）
 * - toolOutputs：messages 中 tool 角色消息（含框架开销），
 *   加上 assistant 消息内嵌 toolCalls 每条的 arguments 字符串估算
 *   （arguments 不属于 assistant content，与 history 计量不重叠）
 * - working：attachmentsText + userContent 文本估算之和
 *
 * @param params - 组装上下文的各组成部分
 * @returns 五桶实际用量（TokenUsage，无 total 字段）
 */
export function estimateTokenUsage(params: TokenUsageParams): TokenUsage {
  // system 桶：系统提示 + skills 注入文本。
  const system =
    estimateTokens(params.systemPrompt) +
    estimateTokens(params.skillsText ?? '');

  // tools 桶：只序列化 LLM 请求真正携带的三个字段。
  let tools = 0;
  for (const tool of params.tools) {
    tools += estimateTokens(
      JSON.stringify({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema,
      }),
    );
  }

  let history = 0;
  let toolOutputs = 0;
  for (const msg of params.messages) {
    if (msg.role === 'tool') {
      // 工具结果消息整体计入 toolOutputs。
      toolOutputs += estimateMessageTokens(msg);
    } else if (msg.role === 'user' || msg.role === 'assistant') {
      // 对话消息计入 history；assistant 的 toolCalls arguments 另行计费到
      // toolOutputs（见函数头注释）。
      history += estimateMessageTokens(msg);
      if (msg.role === 'assistant' && msg.toolCalls) {
        for (const call of msg.toolCalls) {
          toolOutputs += estimateTokens(call.arguments);
        }
      }
    }
    // system 角色消息不在此计量：system 桶以 systemPrompt + skillsText 为准。
  }

  // working 桶：当前轮附件 + 用户输入。
  const working =
    estimateTokens(params.attachmentsText ?? '') +
    estimateTokens(params.userContent ?? '');

  return { system, tools, history, toolOutputs, working };
}
