import type {
  AdapterConfig,
  ChatMessage,
  ProviderAdapter,
} from '../llm/base.js';
import type {
  BudgetConfig,
  Message,
  MessageStatus,
  RunChatMessage,
  RunContext,
  StrategyName,
  TokenUsage,
} from '@my-copilot/shared';
import { listMemories } from '../repo/memory.js';
import {
  computeBudget,
  DEFAULT_TOTAL_CONTEXT_TOKENS,
  estimateTokenUsage,
} from './budget.js';
import { summarizeHistory } from './summarizer.js';
import { truncateHistory, truncateWithStrategy } from './truncator.js';

/** Parsed attachment text (full content, not metadata). */
export interface AttachmentText {
  name: string;
  content: string;
}

/** Skill 注入条目（渐进披露：常规 skill 仅进清单，正文经 read_skill 按需读取）。 */
export interface SkillInjection {
  name: string;
  description?: string;
  triggers?: string[];
  body: string;
  always?: boolean;
}

/** Prior conversation summary to inject as a third system message (T26). */
export interface SummaryInjection {
  text: string;
}

/** 清单 + always 全文段（v1/v2 共用）。字节序确定：清单在前、always 全文在后。 */
export function buildSkillsSection(skills: SkillInjection[]): string {
  const manifest = skills.filter((s) => !s.always && s.body.trim().length > 0);
  const full = skills.filter((s) => s.always && s.body.trim().length > 0);
  if (manifest.length === 0 && full.length === 0) return '';

  const parts: string[] = [];
  if (manifest.length > 0) {
    const lines = manifest
      .map((s) => {
        const desc = s.description?.trim() || '（无描述）';
        const trig = s.triggers && s.triggers.length > 0 ? ` | triggers: ${s.triggers.join(', ')}` : '';
        return `- name: ${s.name} | description: ${desc}${trig}`;
      })
      .join('\n');
    parts.push(
      `The following skills are available. To use one, first read its full ` +
        `instructions with the read_skill tool (pass the exact name), then follow them:\n\n${lines}`,
    );
  }
  if (full.length > 0) {
    const blocks = full.map((s) => `# Skill: ${s.name}\n\n${s.body.trim()}`).join('\n\n---\n\n');
    parts.push(`Always apply these skills:\n\n${blocks}`);
  }
  return parts.join('\n\n');
}

/** Phase 1 default system prompt — fixed Chinese instruction. */
const DEFAULT_SYSTEM_PROMPT = '你是一个乐于助人的 AI 助手,请用中文回答用户问题。';

/**
 * Assemble a complete message list for the LLM API call.
 *
 * Assembly order:
 * 1. Default system prompt
 * 2. Enabled skills (as additional system message, sorted by createdAt upstream)
 * 3. Prior conversation summary (T26, optional third system message)
 * 4. History messages:
 *    a. filter to `status === 'sent'`
 *    b. truncate to `maxTokens` budget when provided (T24, preserves tool chains)
 *    c. convert to ChatMessage (tool-role handling)
 * 5. Attachment text blocks (prepended to user message)
 * 6. Current user message
 *
 * Skills are pre-sorted (by createdAt) by the caller. The assembler only
 * filters out empty bodies and joins them into a single system message.
 *
 * `summary` and `maxTokens` are optional. When omitted, behavior is
 * byte-identical to the pre-T26 assembler (backward compatible).
 */
export function assembleMessages(params: {
  history: Message[];
  userContent: string;
  attachments?: AttachmentText[];
  skills?: SkillInjection[];
  summary?: SummaryInjection;
  maxTokens?: number;
}): ChatMessage[] {
  const messages: ChatMessage[] = [];

  // 1. Default system prompt
  messages.push({ role: 'system', content: DEFAULT_SYSTEM_PROMPT });

  // 2. Inject enabled skills (if provided) as an additional system message.
  const skillsText = buildSkillsSection(params.skills ?? []);
  if (skillsText) {
    messages.push({ role: 'system', content: skillsText });
  }

  // 3. Inject prior conversation summary (T26) as a third system message.
  //    Placed AFTER default prompt and skills so the LLM reads framing →
  //    capabilities → recent context. Backward-compatible: omitted when no summary.
  if (params.summary && params.summary.text.trim().length > 0) {
    messages.push({
      role: 'system',
      content: `[Previous conversation summary]\n\n${params.summary.text}`,
    });
  }

  // 4a. History — filter to only `status === 'sent'` messages first. Splitting
  //     filtering from conversion (T26) lets truncateHistory run on a clean
  //     Message[] view, before role/toolCallId reshaping.
  const validStatus: MessageStatus = 'sent';
  const validMessages: Message[] = params.history.filter(
    (msg) => msg.status !== 'aborted' && msg.status === validStatus,
  );

  // 4b. Truncate to the token budget when provided. truncateHistory operates
  //     on DB Message[] and preserves assistant+tool chains.
  const finalHistory =
    typeof params.maxTokens === 'number' && params.maxTokens > 0
      ? truncateHistory({ history: validMessages, maxTokens: params.maxTokens }).truncated
      : validMessages;

  // 4c. Convert filtered (and possibly truncated) Message[] → ChatMessage[].
  //     Tool-role messages keep their toolCallId; others forward toolCalls.
  for (const msg of finalHistory) {
    if (msg.role === 'tool') {
      // Tool-result messages must reference their parent tool call.
      if (!msg.toolCallId) continue;
      messages.push({
        role: 'tool',
        content: msg.content,
        toolCallId: msg.toolCallId,
      });
    } else {
      // user / assistant / system — forward toolCalls when present
      messages.push({
        role: msg.role,
        content: msg.content,
        ...(msg.toolCalls ? { toolCalls: msg.toolCalls } : {}),
      });
    }
  }

  // 5 & 6. Attachments + user message (in same user message)
  let userContent = '';
  if (params.attachments && params.attachments.length > 0) {
    for (const att of params.attachments) {
      userContent += `[附件:${att.name}]\n${att.content}\n[/附件]\n`;
    }
  }
  userContent += params.userContent;
  messages.push({ role: 'user', content: userContent });

  return messages;
}

// ===========================================================================
// Context Management v2（T7）：assembleMessagesV2 核心装配管线
// ===========================================================================

/** Prompt Caching 模式（RFC §3）。'anthropic' / 'openai' 承诺稳定前缀顺序，'none' 无额外承诺。 */
export type CacheControlMode = 'anthropic' | 'openai' | 'none';

/** 降级链第三级：单条 tool 输出保留的字符上限（超出部分截断后追加标记）。 */
const TOOL_OUTPUT_MAX_CHARS = 2000;

/** 降级链第三级追加的截断标记。 */
const TOOL_OUTPUT_TRUNCATED_SUFFIX = '…[truncated]';

/**
 * assembleMessagesV2 的输入参数：在原 assembleMessages 参数基础上扩展 v2 字段。
 * 对应 RFC《Context Management v2》§1/§3/§4/§6/§7（docs/rfc/context-management-v2.md）。
 */
export interface AssembleV2Params {
  history: Message[];
  userContent: string;
  attachments?: AttachmentText[];
  skills?: SkillInjection[];
  summary?: SummaryInjection;
  /** Memory 注入用的会话 id（RFC §4）；提供时读取该会话全部记忆并注入 system 消息。 */
  sessionId?: string;
  /** 摘要降级（第二级）使用的 provider adapter；与 adapterConfig 成对出现，缺省时第二级被跳过。 */
  adapter?: ProviderAdapter;
  /** 摘要降级使用的连接配置。 */
  adapterConfig?: AdapterConfig;
  /** 模型上下文窗口 token 总量（默认 DEFAULT_TOTAL_CONTEXT_TOKENS = 128k）。 */
  totalContextTokens?: number;
  /** 六桶比例覆盖（默认 DEFAULT_BUDGET_CONFIG，RFC §1）。 */
  budgetConfig?: BudgetConfig;
  /** history 桶调度策略（RFC §2，默认 'sliding_window'）。 */
  strategy?: StrategyName;
  /**
   * Prompt Caching 模式（RFC §3，默认 'none'）。见 assembleMessagesV2 JSDoc
   * 的设计决策：'anthropic' / 'openai' 只承诺稳定前缀顺序，不做任何字段注入。
   */
  cacheControl?: CacheControlMode;
}

/**
 * 将 DB Message[] 转换为 ChatMessage[]。与原 assembleMessages 的 history
 * 转换逻辑保持一致：tool 消息必须携带 toolCallId，其余角色透传 toolCalls。
 */
function historyToChatMessages(messages: Message[]): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const msg of messages) {
    if (msg.role === 'tool') {
      if (!msg.toolCallId) continue;
      out.push({
        role: 'tool',
        content: msg.content,
        toolCallId: msg.toolCallId,
      });
    } else {
      out.push({
        role: msg.role,
        content: msg.content,
        ...(msg.toolCalls ? { toolCalls: msg.toolCalls } : {}),
      });
    }
  }
  return out;
}

/**
 * Context v2 核心装配函数（T7）：把五桶预算（RFC §1）、多策略调度（RFC §2）、
 * Memory 注入（RFC §4）与 Prompt Caching 前缀稳定性（RFC §3）接线成完整管线，
 * 实现 RFC §6 的 Token 预算耗尽降级链，并返回 Agent Loop v2 的 RunContext（RFC §7）。
 *
 * 组装顺序（稳定前缀）：system（默认提示）→ skills → memory（可选）→
 * summary（可选）→ history → user。
 *
 * 降级链（RFC §6，超预算时依序执行，终点不抛错，符合一致性条款 C3）：
 * 1. **第一级——活动策略截断**：`truncateWithStrategy(history, budget.history,
 *    params.strategy)`。滑窗是正常调度，不算降级（degraded 不置位）。
 * 2. **第二级——sliding_window_summary**：summaryText 由 summarizeHistory
 *    真实调用 LLM 生成（仅当 params.adapter 与 params.adapterConfig 同时存在；
 *    summarizeHistory fail-soft 返回 null 时跳过本级）。摘要对象是一级被丢弃
 *    的前缀；一级没有丢消息（溢出源自其它桶）时退化为对全量历史做摘要。
 *    本级触发即视为降级。
 * 3. **第三级——tool 输出截断**：保留消息里 role='tool' 的 content 截到每条
 *    ≤ 2000 字符并追加 `…[truncated]`。本级触发即视为降级。
 * 4. **终点——仍超预算**：不抛错，置 degraded=true 并 console.warn 一条中文
 *    警告后按当前截断结果继续。
 *
 * 超预算判定口径：五桶任一实际用量（estimateTokenUsage）超过其配额
 * （computeBudget）。history 桶溢出驱动第一/二级；toolOutputs 桶溢出驱动
 * 第三级；system / working 桶是不可妥协桶（RFC §1），只能走到终点告警。
 * Memory 在降级链之后注入（任务规定的执行顺序），不参与链内计量。
 *
 * Prompt Caching 设计决策（RFC §3）：cache_control 字段的放置属于 adapter
 * 层职责（Anthropic ephemeral 需要在请求体上打标记，OpenAI implicit 无显式
 * 标记），而 RunContext 只携带 messages，因此本函数不做任何缓存字段注入。
 * assembler 侧承担的是缓存命中的前提——排序稳定性：cacheControl 为
 * 'anthropic' / 'openai' 时承诺 system→skills→memory→summary→history 的
 * 稳定前缀顺序（确定性字节序、无时间戳漂移、skills 顺序原样保留）。该
 * 顺序由下方固定的组装顺序无条件保证，与 cacheControl 取值无关。
 */
export async function assembleMessagesV2(
  params: AssembleV2Params,
): Promise<RunContext> {
  const totalContextTokens =
    params.totalContextTokens ?? DEFAULT_TOTAL_CONTEXT_TOKENS;
  const strategy: StrategyName = params.strategy ?? 'sliding_window';
  const cacheControl: CacheControlMode = params.cacheControl ?? 'none';
  if (cacheControl !== 'none') {
    // RFC §3：anthropic / openai 模式仅承诺稳定前缀顺序（由下方固定的
    // 组装顺序保证），不向 messages 注入任何 cache_control 字段——
    // 断点放置是 adapter 层职责。
  }

  // (1) 前缀各组成部分的文本（与最终注入的 system 消息逐字节一致）。
  const systemPrompt = DEFAULT_SYSTEM_PROMPT;

  const skillsText = buildSkillsSection(params.skills ?? []);

  const summaryMessageText =
    params.summary && params.summary.text.trim().length > 0
      ? `[Previous conversation summary]\n\n${params.summary.text}`
      : '';

  // 附件前缀：与最终 user 消息中的附件块一致，用于 working 桶计量。
  let attachmentPrefix = '';
  if (params.attachments && params.attachments.length > 0) {
    for (const att of params.attachments) {
      attachmentPrefix += `[附件:${att.name}]\n${att.content}\n[/附件]\n`;
    }
  }

  // system 桶计量口径：默认提示 + skills + 原 summary 文本（稳定前缀的
  // 文本部分）。tools 桶由 adapter 层的工具定义计量，本函数恒传空数组。
  const prefixUsageText = [skillsText, summaryMessageText]
    .filter((text) => text.length > 0)
    .join('\n\n');

  const budget = computeBudget(totalContextTokens, params.budgetConfig);

  const validMessages: Message[] = params.history.filter(
    (msg) => msg.status !== 'aborted' && msg.status === 'sent',
  );

  // 按当前 history 子集重估五桶用量。
  const estimateUsage = (historyMsgs: Message[]): TokenUsage =>
    estimateTokenUsage({
      messages: historyToChatMessages(historyMsgs),
      tools: [],
      systemPrompt,
      skillsText: prefixUsageText,
      attachmentsText: attachmentPrefix,
      userContent: params.userContent,
    });

  // 超预算判定：五桶任一用量超过其配额。
  const isOverBudget = (usage: TokenUsage): boolean =>
    usage.system > budget.system ||
    usage.tools > budget.tools ||
    usage.history > budget.history ||
    usage.toolOutputs > budget.toolOutputs ||
    usage.working > budget.working;

  let current = validMessages;
  let usage = estimateUsage(current);
  let summaryLevelApplied = false;
  let toolTruncateLevelApplied = false;
  let overflowedAtEnd = false;

  if (isOverBudget(usage)) {
    // (3) 第一级：活动策略截断（正常调度，不算降级）。
    const level1 = truncateWithStrategy(current, budget.history, strategy);
    current = level1.truncated;
    usage = estimateUsage(current);

    if (isOverBudget(usage)) {
      // (4) 第二级：sliding_window_summary（仅当 adapter 齐备时真调 LLM）。
      let summaryText: string | undefined;
      if (params.adapter && params.adapterConfig) {
        const keptIds = new Set(current.map((m) => m.id));
        const droppedPrefix = validMessages.filter((m) => !keptIds.has(m.id));
        // 一级没有丢消息（溢出源自其它桶）时退化为对全量历史做摘要，
        // 保证二级仍能给模型留下被压缩上下文的记忆。
        const summarizeSource =
          droppedPrefix.length > 0 ? droppedPrefix : validMessages;
        const summarized = await summarizeHistory({
          messages: historyToChatMessages(summarizeSource),
          adapter: params.adapter,
          adapterConfig: params.adapterConfig,
        });
        if (summarized) summaryText = summarized.summary;
      }
      if (summaryText) {
        // 从原始（未截断）历史重新调度：sliding_window_summary 内部会
        // 重跑滑窗并把摘要消息注入到头部 system 之后。
        const level2 = truncateWithStrategy(
          validMessages,
          budget.history,
          'sliding_window_summary',
          { summaryText },
        );
        current = level2.truncated;
        usage = estimateUsage(current);
        summaryLevelApplied = true;
      }

      if (isOverBudget(usage)) {
        // (5) 第三级：tool 输出截断（每条 ≤ 2000 字符 + 后缀标记）。
        let truncatedAny = false;
        current = current.map((msg) => {
          if (
            msg.role === 'tool' &&
            msg.content.length > TOOL_OUTPUT_MAX_CHARS
          ) {
            truncatedAny = true;
            return {
              ...msg,
              content:
                msg.content.slice(0, TOOL_OUTPUT_MAX_CHARS) +
                TOOL_OUTPUT_TRUNCATED_SUFFIX,
            };
          }
          return msg;
        });
        if (truncatedAny) {
          toolTruncateLevelApplied = true;
          usage = estimateUsage(current);
        }

        if (isOverBudget(usage)) {
          // (6) 终点：不抛错，记录中文警告后按当前结果继续。
          overflowedAtEnd = true;
          console.warn(
            '[assembler-v2] 上下文预算在完整降级链（策略截断、LLM 摘要、工具输出截断）后仍超限，已尽最大努力，按当前截断结果继续。',
          );
        }
      }
    }
  }

  const degraded =
    summaryLevelApplied || toolTruncateLevelApplied || overflowedAtEnd;

  // (7) Memory 注入（RFC §4）：插在 skills 之后、summary 之前。
  // 读取失败不阻断装配（一致性条款 C3），告警后跳过。
  let memoryMessageText = '';
  if (params.sessionId) {
    try {
      const memories = listMemories(params.sessionId);
      if (memories.length > 0) {
        memoryMessageText = `[Persistent memory]\n\n${memories
          .map((m) => `- ${m.key}: ${m.value}`)
          .join('\n')}`;
      }
    } catch (err) {
      console.warn('[assembler-v2] 记忆读取失败，跳过 Memory 注入：', err);
    }
  }

  // (9) 最终拼装（稳定前缀顺序：system → skills → memory → summary →
  //     history → user），附件 + 用户消息按原 assembleMessages 逻辑拼装。
  const messages: ChatMessage[] = [];
  messages.push({ role: 'system', content: systemPrompt });
  if (skillsText) {
    messages.push({ role: 'system', content: skillsText });
  }
  if (memoryMessageText) {
    messages.push({ role: 'system', content: memoryMessageText });
  }
  if (summaryMessageText) {
    messages.push({ role: 'system', content: summaryMessageText });
  }
  for (const chatMsg of historyToChatMessages(current)) {
    messages.push(chatMsg);
  }
  messages.push({
    role: 'user',
    content: attachmentPrefix + params.userContent,
  });

  // (10) 包装为 RunContext：ChatMessage 字段与 RunChatMessage 直接兼容。
  const runMessages: RunChatMessage[] = messages.map((m) => ({
    role: m.role,
    content: m.content,
    ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
    ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
  }));

  return { messages: runMessages, budget, degraded };
}
