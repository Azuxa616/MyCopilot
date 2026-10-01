# 输入框命令与引用（/ 与 @）设计

**日期：** 2026-09-30
**状态：** 设计定稿，待用户批准后转入实施计划
**分支：** main
**来源：** 2026-09-30 产品形态讨论结论沉淀
**关联文档：** `2026-09-30-attachment-assets-multimodal-design.md`（`@file` 消费资产与 parts 管道）、`2026-09-30-model-capability-design.md`（图片引用的能力门控）、`docs/2026-08-22-skill-system-upgrade-design.md`（渐进披露与 `read_skill`）、`docs/2026-07-11-tool-safety-system-design.md`（工具安全分级）

## 背景与动机

当前 `Sender` 是纯 textarea：无命令系统、无引用机制。对照 skill-system-upgrade 设计调研的 Cursor 四象限（always / 智能匹配 / glob / 手动），本项目的 skill 激活已有前两者等价物（`always` 标记 + 模型自主 `read_skill`），**缺手动激活通道**——`/` 补这一格。`@` 补上下文引用（文件 / 历史会话）。

| # | 现状约束 | 代码级事实 |
|---|---------|-----------|
| 0 | textarea 无法内联渲染 chip | `Sender.tsx` 为受控 textarea + `useTextareaAutoHeight` |
| 1 | skill 注入只有清单 + `read_skill` 按需读取 | `prompt/assembler.ts` `buildSkillsSection`（manifest + always 全文两段） |
| 2 | P0 历史教训：两条链路漏传参数 | skill 曾只在管理 UI 生效——`streaming/lifecycle.ts` 与 `jobs/worker.ts` 必须同时接新参数 |
| 3 | 会话引用无数据通道 | `repo/summary.ts` 已有 `getLatestSummary`（T25 摘要表）可复用 |

## 目标

1. `/` 命令：v1 **仅 skill 手动激活**（命令面板 + chip + 确定性注入）
2. `@` 引用：v1 **仅 `@file` 与 `@会话`**
3. 输入框 chip 展示（textarea + overlay 方案，不引入富文本编辑器）
4. `enforcedSkillIds` 注入协议（复用 always 通道，双链路）
5. `read_session` 内置工具（`@会话` 的第二层：按需查阅完整记录）

## 非目标

- 不做 UI 型 / 配置型命令（`/settings`、`/agent xxx` 切换绑定等——未来演进）
- 不做 `@tool` / `@MCP` 授权引用（授权语义与白名单体系的交互需单独设计，防止输入法击穿三级安全体系）
- 不做 `@skill`（用户决策：skill 只走 `/`，避免双入口心智分裂）
- 不引入 Lexical / Slate / ProseMirror 等富文本编辑器（overlay chips 够用；富混排需求真实出现再评估）
- 不做 `@file` 的全库语义搜索（v1 仅标题/文件名匹配）

## 决策记录（用户已确认）

| 决策点 | 结论 | 备选与理由 |
|--------|------|-----------|
| `/` 的 v1 边界 | 仅 skill 激活 | UI/配置命令后置；命令注册表结构预留扩展位 |
| `@` 的 v1 边界 | 仅 `@file` + `@会话` | `@tool` 授权语义敏感，暂缓 |
| skill 调用入口 | 只走 `/`，不进 `@` | 单入口心智 |
| `@会话` 注入语义 | **两层**：先注入摘要；模型判断需要更多细节时可调 `read_session` 查阅完整记录 | 与 skill 的"manifest → `read_skill`"渐进披露同构；纯全量注入会挤爆 working 桶，纯占位又缺信息 |
| 输入框形态 | textarea + overlay chips（chip 限独立段落/行尾定位） | 富编辑器版本耦合重、后置 |

## `/` 命令规范

### 触发状态机

- **触发**：`/` 输入于行首、或前一字符为空格时弹出命令面板；继续输入作为过滤词
- **导航**：`↑` `↓` 选择，`Enter` / `Tab` 确认，`Esc` 关闭；鼠标点选等价
- **chip 化**：确认后 `/` 前缀与过滤词折叠为 chip（如 `⟨/translate⟩`），**不进入 content 文本**；`Backspace` 在 chip 右侧按一次删除整个 chip
- 面板即 skill 目录：展示 name / description / triggers——可发现性是 `/` 的核心价值之一

### 命令注册表（v1）

```ts
interface CommandEntry {
  id: string;            // skill 名（全限定）
  label: string;
  description?: string;
  triggers?: string[];
  kind: 'skill';         // 预留 'ui' | 'config' | 'plugin'
}
```

来源：会话有效 skill 集（**绑定 ∩ 全局启用**，与 `read_skill` 有效集一致——沿用 DIY agent 白名单语义，不另造集合）。

### 发送语义

```ts
// SendMessageParams 扩展
{
  content: string;                 // 纯文本投影（chip 不在其中）
  parts?: MessagePart[];           // 见多模态设计
  enforcedSkillIds?: string[];     // / 命令携带
  referencedSessionIds?: string[]; // @会话 携带
}
```

服务端把 `enforcedSkillIds` 按 **always 语义全文注入**（复用 `buildSkillsSection` 的 full 通道，绕过渐进披露——用户点名 = 确定性意图）。**`streaming/lifecycle.ts` 与 `jobs/worker.ts` 两条链路都必须传递此参数**（skill P0 教训写进两条链路的测试用例）。

## `@` 引用规范

### 触发状态机

与 `/` 相同（`@` + 过滤 + 键盘导航 + chip 化）。两类对象浮层：

| 对象 | 候选来源 | chip 形态 |
|------|---------|----------|
| `@file` | 本会话历史资产 + 个人资产库（按文件名过滤） | `⟨@ 报告.pdf⟩` |
| `@会话` | 会话列表（按标题过滤，排除当前会话） | `⟨@ 会话标题⟩` |

### 发送语义

**`@file`**：chip 解析为资产注入，走多模态设计全部管道——文本类 kind → `AttachmentText` 注入；`image` kind → `image` part（**同样受能力三态门控**：no 时警告条三选）。

**`@会话`（两层）**：

1. **第一层（自动）**：服务端查 `getLatestSummary(targetSessionId)`，以固定格式注入本轮上下文：

```text
[用户引用了会话《标题》的摘要]
<summary 文本；无摘要时降级为：标题 + 消息数 + 首尾消息片段的简易拼接（fail-soft）>
如需完整记录，可调用 read_session 工具（传入 sessionId "<id>"）查阅。
```

2. **第二层（模型自主）**：内置工具 `read_session`：

```ts
{
  name: 'read_session',
  description: '读取指定会话的完整消息记录（用户以 @ 引用时按需查阅）',
  safetyLevel: 'safe',        // 只读、无副作用
  params: { sessionId: string },
  // 输出经 context-management-v2 工具输出降级链截断（超长自动降级）
}
```

**注入策略**：仅当本轮携带 `referencedSessionIds` 时动态注册该工具（避免工具目录常驻膨胀；与 skill 渐进披露的"按需出现"哲学一致）。

## 输入框形态（overlay chips）

```text
┌────────────────────────────────────┐
│ ⟨/translate⟩ ⟨@ 报告.pdf⟩          │  ← chip 层（overlay，独立段落定位）
│ 这段内容帮我翻译成英文               │  ← textarea（纯文本）
└────────────────────────────────────┘
```

- chip 只允许出现在**段落边界**（行首至行尾无其他字符的整行）——大幅简化 overlay 定位与序列化
- 发送时：textarea 文本进 `content`，chips 分别进 `enforcedSkillIds` / parts / `referencedSessionIds`；chip 行从投影中剔除
- 粘贴 / 拖拽图片仍走多模态设计的上传管道，与 chip 系统互不干扰

## 与现有系统的咬合

- **多模态消息设计**：`@file` 是资产层与 parts 管道的消费方；`SendMessageParams` 的扩展字段为两设计共用
- **能力探测设计**：`@file` 引用图片时复用三态门控与警告条
- **skill 系统**：命令注册表与 `read_skill` 共享有效集语义；`enforcedSkillIds` 复用 always 注入通道；两链路传递约束对齐 skill P0 修复
- **工具安全体系**：`read_session` 注册为 safe 级内置工具，进 `tools/registry.ts`；输出截断复用工具输出降级链
- **content-panel 设计**：`@file` chip 悬停预览 / 点击打开复用 contentRef 协议

## 开放问题

1. `read_session` 输出分页：v1 全量 + 降级链截断，还是带 `offset/limit` 参数（建议 v1 全量，降级链已兜底）
2. 命令面板与 `@` 浮层同时触发时的键盘冲突消解（建议：单浮层互斥，后触发者替换）
3. `/` 面板是否展示未绑定但全局启用的 skill（建议：否，与有效集一致）

## 未来演进

- 配置型 / UI 型命令（`/agent` 切换会话绑定、`/settings`）
- `@tool` / `@MCP` 授权引用（白名单内"强制启用"语义，需与三级安全体系联动设计）
- `@agent` 引用（指定本轮使用的 agent）
- 富文本编辑器（chip 富混排、行内引用标记）
