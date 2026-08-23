# 演示版亮点展示增强设计

- **日期**：2026-08-24
- **状态**：已确认（待实施）
- **背景**：当前 `DEMO_MODE` 演示实例按 `2026-08-22-demo-deployment-design.md` 只开放最小白名单，访客仅能体验流式对话与少量 safe 级内置工具；项目最具差异化的能力（Agent 工具调用时间线、工具安全分级与人工确认流、Skills/MCP 管理）全部不可见。本设计在不放宽写权限、不扩大实质攻击面的前提下，让演示「自解释」。
- **前提约束**：面向公开链接的无人引导自助体验，安全约束为硬约束（所有写操作维持 403，默认拒绝语义不变）。

## 动机

演示实例是简历作品的门面，但它展示的内容与项目实际能力严重不匹配：

1. 前端已实现过程时间线 UI（`AgentTimeline`：工具卡片/状态流转/参数与结果回填），但访客无从得知要用提示词触发它。
2. 工具安全分级 + 人工确认流（`confirmation_required` → 批准/拒绝对话框）是全项目最有差异化的安全设计，demo 工具过滤后只剩 safe 级，确认流完全不可见。
3. Skills、MCP 管理界面存在且完整，但路由 403 + 设置入口隐藏，等于不存在。
4. 演示部署自身的安全设计（双 token 降权、SSRF 收敛、限流、每日重置）本应是工程素养的直接证据，但访客看不到任何叙述。

## 目标

- 访客打开链接后，无需引导即可：①看到工具调用时间线的真实渲染效果；②亲手触发工具调用与人工确认流；③只读浏览工具安全分级 / Skills / MCP 管理界面；④读到项目工程亮点叙事。
- 演示实例新增的每一个能力都有明确的安全分析支撑。

## 非目标

- 不放开任何写操作（tools/skills/mcps/providers 的 POST/PATCH/DELETE 维持 403）。
- 不实现 DIY Agent 前端页（无现有页面可复用，属独立功能开发）。
- 不新增 `web_search` 到 demo（外部搜索 API 密钥消耗不可控）。
- 不为 admin/自托管模式改变任何行为（除 `http_fetch` 加固与 `save_note` 注册，两者对自托管同样有益）。

## 1. 播种扩展（`apps/server/src/demo/seed.ts`）

`seedDemoData()` 在播种 Provider/Model 之后追加三类数据（幂等条件不变：providers 表为空才播种，每日重置后自动重建）：

### 1.1 三个示例会话

消息按服务端落库结构写入（`user` → `assistant(toolCalls=[...], content=前导语)` → `role='tool'` 结果消息 ×N → 终态 `assistant`），前端 `attachTimelines()`（`apps/web/src/utils/timeline.ts`）刷新后本就会把这种结构**自动重建为工具卡片时间线**——前端零改动。

| 会话 | 标题 | 展示内容 |
|---|---|---|
| A | 示例 · Agent 工具调用 | hash_text + generate_uuid 双工具时间线（参数/结果回填效果） |
| B | 示例 · 多轮工具协作 | 两轮工具调用 + lead 前导语条目，体现 agent loop 多步执行 |
| C | 示例 · Markdown 渲染 | GFM 表格、代码块语法高亮、列表等富文本渲染 |

注意：reasoning 不持久化（服务端未落库），示例会话中无法静态回放思考条目——思考过程的展示依赖 live 对话（demo Provider 若输出 reasoning 则访客可现场看到）。

**实施风险**：`listMessagesBySession` 按 `created_at ASC` 排序，`createMessage` 的 `now()` 同毫秒会导致乱序。播种路径必须保证每条消息 `createdAt` 严格递增——扩展 `createMessage` 支持显式 `createdAt` 参数（可选字段，默认行为不变）。

### 1.2 两条示例 Skill

播种 2 条真实内容的 Markdown Skill（如「代码审查清单」「技术方案写作助手」），**`enabled: false`**——纯展示用途，不注入 agent 提示词，不改变 demo 对话行为。

### 1.3 一条示例 MCP 行

播种一条 `enabled: false` 的展示行（命名「示例 · filesystem（未连接）」，transport 取 http + 示例 URL），让 MCP 管理页非空。不发起任何连接。

## 2. `save_note` restricted 演示工具

新增内置工具 `apps/server/src/tools/builtins/save-note.ts`：

- `name: 'save_note'`，`type: 'built-in'`，`safetyLevel: 'restricted'`
- 执行：把 ≤4KB 笔记追加写入 config 表 `saved_notes` 键（JSON 数组，FIFO 上限 20 条）——零表结构迁移，纯本地 SQLite 写，无网络无文件系统
- 注册进 `builtinExecutors`（自托管实例同样获得一个真实可用的最小 restricted 工具）
- `DEMO_ALLOWED_TOOLS`（`apps/server/src/demo/tools.ts`）加入 `'save_note'`

效果：demo 模式下 LLM 可调用它 → 触发 `confirmation_required` SSE → 访客看到 `ToolConfirmationDialog` 批准/拒绝对话框 → 批准后执行。**工具安全分级体系从「不可见」变成「可体验」。**

安全分析：写入目标仅 config 表单键，容量有上限（20 条 × 4KB），无网络、无任意文件访问；滥用上限 = 每日重置 + nginx 限流兜底。写操作语义恰当地落在 restricted 级。

同步修订 `2026-08-22-demo-deployment-design.md` §4：白名单现含一个刻意 restricted 的本地工具，用于演示确认流；记录安全分析。

## 3. `http_fetch` SSRF 加固 + demo 纳入

**原则：先加固，后放开。不完成加固不得加入 demo 白名单。**

现状（`apps/server/src/tools/builtins/http-fetch.ts`）为字符串级防护：拦截 `localhost`/`127.0.0.1`/`192.168.`/`10.`/`172.` 字面量。存在三个缺口：

1. **DNS 解析不校验**：域名解析到内网 IP（如 `10.0.0.5`）可直接绕过；
2. **重定向不校验**：`fetch` 默认跟随重定向，公网 URL 302 → `http://169.254.169.254/` 云元数据端点；
3. **网段覆盖不全**：漏 `169.254.0.0/16`（链路本地/云元数据）、`100.64.0.0/10`（CGNAT）、IPv6 ULA（`fc00::/7`）、IPv6 映射地址（`::ffff:127.0.0.1`）等。

### 加固方案

新增 `apps/server/src/tools/builtins/ssrf-guard.ts`（纯函数模块）：

1. **DNS 解析 + CIDR 级校验**：`dns.promises.lookup(hostname, { all: true })` 解析全部地址，逐一按网段校验（v4：`0.0.0.0/8`、`10.0.0.0/8`、`127.0.0.0/8`、`169.254.0.0/16`、`172.16.0.0/12`、`192.168.0.0/16`、`100.64.0.0/10`；v6：`::1`、`::`、`fc00::/7`、`fe80::/10`、`::ffff:0:0/96` 映射地址递归按 v4 规则校验）。任一命中即拒绝。IP 字面量直接走同一校验（不再依赖字符串前缀）。
2. **手动跟随重定向**：`redirect: 'manual'`，最多 3 跳，每跳对 `Location` 解析后的绝对 URL 重新执行完整校验（scheme + DNS + IP）；带 `Location` 的 3xx 逐跳跟随，无 `Location` 的 3xx（如 304）与非 3xx 响应视为最终响应返回；超过跳数上限报错终止。
3. 保留现有约束：仅 GET/HEAD/OPTIONS、30s 超时、5MB 响应上限、50KB 文本截断、自定义 UA。

`safetyLevel` 维持 `restricted`（每次调用仍走确认流，访客会看到「AI 请求访问网页 → 批准/拒绝」的完整体验）。

加固完成后 `DEMO_ALLOWED_TOOLS` 加入 `'http_fetch'`。

**已知取舍**：

- **DNS rebinding 残余风险**：校验（lookup）与连接（fetch 内部二次解析）之间存在 TOCTOU 窗口，攻击者可用短 TTL DNS 在校验后切换到内网 IP。完整消除需连接期 IP 固定（自定义 undici Agent / 直连 IP + Host 头，对 https 有 SNI/证书难题）。本设计接受该残余风险，理由：攻击门槛高（需自控权威 DNS）、demo 容器处于独立 bridge 网络（自用实例跨网不可达）、宿主机内网目标同时受「第二层 CIDR 拦截在跳转/解析时刻生效」约束、滥用频率受 nginx 限流与每日重置封顶。加固本身对自托管模式同样是净收益。
- 关于页将把这套防护本身作为叙事点（「从字符串黑名单到解析期 CIDR 校验」）。

## 4. demo 路由白名单只读扩展（`apps/server/src/middleware/tokenAuth.ts`）

`DEMO_ROUTE_RULES` 追加（仅 GET）：

```
GET /api/tools        GET /api/tools/:id
GET /api/skills       GET /api/skills/:id
GET /api/mcps
```

泄漏面分析：demo 库中 tools 表仅含内置工具描述与播种展示行，skills 表仅含播种的 disabled 示例，mcps 表仅含一条未连接示例行（无真实 command/env）；无 API key、无敏感配置。默认拒绝语义不变——规则外的所有方法（含 `POST /api/tools/execute`、`/confirm` 等执行类端点）仍 403。

## 5. 前端：demo 角色的只读「能力浏览」

- `apps/web/src/components/Asider/index.tsx`（现 `role !== 'demo'` 整块隐藏设置区块）：demo 角色显示「能力」入口，仅指向 Tools / Skills / MCPs 三个设置页；Providers 相关页对 demo 保持不可达（不渲染导航、路由守卫重定向）。
- 三个页面在 `role === 'demo'` 时只读化：隐藏新增/编辑/删除按钮，启停开关（如 ToolsPage 的 switch）渲染为纯状态徽章 + 安全等级 Badge 照常展示。
- 角色状态复用 `configStore.role`（`'admin' | 'demo' | null`，`/api/auth/me` 已接入），无新增全局状态。

## 6. 前端：空状态引导卡片（`EmptyChatView`）

demo 角色下显示一键提示词 chips（admin 不显示）：

1. 「帮我计算 "MyCopilot" 的 SHA-256」→ 现场看到 hash_text 工具卡片时间线动起来
2. 「生成 3 个 UUID」「格式化这段 JSON」
3. 「帮我把这条笔记保存下来：…」→ 触发 save_note 确认对话框
4. 「帮我抓取 https://example.com 的内容」→ 触发 http_fetch 确认对话框 + 网页内容提取

填充机制：`sessionStore` 新增 `draftPrompt: string | null` 与 `setDraftPrompt`；Sender 复用现有 `prevSessionId` 同款守卫渲染模式消费草稿（避免 Effect 滥用，符合项目「You Might Not Need an Effect」惯例）。chips 数据为模块级常量数组，便于后续扩展。

## 7. 前端：「关于本项目」亮点页

新路由 `/about` + 静态页组件（纯 Tailwind，无新依赖），demo 角色侧栏入口「关于本项目」。内容：

- 功能矩阵（标注哪些在演示中开放/仅自托管）
- 架构要点：pnpm monorepo、React 19 + Hono + SQLite、SSE 流式协议（12 种事件类型）、Agent loop + LoopGuard（步数/token 预算/重复调用检测）、工具安全三级分级、上下文管理（预算截断 + 会话摘要）
- 演示实例安全设计叙事：双 token 角色降权、API key 脱敏、SSRF 防护（含本次加固）、限流、每日数据重置
- 仓库链接

## 8. 测试与验收

### 单元测试

- 播种：幂等（二次调用不重复）；示例会话消息 `createdAt` 严格递增；Skill/MCP 播种行 `enabled=false`
- save_note：容量上限、FIFO 淘汰、超长笔记拒绝
- SSRF guard：域名解析到内网 IP 拒绝；字面量内网/元数据/CGNAT/IPv6 ULA 拒绝；公网 IP 放行；重定向跳内网逐跳拦截；跳数上限
- `filterDemoTools`：含 save_note、http_fetch
- tokenAuth：demo GET 新白名单路由通过；tools/skills/mcps 全部 mutation 与 `/execute`、`/confirm` 仍 403

### 前端测试

- EmptyChatView：chips 点击 → Sender 填充（demo 角色）；admin 不渲染 chips
- ToolsPage/SkillsPage/McpsPage：demo 角色无编辑控件
- Asider：demo 显示能力入口、不显示 Providers 入口

### 集成与手动验收（`DEMO_MODE=1`）

- 打开链接 → 会话列表出现三个示例会话 → 会话 A/B 工具时间线正确渲染
- 引导 chips 一键触发工具调用 live 时间线
- 「保存笔记」与「抓取网页」分别触发确认对话框 → 批准 → 工具执行结果回填
- demo 设置入口 → 只读浏览 Tools/Skills/MCPs 三页
- `curl -H "Authorization: Bearer <DEMO_TOKEN>"` 验证：GET /api/tools 200，POST /api/tools/execute 403
- `deploy-demo.md` 验收清单增补对应条目

## 9. 实施顺序

1. **P1**：播种扩展（含 `createMessage` 显式 `createdAt`）+ 路由只读白名单 + Asider/设置页只读化
2. **P2**：SSRF guard 加固 http_fetch + save_note 工具 + demo 白名单更新 + 引导卡片
3. **P3**：关于页
4. **P4**：文档修订（deploy-demo.md 验收清单、2026-08-22 demo 设计文档 §4 修订、README Agent 能力小节提及 demo 体验入口）

## 开放问题

无。
