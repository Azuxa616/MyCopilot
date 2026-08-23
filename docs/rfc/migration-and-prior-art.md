# 迁移与既有成果映射

> 状态：**提案** · 负责人：跨切面 · 依赖：T2 Agent Loop v2、T3 Context Management v2、T4 Plugin Manifest & Lifecycle、T5 Plugin Extension Points、T6 Plugin Security & Threat Model，以及 `docs/` 下的三份既有设计文档。
> 范围：本文件**仅为综合文档**。它映射 v2 RFC 集（T2-T6）与既有设计文档之间的关系，提供覆盖 Skill / MCP / Tool / Agent 的概念映射表，并定义分阶段的迁移路径。本文件不重复 T2-T6 已冻结的任何内容，也不修改 `apps/` 或 `packages/` 下的任何源码。

## 动机

v2 RFC 集（T2 至 T6）产出了五份设计文档、四个 JSON Schema 系列、十一个 TypeScript 类型模块和七张 Mermaid 图。每份 RFC 都是自洽且内部一致的，但一个想要落地整套系统的实现者必须回答三个任何单一 RFC 都未涉及的问题：

1. **既有设计文档中有哪些内容延续下来？** 有三份文档早于本次 RFC 浪潮：`docs/2026-06-20-fullstack-agent-upgrade-design.md`（三阶段全栈升级）、`docs/2026-07-11-tool-safety-system-design.md`（3 级安全模型）和 `docs/2026-07-12-common-builtin-tools-plan.md`（七个内置工具）。各 RFC 都引用了它们，但从未在同一处明确说明：哪些决策被保留、哪些被升级、哪些被取代。
2. **v1 概念如何映射到 v2？** 了解 v1 代码库（`runner.ts`、`executor.ts`、`prompt/*`、`mcp/manager.ts`）的读者需要一张统一的对照表，说明"v1 中的概念 X 现在位于 v2 的位置 Y"。没有这张表，每个实现者都要重新发明映射关系。
3. **迁移顺序是什么？哪些阶段可以独立回滚？** 五份 RFC 各自定义了分阶段迁移，但它们之间存在依赖：T5 hooks 位于 T2 runner 之前；T6 沙箱化以 T4 生命周期为前提；T3 记忆层桥接到 T4 的 `plugin_data`。尊重这些依赖关系的统一迁移路径在任何单一 RFC 中都不存在。

本文档填补这三处空白。它是未来某个实现任务在深入各份 RFC 之前首先要阅读的桥梁。

## 目标

- 阐述三份既有设计文档与 v2 RFC 集之间的**延续关系**：哪些内容原样保留、哪些被升级、哪些被扩展到新维度。
- 提供一张统一的**概念映射表**，覆盖 Skill、MCP、Tool、Agent —— v1 代码库与 v2 插件系统共享的四个原语 —— 让实现者能把 v1 的知识翻译到 v2 的位置上，而无需重读五份 RFC。
- 定义一条**分阶段迁移路径**（X.1 至 X.6），把五份 RFC 各自的迁移序列化为一条尊重依赖关系的顺序，其中每个阶段都可独立回滚，且没有任何阶段会修改既有的持久化行。
- 记录**最小集合的跨切面决策**：迁移顺序原则，以及在本文件内重复规范的反例。

## 非目标

以下内容明确不在范围内，且本文件**绝不可**（MUST NOT）引入：

- **重复规范 T2-T6 的内容。** 本文件只做映射与排序，不重新定义 Run 生命周期、五桶预算、清单 schema、扩展点契约或 STRIDE 威胁清单。映射所需的具体细节以引用方式给出并交叉链接到权威 RFC，绝不重新以权威口吻陈述。
- **引入新的设计决策。** 若 RFC 之间存在缺口，应记录为开放问题，而不是在本文件中悄悄填补。
- **修改源码。** 这是纯文档交付物。硬性护栏 `git diff --stat apps/ packages/` **必须**（MUST）保持为空。
- **覆盖未来工作。** 推迟到后续轮次的项目（marketplace、签名、多 Agent 编排、完整 Artifact 子系统、vector DB）由同级文档 `future-work.md` 处理。
- **假设宿主使用特定的实现语言或运行时。** 迁移路径描述的是契约的落地点，而非逐文件的重构。

## 规范

### 1. 与既有设计文档的关系

#### 1.1 `docs/2026-06-20-fullstack-agent-upgrade-design.md` —— 三阶段计划

这是奠基性的设计文档，确立了 monorepo 布局（`apps/server`、`apps/web`、`packages/shared`）、三阶段演进（Phase 1 全栈基础、Phase 2 Agent 能力加固、Phase 3 多 Agent），以及 Agent 概念体系（Agent / Skill / Tool / MCP）。

**原样保留：**

- **四原语概念体系**（Agent、Skill、Tool、MCP）及其职责边界 —— Skill 提供知识，Tool 提供动作，MCP 是批量 Tool 容器，Agent 是绑定实例。v2 RFC 从未重新讨论这一点；T4 §1 把它重述为插件的 `provides` 块。
- **三阶段演进意图。** Phase 1（全栈基础、单一默认 Agent）已交付。Phase 2（内置 Tools、MCP、Skill 导入、高风险门禁、异步 Job）正在进行。Phase 3（自定义 Agents）是未来工作。v2 RFC 是 Phase 2 收尾与 Phase 3 地基的详细设计。
- **API 优先与单用户假设。** 没有任何 RFC 引入 user 表或多租户边界。

**被 v2 RFC 升级：**

- **Agent Loop** 从 `runner.ts` 中隐式的 `while` 循环升级为 T2 的显式 Run 生命周期状态机、LoopGuard v2、并发工具池和 stop_reason 路由表。v1 的 `AgentLoopStatus`（5 个值）映射到 v2 的 `RunStatus`（8 个值）；参见 T2 的概念映射表。
- **Context 流水线** 从单一预算的 `truncateHistory` 升级为 T3 的五桶预算、多策略调度、prompt 缓存和跨会话记忆。旧的 `assembleMessages` 签名作为包装器保留。
- **Plugin 概念** —— 2026-06-20 文档中不存在，仅提到独立的 Skill / MCP / Tool —— 由 T4 引入为完整的可分发扩展单元，T5 规定其扩展点，T6 规定其威胁模型。这是 v2 浪潮中最大的单项新增。

**被扩展到新维度：**

- 2026-06-20 文档把 Agent/Skill/Tool/MCP 定义为**运行时概念**。T4 通过插件清单把它们扩展为**可分发、可版本化、可授权的包**，同时不替代独立接口（根据决策 A1，向后兼容是强制的）。

#### 1.2 `docs/2026-07-11-tool-safety-system-design.md` —— 3 级安全模型

这份文档定义了 `safe` / `restricted` / `danger` 安全等级、按 `sessionId + agentId + toolRef + policyVersion + resourceScope` 作键的会话级确认缓存、`ToolRef` 解析契约、只能更严格的每 Agent 覆盖，以及通过 `executor.ts` 的统一执行路径。

**完全保留 —— 未引入并行的方案：**

- T6 §3 明确指出："该模型**复用**既有的 3 级 `SafetyLevel`，而不是引入并行方案。" `executor.ts:219-234` 处的 `STRICTNESS` 映射、`resolveEffectiveSafetyLevel` 和 `stricterLevel` 是权威。
- T2 的 LoopGuard v2 和并发工具池建立在确认流程之上：`danger` 级工具在进入池之前先确认，对 `restricted` 工具保留既有的会话缓存语义。
- T5 的 Tools 扩展点将插件工具默认设为 `restricted`，并通过同一个 `stricterLevel` 调用把 MCP 提供的插件工具至少夹紧到 `restricted`。

**被 T6 扩展到插件维度：**

- 2026-07-11 文档对**工具调用**进行门禁。T6 通过 `permissions` 块（`tools`、`network`、`filesystem`、`childProcess`、`envVars`）、默认拒绝出网策略和提权快速失败响应对**插件包**进行门禁。工具安全确认缓存被复用于网络出网确认（以归一化后的 origin 作为 `resourceScope` 作键）。

简言之：3 级安全模型是**调用时**门禁；T6 权限上限是**打包时**门禁。它们是组合关系，不是重叠关系。

#### 1.3 `docs/2026-07-12-common-builtin-tools-plan.md` —— 七个内置工具

这份文档规定了第一批七个 `safe` 内置工具（`current_datetime`、`calculator`、`generate_uuid`、`hash_text`、`base64_encode`、`base64_decode`、`json_format`），加上既有的 `web_search` 和 `http_fetch`，全部通过 `ToolExecutor` 在代码中注册。

**在 v2 分层模型中的位置：**

- 这九个工具在 T4 的 3 层模型中属于 **Tier 1 Built-in**。它们被编译进宿主，从不走插件协议，没有 `plugin.json`，在进程内以完全信任运行。这不是降级 —— 对于项目直接发布和审查的代码，这是正确的分层。
- 项目希望**独立于主应用发布**的未来内置工具，走 **Tier 2 插件协议**（`source: "official"`），使用与社区插件相同的清单、生命周期和扩展点契约。这正是决策 A4 设计要启用的自用验证闭环。

**无回归：** 这七个工具的 `safe` 等级、它们的输入限制（字符串工具 1 MiB，`calculator` 为 512 字符）以及通过 `builtinExecutors` 的注册，都不被任何 v2 RFC 修改。

### 2. 概念映射表（Skill / MCP / Tool / Agent）

下表是四个原语的权威 v1 → v2 位置映射。"Tier 可用性"标注哪些插件分层可以提供该概念；"向后兼容"说明 v1 独立接口是否保留。

| v1 概念 | v2 位置 | Tier 可用性 | 向后兼容 |

| --- | --- | --- | --- |

| Skill | `Plugin.provides.skills` | Tier 1 内置加载器、Tier 2 官方插件、Tier 3 社区插件 | `SKILLS_DIR` 下的独立 skills 继续工作；插件 skills 是叠加关系 |

| MCP | `Plugin.provides.mcpServers` | Tier 1 stdio 传输、Tier 2 官方插件、Tier 3 社区插件 | `mcps` 表中的独立行继续工作；运行时路径通过 `mcp/manager.ts` 共享 |

| Tool —— 内置 | Tier 1 Built-in | 仅 Tier 1 —— 编译进宿主，从不走插件协议 | 九个既有内置工具不变；未来内置工具**可以**（MAY）以 Tier 2 插件形式发布 |

| Tool —— MCP 提供 | `Plugin.provides.mcpServers` 工具 | Tier 2 和 Tier 3 插件 | 瞬态工具在连接时重新列举；为卸载清理添加了 `source_plugin_id` 判别字段 |

| Tool —— 插件作用域 | 通过 Tools EP 的 `Plugin.provides.tools` | Tier 2 和 Tier 3 插件 | 新接口；命名空间化为 `pluginId:toolName`；默认 `restricted` |

| Agent | `Plugin.provides.agentPreset` | Tier 2 官方插件、Tier 3 社区插件 —— Phase 3 未来 | 独立默认 Agent 隐式存在；自定义 Agents 是 Phase 3 交付物 |

| Context Provider | `Plugin.provides.contextProviders` | Tier 2 进程内、Tier 3 子进程 | 新的 MAY 扩展点；桥接到 `prompt/assembler.ts` |

| Memory Backend | `Plugin.provides.memoryBackends` | Tier 2 推荐、Tier 3 进程外 | 新的 MAY 扩展点；桥接到 `memories` 表和 `plugin_data` 存储 |

| LLM Provider | `Plugin.provides.llmProviders` | 仅 Tier 1 和 Tier 2 进程内 —— Tier 3 被禁 | 新的 MAY 扩展点；RFC 集中最严格的分层 |

**如何读这张表。** 某概念标注为 "Tier 1" 并不意味着只有 Tier 1 能使用它 —— 它指的是 v1 独立接口就是 Tier 1 的等价物。"Tier 可用性"列列出哪些插件分层还可以通过 `provides` 贡献该概念。例如，Skill 在所有三个分层都可用：Tier 1 通过独立的 `SKILLS_DIR` 加载器，Tier 2/3 通过 `Plugin.provides.skills`。

### 3. 迁移路径（分阶段、尊重依赖）

每份单独的 RFC 都定义了自己的分阶段迁移。本节把它们序列化为一条统一的路径。各阶段标号为 X.1 至 X.6，以避免与各 RFC 内部的阶段编号冲突（T2 的 Stage A/B/C，T3 的 Phase 0-4 等）。每个阶段都可独立回滚；没有任何阶段会修改 `messages`、`message_summaries`、`tools` 或 `mcps` 中既有的持久化行。

迁移路径渲染于 `docs/rfc/diagrams/migration-path.mmd`。

**Phase X.1 —— Agent Loop v2（不依赖任何东西）。** 在 `runner.ts` 内落地 Run 生命周期状态机、LoopGuard v2、并发工具池和 stop_reason 路由表。先发布 T2 的 Stage A（内部重命名，无线上协议变更），随后是 Stages B 和 C（`delta` 上可选的 `kind` 字段、并发池）。11 个 SSE 事件被保留；只出现可选的叠加字段。

**Phase X.2 —— Context Management v2（依赖 X.1 提供的 `RunContext`）。** 在 `prompt/assembler.ts` 落地 `RunContext` 契约、五桶预算和策略注册表。T3 的 Phase 0（契约）和 Phase 1（标志位背后的策略）在此发布。`memories` 表迁移（T3 Phase 2）可并行落地，因为它初始是只读的。

**Phase X.3 —— 插件清单解析 + 生命周期（运行时不依赖任何东西，但受益于 X.1/X.2 契约）。** 落地 `plugin.json` schema 校验、七态生命周期状态机、`plugin_data` 表和 `PluginStore` API。T4 的 Phases 0-3 在此发布。到 X.3 结束时，插件可以安装和校验，但还不贡献任何活动能力。

**Phase X.4 —— 既有 MCP 服务被自动识别为 Tier 2（兼容）。** `mcps` 表中的既有行被作为隐式 Tier 2 插件（`source: "official"`）处理，用于命名空间和审计。无行为变化：它们继续使用 `mcp/manager.ts`，工具保持瞬态，30s 超时不变。这就是决策 A1 承诺的向后兼容桥。

**Phase X.5 —— 扩展点（依赖 X.3，按 EP 优先级排序）。** 按 T5 的优先级顺序接通七个扩展点：先是 Tools EP（位于既有的 `ToolExecutor` 注册表之上），其次是 Lifecycle Hooks dispatcher（位于 `runner.ts` 的 `onEvent` 之前），第三是 Artifact Renderer host（前端 iframe + CSP），然后是四个 MAY 点（Context Providers、LLM Providers、Memory Backends、UI Panels），顺序不限。

**Phase X.6 —— 沙箱 + 性能预算（依赖 X.3 和 X.5）。** 落地 Tier 3 子进程沙箱（`worker_threads`，按 T6 ADR-1）、运行时权限检查（T6 Phase 2）、默认拒绝网络出网和审计日志发出。Tier 2 插件保持进程内运行，不受影响。

**依赖说明。** X.4 在概念上依赖 X.3（命名空间和审计基础设施），但如果 X.3 的清单校验尚未接通，它在运行时是空操作 —— 既有的 MCP 行无论如何都继续工作。一旦 X.3 落地，X.5 和 X.6 可能在时间上重叠，但 X.6 的沙箱必须在 X.5 的 Tools EP 之后，以便沙箱有真正的调用路径可以隔离。

## 迁移

下面的迁移原则适用于全部六个阶段。

**叠加式，绝不破坏式。** 每个阶段都扩展 v1 接口；没有任何阶段移除它。旧的 `assembleMessages` 签名作为包装器保留（T3 §7）。11 个 SSE 事件被冻结（T2 Non-Goals）。独立的 Skill 加载器和 MCP 管理器继续工作（T4 §1，向后兼容）。一个连接到部分迁移的 v2 server 的 v1 客户端，对于它未选择的任何功能，看到的行为完全一致。

**每个阶段都可独立回滚。** 回滚 X.5 不要求回滚 X.3 或 X.4。回滚 X.2 不要求回滚 X.1。这由"契约优先"的落地模式强制保证：每个阶段先发布其类型和 schema（每份 RFC 的 Phase 0），然后在标志位或复现 v1 的默认值背后接通行为。

**没有任何阶段修改持久化行。** `messages`、`message_summaries`、`tools`、`mcps`、`sessions` 和 `providers` 表是 v2 状态的只读消费者，从不被原地改写。新表（`plugin_data`、`memories`、审计日志）是叠加的。这意味着失败的迁移永远不会破坏既有的聊天历史。

**源码变更推迟到实现任务。** 本文件与所有 T 系列交付物一样，不修改 `apps/` 或 `packages/` 下的任何内容。上面的阶段描述的是未来某个实现任务应遵循的顺序；它们本身不是编辑。

### 决策 (ADR-1：契约优先、行为在标志位背后迁移)

**背景。** 五份 RFC 都需要落地。它们可以一次性整体落地，也可以契约优先、行为在标志位或复现 v1 的默认值背后落地。

**选项。** (a) 一次性整体：在一次协调变更中落地全部五份 RFC 的行为。(b) 契约优先：先落地类型和 schema，然后在标志位背后接通行为。(c) 随意：每份 RFC 自选迁移风格。

**决策。** (b)。§3 中的每个阶段都先发布其类型和 schema 作为零行为变更的第一步，然后在标志位或精确复现 v1 的默认值背后接通行为。这是每个先前 T 系列 RFC 已经遵循的模式（T2 Stage A、T3 Phase 0、T4 Phase 0、T5 Phase 0、T6 Phase 0）。

**理由。** 一次性整体要求每份 RFC 在它们中任何一份落地之前都达到实现完备，这把五条独立工作流耦合在一起。Ad-hoc 让 §3 中的依赖图无法执行。契约优先让每个阶段都能独立落地、审查和回滚，同时在每个中间状态都保持系统是绿的。

**备选。** (a) 最大化风险和审查负担。(c) 随意方式让统一迁移路径失去意义。

### 反例：在本文件内重新规范 T2-T6

在撰写综合文档时，很容易"为了方便"而把 Run 生命周期状态、五桶预算份额、清单的九个必填字段或 STRIDE 威胁清单内联重述。这是一种反例。重述会创建第二个真相来源，它会在任何 RFC 被修订的那一刻就开始漂移。本文件只引用使映射和迁移顺序可读所需的最少内容，并把每个细节交叉链接到权威 RFC。需要完整 Run 状态表的实现者应阅读 `docs/rfc/agent-loop-v2.md` §1，而不是本文件。

## 开放问题

1. **Phase X.4 的粒度。** 既有的 MCP 行应该在 X.4 被自动包装为合成的 Tier 2 插件记录，还是仅在不创建 `plugins` 表行的前提下，就命名空间和审计目的把它们当作 Tier 2 处理？后者侵入性更小；前者更一致。此处未解决；推迟到 X.4 实现任务。
2. **记忆抽取的调度。** T3 开放问题 1（何时写入 `memories` 行）影响 X.2 的记忆层何时变得有用。本文件不为该决策排期；它只对存储落地排序。
3. **审计日志存储后端。** T6 定义了审计日志 schema，但推迟了存储。X.6 是否在同一阶段落地存储还是后续跟进，是本文件不定的实现选择。
4. **前端迁移跟踪。** 上面的阶段以 server 为中心。前端变更（来自 T2 的 run-progress 状态机、来自 T5 的 Artifact Renderer host、来自 T5 的 UI Panels）需要自己的排序，而这取决于哪些 server 阶段已经落地。一旦 server 阶段 X.1-X.3 转绿，可能需要一份独立的前端迁移文档。

## 参考文献

- `docs/2026-06-20-fullstack-agent-upgrade-design.md` —— 三阶段全栈升级计划；Agent / Skill / Tool / MCP 概念体系和 Phase 1/2/3 演进的来源。
- `docs/2026-07-11-tool-safety-system-design.md` —— 权威的 3 级 `SafetyLevel` 模型、`ToolRef`、`ConfirmationCacheKey` 和每 Agent 覆盖规则，被 T6 原样保留。
- `docs/2026-07-12-common-builtin-tools-plan.md` —— 七个 `safe` 内置工具，构成 T4 3 层模型中的 Tier 1 Built-in。
- `docs/rfc/_architecture-decisions.md` —— 决策 A1（插件概念）、A2（执行边界）、A3（九个扩展点）、A4（3 层模型）、A5（`plugin_data` 存储）、B6（单 loop + mode hint）、B7（最小 Renderer）。
- `docs/rfc/agent-loop-v2.md` —— T2 Agent Loop v2；Run 生命周期、LoopGuard v2、并发工具池和 stop_reason 路由表在 Phase X.1 落地。
- `docs/rfc/context-management-v2.md` —— T3 Context Management v2；五桶预算、策略、prompt 缓存和记忆层在 Phase X.2 落地。
- `docs/rfc/plugin-manifest-lifecycle.md` —— T4 Plugin Manifest & Lifecycle；清单 schema、七态生命周期和 `plugin_data` 存储在 Phase X.3 落地。
- `docs/rfc/plugin-extension-points.md` —— T5 Plugin Extension Points；七个 EP 在 Phase X.5 接通。
- `docs/rfc/plugin-security-threat-model.md` —— T6 Plugin Security & Threat Model；权限上限、沙箱和审计日志在 Phase X.6 落地。
- `docs/rfc/diagrams/migration-path.mmd` —— 分阶段迁移图。
- `apps/server/src/agent-loop/runner.ts` —— v1 runner，被 X.1 在内部替换。
- `apps/server/src/tools/executor.ts:25-29,219-234` —— 3 级安全模型，被 T6 原样复用并被每个扩展点引用。
- `apps/server/src/mcp/manager.ts` —— MCP 连接管理器，被 X.4 复用于 Tier 2 兼容。
- `docs/rfc/future-work.md` —— 同级文档，覆盖所有 Non-Goal 条目及其重新纳入路径。
