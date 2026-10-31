/**
 * 问答卡片（ask_user）共享类型与上限常量。
 *
 * 设计：docs/2026-10-31-question-card-design.md
 * 决策（用户已确认）：内置工具 + 确认通道泛化；一次多题（questions[] 1..4）；
 * 「其他」自由文本选项由模型按需开启；回答持久化为 tool 消息；历史只读回放。
 */

/** 卡片单题提问模式：single = 单选（radio），multiple = 多选（checkbox）。 */
export type QuestionCardMode = 'single' | 'multiple';

/** 卡片内的单道题。选项在同一题内以 label 文本为身份（要求唯一）。 */
export interface QuestionCardQuestion {
  /** 问题文本。 */
  question: string;
  /** 问题补充说明（可选）。 */
  description?: string;
  mode: QuestionCardMode;
  /** 选项文案数组（2..6 项，各 ≤ QUESTION_CARD_LIMITS.maxOptionChars）。 */
  options: string[];
  /** 与 options 等长的补充说明数组（可选，按索引对齐）。 */
  optionDescriptions?: string[];
  /** 是否提供「其他」自由文本选项。缺省 false（模型按需开启）。 */
  allowCustomOption?: boolean;
  /** 自定义选项文案，缺省「其他」。 */
  customOptionLabel?: string;
}

/** ask_user 工具调用 arguments 的结构化形态：一次调用可含 1..4 道题。 */
export interface QuestionCardSpec {
  questions: QuestionCardQuestion[];
}

/** 卡片内单道题的用户回答。 */
export interface QuestionAnswerEntry {
  /** 对应 QuestionCardSpec.questions 的数组下标。 */
  index: number;
  /** answered = 正常作答；skipped = 用户跳过整卡时逐题标记。 */
  status: 'answered' | 'skipped';
  /**
   * 选中选项的 label 列表；选择自定义选项时为其实际文案（customOptionLabel），
   * 此时 customText 必填。skipped 时为空数组。
   */
  selections: string[];
  /** 自定义选项的文本输入（≤ QUESTION_CARD_LIMITS.maxCustomTextChars）。 */
  customText?: string;
}

/**
 * ask_user 工具结果（role='tool' 消息 content 的 JSON 形态，模型可见，
 * 前端据此渲染卡片已答/跳过/超时/中止态）。
 */
export interface QuestionCardAnswer {
  status: 'answered' | 'skipped' | 'expired' | 'cancelled';
  /** answered/skipped 时逐题一条；expired/cancelled 时为空数组。 */
  answers: QuestionAnswerEntry[];
  /** ISO 8601 时间戳（answered/skipped 时携带）。 */
  answeredAt?: string;
}

/** 问答卡片尺寸上限（服务端校验与前端 maxLength 的单一事实源）。 */
export const QUESTION_CARD_LIMITS = {
  /** 一次工具调用的题目数上下限。 */
  minQuestions: 1,
  maxQuestions: 4,
  /** 每题选项数上下限。 */
  minOptions: 2,
  maxOptions: 6,
  maxQuestionChars: 500,
  maxDescriptionChars: 1000,
  maxOptionChars: 100,
  maxOptionDescriptionChars: 200,
  maxCustomLabelChars: 20,
  /** 「其他」文本输入上限。 */
  maxCustomTextChars: 2000,
} as const;

/** 设置存储键（config 表）：ask_user 等待超时毫秒数；'0' 或缺省 = 不超时（挂起）。 */
export const ASK_USER_TIMEOUT_CONFIG_KEY = 'ask_user_timeout_ms';
