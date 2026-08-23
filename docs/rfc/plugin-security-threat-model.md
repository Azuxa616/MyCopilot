# RFC：插件安全与威胁模型（Plugin Security & Threat Model）

- 状态：**Proposal**
- 作者：Sisyphus-Junior（T6）
- 日期：2026-08-09
- 依赖：`docs/rfc/_architecture-decisions.md`（T1，决策 A2 子进程隔离与 A4 三层模型）、`docs/rfc/plugin-manifest-lifecycle.md`（T4，清单中的 `permissions` 字段与生命周期语义）、`docs/rfc/plugin-extension-points.md`（T5，每个扩展点的安全分级），以及 `docs/2026-07-11-tool-safety-system-design.md`（本 RFC 复用、绝不重新发明的权威 3 级 `SafetyLevel` 模型）。
- 配套产物：
  - 类型：`docs/rfc/types/plugin-security.d.ts`
  - Schema：`docs/rfc/schemas/plugin.permissions.schema.json`、`docs/rfc/schemas/plugin.audit-log.schema.json`
  - 图表：`docs/rfc/diagrams/threat-model.mmd`

本 RFC 规定 MyCopilot 插件系统的**安全模型与威胁建模**。它**只是一份协议与威胁模型文档**。它定义了信任边界、一份 STRIDE 威胁清单、权限模型、隔离机制、网络策略、故障传播矩阵、审计日志 schema，以及供应链威胁列表。它**不**实现签名、审计存储或沙箱本身（见"非目标"）。本 RFC 不修改 `apps/` 或 `packages/` 下的任何内容。

## 动机

T4 冻结了插件包格式与其七态生命周期。T5 冻结了七个扩展点，并为每个点钉死了安全分级。两者合起来回答了"插件能声明什么？"与"它在哪运行？"。但二者都没有回答"什么地方会出错，以及宿主强制如何响应？"。

今天每个与插件相关的安全论证都是隐式的。3 级 `SafetyLevel` 模型（`docs/2026-07-11-tool-safety-system-design.md`，在 `apps/server/src/tools/executor.ts:25-29` 与 `:232-234` 处强制）保护的是工具**调用**，但对插件**包**只字未提：一个社区插件可以声明 `permissions.network: true`，窃取聊天内容，挂死 agent 循环，或伪造 `source:"official"` 字段以获取进程内特权。T5 的分级标注（LLM Providers 只能是 Tier 1/2 进程内、Artifact Renderers 即便第一方也必须沙箱）是正确的直觉，但没有成文的威胁模型来支撑它们，没有权限语义，也没有把插件作恶与宿主响应绑定在一起的故障矩阵。

本 RFC 弥合这个缺口。它写下未来实现要被评判的策略，这样后续 RFC 落地的签名、审计、沙箱代码就有一个稳定的契约去满足，而不是在交付压力下临时造一个。

## 目标

- 把**三层信任梯度**（Tier 1 内建完全信任 / Tier 2 官方签名 + 沙箱化 / Tier 3 社区显式同意 + 沙箱化）定义为具体的协议字段，而不仅是文字描述。
- 产出一份**STRIDE 威胁清单**，覆盖全部六类（Spoofing/欺骗、Tampering/篡改、Repudiation/抵赖、Information Disclosure/信息泄露、Denial of Service/拒绝服务、Elevation of Privilege/权限提升），每类都配对一个引用已有宿主机制的缓解措施。
- 规范**权限模型**：详细说明 T4 `permissions` 块每个字段（`tools`、`network`、`filesystem`、`childProcess`、`envVars`）的语义，复用既有 3 级 `SafetyLevel`，不引入并行的另一套体系。
- 规范 Tier 3 插件的**隔离机制**（子进程选型、资源上限、IPC 协议），与决策 A2 保持一致。
- 规范**网络策略**（默认拒绝出站、allowlist + 每次调用确认 vs 作用域缓存），与工具安全确认缓存保持一致。
- 公开一份**故障传播矩阵**，把插件故障模式（崩溃、超时、OOM、权限拒绝）映射到 agent 循环响应。
- 定义**审计日志 schema**，使抵赖在某个未来 RFC 实现存储后即变得不可能。
- 列举**供应链威胁**（篡改、域名仿冒、被遗弃的包），作为未来工作，仅描述不缓解。

## 非目标

以下各项明确属于范围之外，任何声称合规本 RFC 的实现都**不得**引入它们。这里先列出，是为了防止规范部分把它们吸收进去。

- **实现代码签名、签名验证或密钥基础设施。** 本 RFC 规定的是签名方案必须满足的*策略*（Tier 2 插件必须携带可验证签名；社区插件被强制视为 `source:"community"`）。签名算法、密钥分发与轮换是单独的未来 RFC。
- **实现审计日志存储。** 本 RFC 定义审计日志的*记录 schema*以及必须记录的事件。存储后端（SQLite 表、只追加文件、远端 sink）是单独的未来 RFC。
- **实现沙箱运行时。** 本 RFC 规定沙箱必须遵守的*契约*（资源上限、IPC 协议、权限强制）。`worker_threads` / `child_process` 宿主适配器是单独的未来 RFC。
- **假设存在插件市场。** 分发、发现、付费与策展清单不在范围内。本 RFC 假设插件以磁盘目录形式到来；它们怎么到那里是别人的问题。
- **重新发明 3 级安全模型。** `SafetyLevel` 以及 `executor.ts:219-234` 中的 `stricterLevel` / `resolveEffectiveSafetyLevel` 机制是权威的。本 RFC 复用它们，不加任何并行物。
- **超过 5000 字。** 若未来修订需要更多篇幅，则拆分为 `plugin-security-threat-model.md`（本文件）加一份签名交付 RFC。

## 规范

本节覆盖全部八个设计要点。类型位于 `docs/rfc/types/plugin-security.d.ts`；权限与审计 schema 分别位于 `docs/rfc/schemas/plugin.permissions.schema.json` 与 `plugin.audit-log.schema.json`；信任边界与故障传播图位于 `docs/rfc/diagrams/threat-model.mmd`。

### 1. 信任边界（3 层级模型）

决策 A4 定义了三个层级。本 RFC 把每个层级钉死到具体的协议含义，见下表，并在配套图的 `TrustBoundaries` 子图中渲染。

| Tier | `source` 字段 | 执行方式 | 信任假设 | 安装时要求 |
| ------ | ---------------- | ----------- | ------------------ | --------------------- |
| 1 内建（Built-in） | （无，编译进宿主） | 进程内 | 完全信任 | 无——从不走插件协议 |
| 2 官方（Official） | `"official"` | 进程内（T5 LLM Providers、UI Panels）或沙箱化（Artifact Renderers） | 已验证签名 | 覆盖 `plugin.json` + 包摘要的可验证签名 |
| 3 社区（Community） | `"community"` | 子进程沙箱 | 不受信任；每项能力都需要用户显式同意 | 记录在审计日志中的用户显式同意 |

`source` 字段是**唯一**的信任判别器。声明 `source:"official"` 但无法出示对官方身份有效的签名的插件，**必须**在安装时被强制改写为 `source:"community"`，并作为 Spoofing（欺骗）尝试记录到审计日志（合规 C1）。Tier 1 根本不是一个 `source` 取值——内建代码编译进宿主，从不过插件协议边界（继承自 T4）。

### 2. 威胁清单（STRIDE）

六类 STRIDE 及其宿主缓解措施：

- **Spoofing（欺骗）**——插件伪造 `source:"official"` 以获得进程内执行。*缓解：* 只有出示对官方身份有效签名的插件才能保留 `source:"official"`；任何未签名或签名错误的插件都被改写为 `source:"community"` 并审计该事件（C1）。`source` 字段在验证后由宿主控制，而非作者声称。
- **Tampering（篡改）**——插件文件在安装后被修改（磁盘编辑、供应链替换）。*缓解：* 宿主在安装时记录包摘要，并在磁盘摘要不再匹配时拒绝执行。未来签名会覆盖此项；本 RFC 只写策略（每次加载插件**必须**检查摘要），不写签名算法。
- **Repudiation（抵赖）**——插件否认调用过危险工具或联系过外部主机。*缓解：* 审计日志 schema（`plugin.audit-log.schema.json`）为每个权限受控动作记录 `plugin_id`、`event_type`、`timestamp`、`args_digest`、`resource_scope` 与 `outcome`。一旦存储接入，抵赖即不可能。
- **Information Disclosure（信息泄露）**——插件把聊天内容、API key 或文件系统数据外发到外部端点。*缓解：* 默认拒绝出站（规范 5）；`permissions.envVars` allowlist（只有声明的名字对插件可见）；LLM Providers 只能是 Tier 1/2 进程内（T5 ADR-3），所以社区适配器永远看不到每条消息与每个 key。
- **Denial of Service（拒绝服务）**——插件阻塞 agent 循环（死循环、OOM、持锁），派生无限子进程，或淹没 IPC 通道。*缓解：* 性能预算（T4 §10：工具 30s、hook 5s、启动 10s）由 watchdog 强制；LoopGuard v2（`docs/rfc/agent-loop-v2.md`）约束外层循环；子进程沙箱有资源上限（规范 4）。
- **Elevation of Privilege（权限提升）**——插件越出它声明的 `permissions`（例如在 `network:false` 下打开 socket，或读取不在 `envVars` 中的环境变量）。*缓解：* `permissions` 块是上限；运行时**必须**拒绝任何未声明的能力使用，并**必须**把试图升级当作 fail-fast 事件（C4）。权限提升请求永远不被静默授予。

### 3. 权限模型

T4 清单的 `permissions` 块声明这个上限。本 RFC 详述每个字段的运行时语义。该模型为工具调用门禁**复用**既有的 3 级 `SafetyLevel`（`safe` / `restricted` / `danger`），并为非工具资源新增能力上限。

- `permissions.tools`（布尔，默认 false）。为 true 时，插件可通过 Tools 扩展点注册工具执行器。每个注册工具默认为**最低 `restricted`**（与 `executor.ts:224-226` 处对 MCP 工具施加的同一地板一致）；插件**可**声明某工具为 `danger`，但**永远不可**为 `safe`。既有 `stricterLevel` 与 `resolveEffectiveSafetyLevel` 路径（`executor.ts:219-234`）保持不变。
- `permissions.network`（布尔，默认 false）。为 true 时，插件**只能**对其声明的 allowlist 中的域名打开出站 socket（见规范 5）。为 false 时，任何 socket 调用**必须**被阻断并审计为一次升级尝试。
- `permissions.filesystem`（`{read:[], write:[]}`，默认为空）。Glob 模式相对于插件沙箱（`$PLUGINS_DIR/<plugin_id>/`）解释。一条解析到沙箱之外的路径（在符号链接解析之后）**必须**被拒绝，视为一次穿越尝试。
- `permissions.childProcess`（布尔，默认 false）。为 true 时，插件可在其沙箱内派生子进程。对进程外运行的 Tier 3 插件而言这是隐含的（宿主自己派生了插件）；但仍然要声明，以便审计。
- `permissions.envVars`（名字数组，默认为空）。只有列出的环境变量名字对插件进程可见。`AUTH_TOKEN` 与任何 LLM API key **必须永远不**出现在任何插件的 allowlist 中；否则宿主拒绝该清单（C3）。

一个试图使用其 `permissions` 块之外能力的插件，已发起一次**权限提升请求**。宿主响应是固定的：拒绝该调用，发出一条 `event_type:"privilege_escalation"` 的审计事件，在会话剩余时间内禁用该插件，并通知用户（C4）。

### 4. 隔离机制（决策 A2）

Tier 3 插件运行在子进程沙箱中；Tier 2 官方插件运行在进程内（Artifact Renderers 例外，按 T5 始终沙箱化）。沙箱契约：

- **进程模型。** 每个启用的 Tier 3 插件一个子进程，在会话开始时派生（与 T4 拒绝热更新一致：状态在开始时解析并保持不变）。`worker_threads` 与 `child_process` 的选型见 ADR-1。
- **资源上限。** 每个沙箱有一个内存上限（默认 256 MiB）、一个由 watchdog 强制的 CPU 时间上限，以及一个打开文件描述符上限。任何上限被触发都走故障传播矩阵对应的行（规范 6）。
- **IPC 协议。** JSON-RPC 2.0 走子进程的 stdout/stderr，按行帧化，一行一条消息。这与既已支持的 **MCP stdio 传输**（`apps/server/src/mcp/transport-factory.ts`）一致，因此同一帧化层同时服务于插件 IPC 与 MCP。插件代码从不直接碰宿主的 SQLite 句柄、网络栈或文件系统；每个有副作用的调用都是一个由宿主做权限检查的 IPC 请求。

### 5. 网络策略

出站**默认拒绝**。一个 `permissions.network:true` 的插件**必须**声明域名 allowlist；任何不在 allowlist 中的主机的连接都被阻断并审计。allowlist 匹配的是**解析后**的来源（在重定向之后），而非仅请求的 URL，以挫败基于重定向的外发。

每次调用确认复用工具安全确认缓存（`docs/2026-07-11-tool-safety-system-design.md` §2）：缓存 key 为 `sessionId + agentId + toolRef + policyVersion + resourceScope`，其中一次网络调用的 `resourceScope` 是规范化来源。一个联系已确认来源的 `restricted` 插件工具在会话内不会再次提示；一个 `danger` 工具每次都提示。关于为何选择默认拒绝而非"默认允许 + 提示"，见 ADR-2。

### 6. 故障传播矩阵

插件故障模式到 agent 循环响应的映射如下。宿主**必须**遵守该矩阵；临时性恢复是不合规的。

| 故障模式 | 检测 | Agent 循环响应 | 插件状态 |
| -------------- | ----------- | --------------------- | -------------- |
| 子进程崩溃 | IPC 关闭 / 非零退出 | 工具调用返回 `isError`；除非是 fail-fast hook，运行继续 | 该会话禁用 |
| 工具调用超时（>30s） | Watchdog | 工具调用返回 `isError`；运行继续 | 保持启用 |
| 生命周期 hook 超时（>5s） | Watchdog | 运行以 `status:"aborted"` 中止（fail-fast，T5 ADR-2），除非 `failMode:"continue"` | 该会话禁用 |
| OOM（内存上限超出） | 沙箱监视器 | 子进程被杀死；运行带着 `isError` 工具结果继续 | 该会话禁用 |
| 权限拒绝（升级） | 调用前检查 | 调用被拒绝；审计事件发出；用户被通知 | 该会话禁用 |
| 无界输出（IPC 洪水） | 每响应字节预算 | 响应被截断；运行继续 | 保持启用，给予警告 |

该矩阵在配套图的 `FailurePropagation` 子图中渲染。

### 7. 审计日志

审计日志 schema（`plugin.audit-log.schema.json`）是反抵赖原语。每条记录携带：`event_id`、`plugin_id`、`event_type`、`timestamp`、`args_digest`（稳定序列化参数的 SHA-256 十六进制）、`resource_scope`（规范化路径或来源）、`outcome`（`success` / `denied` / `error` / `privilege_escalation`），以及可选的 `error_code`。`event_type` 取值集合在 schema 中枚举，并在 `.d.ts` 中镜像。本 RFC 只定义 schema；存储是非目标。

### 8. 供应链威胁（未来工作）

以下各项被描述但**未**被本 RFC 缓解；它们出现在这里，以便某份未来的签名交付 RFC 有一份检查清单。

- **传输中篡改。** 在策略上由安装时摘要检查缓解（见上文 Tampering/篡改）；端到端签名是未来工作。
- **域名仿冒（Typosquatting）。** 一个名为 `acme-toolz` 的插件仿冒 `acme-tools`。命名空间规则（`pluginId:resourceName`，T4）防止名字冲突，但不能防止用户混淆；未来市场**可**做策展。
- **被遗弃的包。** 一个曾经签名、但密钥后来泄露或作者停止修补的插件。在出现吊销机制之前不在范围内。

## 威胁模型

本节以 STRIDE 形式陈述威胁模型，并与上文缓解措施交叉引用。该模型假设一个**有能力但并非全能**的对手：对手控制其交付的插件包内容，但不控制宿主进程、官方签名密钥，或 `$PLUGINS_DIR` 之外的用户文件系统。

- **Spoofing（S，欺骗）：** 对手在缺少签名的情况下发布 `source:"official"`。由 C1 覆盖（强制改写为 `community` + 审计）。
- **Tampering（T，篡改）：** 对手在安装后修改磁盘字节。由摘要检查策略覆盖；未来签名将补全。
- **Repudiation（R，抵赖）：** 插件作者声称其代码从未调用外发端点。由审计日志 schema 覆盖；未来存储将闭合该缺口。
- **Information Disclosure（I，信息泄露）：** 插件读取聊天内容或 key 并外发。由默认拒绝出站、`envVars` allowlist，以及"LLM Providers 仅 Tier 1/2"规则（T5 C3）覆盖。
- **Denial of Service（D，拒绝服务）：** 插件挂死循环或耗尽内存。由性能预算、LoopGuard v2 与沙箱资源上限覆盖。
- **Elevation of Privilege（E，权限提升）：** 插件使用未声明的能力。由权限上限与 fail-fast 升级响应（C4）覆盖。

## 信任边界

三条信任边界，重述为数据流事实（在图中渲染）：

1. **宿主信任边界**（Tier 1）。内建代码、agent 循环、SSE 流、SQLite 句柄以及每个 API key 都位于此处。本 RFC 不削弱该边界。
2. **已签名插件信任边界**（Tier 2）。通过签名验证的官方插件运行在进程内（Artifact Renderers 例外，始终沙箱化）。它们看到与内建相同的数据，因此签名密钥即是关卡。
3. **沙箱信任边界**（Tier 3）。社区插件，以及任何验证失败的官方插件，运行在子进程沙箱中。它们只通过 JSON-RPC IPC 通信，且只能触及其 `permissions` 块声明的资源。

## 缓解措施

缓解措施已并入上文的规范部分，此处不再重复。下表为评审者索引它们。

| STRIDE 类别 | 主要缓解 | 合规条款 | 复用的宿主机制 |
| ----------------- | -------------------- | -------------------- | ----------------------- |
| Spoofing（欺骗） | 强制 `source` 改写 | C1 | 安装时验证 hook（未来） |
| Tampering（篡改） | 安装时摘要检查 | C2 | 安装记录（T4） |
| Repudiation（抵赖） | 审计日志 schema | C5 | 新 schema（本 RFC） |
| Information Disclosure（信息泄露） | 默认拒绝出站 + `envVars` allowlist + LLM Providers 分级 | C3, C6 | `permissions` 块（T4）、T5 ADR-3 |
| DoS（拒绝服务） | 性能预算 + 资源上限 + LoopGuard v2 | C7 | T4 §10 预算、`agent-loop-v2.md` LoopGuard |
| Elevation of Privilege（权限提升） | 权限上限 + fail-fast 升级 | C4 | `stricterLevel` / `resolveEffectiveSafetyLevel`（`executor.ts:219-234`） |

## 迁移

迁移是叠加式、分阶段的；每个阶段独立可回滚，且没有任何阶段修改既有持久化行。

1. **阶段 0——交付契约。** 落地 `.d.ts`、两份 schema、该图与本 RFC。无运行时行为变化。
2. **阶段 1——安装时权限强制。** 安装器读取 `permissions`，拒绝禁止组合（例如 `envVars` 含 `AUTH_TOKEN`），并记录包摘要。尚无运行时门禁。
3. **阶段 2——运行时权限检查。** 工具、网络、文件系统与环境访问路径在执行前查询插件的 `permissions` 上限。升级尝试写入审计日志。
4. **阶段 3——沙箱适配器。** `worker_threads` 宿主适配器落地；Tier 3 插件搬到进程外。进程内的 Tier 2 插件不受影响。
5. **阶段 4——审计存储。** 未来 RFC 把审计日志 schema 接到一张 SQLite 表上；在那之前，记录被输出到结构化日志。

## 反例

### 反例：在本 RFC 中实现代码签名

挑一种签名方案（Ed25519 配一个独立 SIG 文件，密钥通过 `trusted_keys.json` 钉死）并在此指定，让整个安全故事一次性落地一份文档——这很诱人。但这是个错误的切分。签名涉及密钥分发、轮换、吊销，以及未来市场的策展 allowlist；把它拉进一份威胁模型 RFC，要么会把它写得不够（无用），要么会让本文档超出预算而膨胀。本 RFC 只钉死签名方案必须满足的**策略**（Tier 2 插件**必须**出示可验证签名；未签名插件**必须**被视为 Tier 3），把密码学机制留给一份签名交付 RFC。策略是稳定的；密码学可以演进而无需重开威胁模型。

### 反例：为性能让 Tier 3 插件运行在进程内

一个运行在进程内的社区插件避免了 IPC 往返，启动也更快。但它也运行在宿主信任边界内——那里只要漏掉一次权限检查就会暴露每个 API key 与 SQLite 句柄。性能收益可度量但很小（亚毫秒级 IPC），而安全损失是彻底的。决策 A2 之所以为 Tier 3 选择子进程隔离，正是为了让信任边界由操作系统强制，而不是靠宿主的自律。允许一个进程内的逃生阀，会把 3 层模型坍缩成 2 层模型，并为不受信任的那层留一条快通道。

## 架构决策记录

### 决策 (ADR-1：Tier 3 沙箱选择 `worker_threads` 而非 `child_process`)

**背景。** Tier 3 插件需要进程隔离（决策 A2）。Node 提供两种隔离原语：`worker_threads`（独立 V8 isolate、共享进程）与 `child_process`（独立 OS 进程）。

**选项。** (a) `worker_threads`。(b) `child_process`（例如 Node 的 `fork`）。(c) 一个 WASM 运行时。(d) 每个插件一个容器。

**决策。** (a) `worker_threads`。它提供独立的 V8 isolate（插件因此无法触达宿主的模块图或全局），同时保持 IPC 廉价（进程内 `MessagePort`，无 socket 开销）与启动快速（无新 Node 进程）。

**替代方案。** (b) 给出更强的 OS 级边界（独立的文件描述符表、独立的信号处置），但每个插件都要付出一次完整 Node 启动，并让 `AUTH_TOKEN` 隔离更复杂。(c) 要求把插件重写为 WASM 兼容子集，丢失生态兼容性。(d) 是最强边界，但部署繁重，且假设了一个宿主无法要求的容器运行时。对一个桌面可自托管的产品而言，`worker_threads` 是正确的权衡；强化部署**可**在不修改本 RFC 契约的前提下，把 (d) 叠加在上面。

### 决策 (ADR-2：默认拒绝出站，而非"默认允许 + 提示")

**背景。** 拥有 `permissions.network:true` 的插件需要联系外部主机。宿主要么允许任何主机并在首次使用时提示，要么拒绝任何不在声明 allowlist 中的主机。

**选项。** (a) 默认拒绝 + 清单声明的 allowlist。(b) 默认允许 + 每来源提示。(c) 对非私有 IP 段默认允许（仅 SSRF 过滤）。

**决策。** (a)。清单**必须**声明它要联系的主机；任何不在列表中的主机都被阻断并审计。

**理由。** "默认允许 + 提示"训练用户去点"是"（提示疲劳），一旦用户停止阅读提示，一个被攻陷的插件就能立刻联系一个新主机。默认拒绝让 allowlist 成为评审产物：评审者（用户，或未来市场）在安装前就能确切看到插件打算和哪些主机通信。allowlist 也挫败基于重定向的外发，因为检查针对的是解析后的来源。这与工具安全原则一致——`restricted` 按 `resourceScope`（规范化来源）缓存确认，而非按工具名缓存。

**替代方案。** (b) 更灵活但更弱；一旦用户批准了插件，每个新主机都只差一次提示。(c) 只阻断 SSRF，对发往公网攻击者控制主机的数据外发毫无作用。

### 决策 (ADR-3：`permissions` 是调用前强制的上限，而非提示)

**背景。** `permissions` 块声明插件打算做什么。宿主既可把它当作提示（不匹配则记录日志），也可当作硬上限（不匹配则拒绝）。

**选项。** (a) 硬上限：任何未声明的能力使用都在调用前被拒绝。(b) 提示：声明的能力优先，但未声明的使用被允许并记录。(c) 每能力一策略。

**决策。** (a)。试图使用未声明的能力，即一次权限提升尝试：调用被拒绝，事件以 `privilege_escalation` 审计，插件在该会话中被禁用（C4）。

**理由。** 提示式模型让清单沦为装饰；对手只需省略声明即可继续。硬上限让清单成为安全契约：评审 `permissions` 块即评审了插件的可触达范围。

**替代方案。** (b) 严格更弱，仅对遥测有用。(c) 在无收益的情况下成倍扩大策略面——上限已覆盖每项能力，且升级响应是统一的。

## 合规性

一个实现当且仅当以下全部成立时合规本 RFC：

- 合规实现**必须**把任何声明 `source:"official"` 但无法由可验证签名背书的插件视为 `source:"community"`，相应地改写内存中的清单，并在审计日志中把该事件记为一次 Spoofing（欺骗）尝试（C1）。
- 合规实现**必须**在安装时记录包摘要，并**必须**拒绝加载磁盘摘要不再匹配的插件，发出一条 Tampering（篡改）审计事件（C2）。
- 合规实现**必须**拒绝任何 `permissions.envVars` allowlist 含 `AUTH_TOKEN` 或任何匹配已配置 LLM API-key 环境变量名的清单（C3）。
- 合规实现**必须**拒绝任何使用其 `permissions` 块未声明能力的插件调用，以 `event_type:"privilege_escalation"` 审计该事件，在会话剩余时间内禁用该插件，并通知用户（C4）。
- 合规实现**必须**为每个权限受控动作（需要确认的工具调用、网络出站、文件系统写入、子进程派生、权限拒绝与权限提升尝试）发出一条符合 `plugin.audit-log.schema.json` 的审计日志记录（C5）。
- 合规实现**必须**对每个插件强制默认拒绝的网络出站，只允许到插件声明 allowlist 中来源的出站连接，并在重定向之后检查解析后的来源（C6）。
- 合规实现**必须**强制性能预算（工具调用 30 s、生命周期 hook 5 s、启动 10 s）与沙箱资源上限（内存、CPU、fd），把每次违规都通过故障传播矩阵处理，而非静默重试（C7）。

## 开放问题

1. **签名密钥分发。** 官方签名密钥如何分发、轮换与吊销，推迟到一份签名交付 RFC；本 RFC 只陈述它们必须满足的策略。
2. **审计存储后端。** 审计日志究竟是一张 SQLite 表、一个只追加文件，还是一个远端 sink，推迟决定；此处的 schema 与存储无关。
3. **沙箱逃逸上报。** `worker_threads` 终止（未捕获异常）是作为崩溃报告呈现给用户，还是仅作为"禁用插件"呈现，是实现细节，留给沙箱适配器 RFC。
4. **Allowlist 模式语法。** 网络 allowlist 是否支持通配符（`*.example.com`），还是仅精确主机名，留给实现；本 RFC 只要求匹配针对解析后的来源。
5. **吊销。** 针对被攻陷插件的吊销通道（类比 CRL/OCSP）在市场存在之前不在范围内。

## 参考文献

- `docs/2026-07-11-tool-safety-system-design.md`——权威的 3 级 `SafetyLevel` 模型，以及本 RFC 复用的 `PendingToolApproval`、`ConfirmationCacheKey` 与 `ToolRef` 定义。
- `apps/server/src/tools/executor.ts:25-29`——`STRICTNESS` 映射；`:219-230`——`resolveEffectiveSafetyLevel`；`:232-234`——`stricterLevel`。
- `apps/server/src/mcp/transport-factory.ts:12-24`——为插件 IPC 帧化复用的 stdio 传输。
- `docs/rfc/_architecture-decisions.md`——A2（Tier 3 子进程隔离）、A4（3 层模型）、A5（`plugin_data` 存储）。
- `docs/rfc/plugin-manifest-lifecycle.md`——T4 清单 `permissions` 字段、生命周期语义、热更新拒绝、性能预算。
- `docs/rfc/plugin-extension-points.md`——T5 每个扩展点的安全分级（LLM Providers 仅 Tier 1/2；Artifact Renderers 始终沙箱化；Lifecycle Hooks 默认 fail-fast）。
- `docs/rfc/schemas/plugin.manifest.schema.json`——本 RFC 详述的 T4 `PluginPermissions` 与 `FilesystemPermissions` 定义。
- `docs/rfc/agent-loop-v2.md`——LoopGuard v2（DoS 缓解的外层循环）。
- `docs/rfc/types/plugin-security.d.ts`——安全相关类型定义。
- `docs/rfc/schemas/plugin.permissions.schema.json`、`docs/rfc/schemas/plugin.audit-log.schema.json`——两份 schema。
- `docs/rfc/diagrams/threat-model.mmd`——信任边界与故障传播图。
