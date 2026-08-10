# 插件清单与生命周期（Plugin Manifest & Lifecycle）

> 状态：**提案（Proposal）** · 负责人：server/plugin · 依赖：架构决策
> A1（插件概念）、A2（执行边界）、A4（三层模型）、A5（状态归属）
> 范围：定义 MyCopilot 插件的包格式、清单 schema、生命周期状态机、
> 分层模型、命名空间规则和性能预算。本 RFC **不**规定插件市场（marketplace）、
> 注册中心（registry）、支付或签名验证的实现。

## 动机

MyCopilot 当前提供了三个独立演进的扩展面：

- **Skills** —— 从磁盘（`skills/`）加载的 Markdown 知识块，作为 prompt 上下文提供给 LLM。
- **Tools** —— 在 `apps/server/src/tools/registry.ts` 中注册的内置执行器，以及持久化在 `mcps` 表中的 MCP 服务。
- **MCP** —— 仅支持 stdio 的服务（`apps/server/src/mcp/transport-factory.ts:12-24`），其工具是临时的，每次连接时重新列举（`apps/server/src/mcp/manager.ts:10-11`）。

每个扩展面都有自己的发现、存储和生命周期。一个想要"带自定义卡片 UI 和私有工具的代码评审"的用户，必须连接三个互不相关的配置界面，没有共享的版本、依赖或权限机制。决策 A1 确定了方向：插件（Plugin）是**完整的可分发扩展单元** —— 一个高层的打包 + 生命周期 + 分发层，可以把上述任意能力组合打包在一起，而不替换独立扩展面（向后兼容是强制要求）。

本 RFC 规定每个插件包必须满足的契约：磁盘布局、`plugin.json` 清单、七态生命周期、三层信任模型、防止冲突的命名空间规则，以及防止行为失常的插件拖垮宿主的性能边界。它刻意将插件市场、支付、账户体系和实际签名验证实现排除在范围之外（见非目标，以及与未来 T6 威胁模型 RFC 的交叉引用）。

## 目标

- 定义**插件包结构**（目录布局、必需文件），使任何合规插件都能被宿主解包、校验和加载，而无需针对每个插件编写临时逻辑。
- 将 **`plugin.json` 清单**规定为 draft-07 JSON Schema，包含九个必需字段，通过 `allOf` / `oneOf` / `$ref` 组合在一个自包含的 `$defs` 块之上。
- 规定**七态生命周期状态机**以及记录每次状态转换的事件日志，包括触发器、副作用和可逆性。
- 将决策 A4 中的**三层模型**（内置 / 一方 `source:"official"` / 社区 `source:"community"`）落实到具体的生命周期差异（默认安装、禁用 vs 卸载）。
- 规定决策 A5 中的**状态归属**层：`plugin_data(plugin_id, key, value, created_at, updated_at)` SQLite 表、公开的 `plugin.store` API，以及可选的文件系统白名单。
- 定义**命名空间规则**，使每个插件注册的资源（tool / MCP / context-provider）都以 `pluginId:resourceName` 寻址，冲突时显式失败而非静默遮蔽。
- 阐明**热更新策略**（被拒绝 —— 需要重启）、**失败传播**规则（工具调用可恢复、生命周期钩子 fail-fast），以及**性能预算**（工具调用 30s、钩子 5s、启动 10s）。

## 非目标

以下内容明确不在范围内，任何声称符合本 RFC 的实现**不得**引入：

- **插件市场 / 注册中心 / 支付 / 账户体系。** 本 RFC 仅定义包格式和生命周期。发现来源、浏览、评分、付费插件和用户账户推迟到单独的 RFC。
- **签名验证实现。** 清单携带一个摘要字段，威胁模型 RFC（T6）将为其定义验证方式。本 RFC 仅引用验证在生命周期中的接入点（`verified` 状态）。它不强制规定签名算法、密钥分发或吊销通道。
- **假定某个 LLM 供应商。** 本 RFC 的任何内容都不依赖 OpenAI/Anthropic/本地特定细节。插件的工具和 skills 会被通告给宿主当前配置的任何供应商。
- **会话内热更新。** 正在运行的会话不受插件状态变化影响；新状态在下一次会话启动时生效。见 ADR-3。
- **替换独立的 Skill / MCP / Tool。** 向后兼容是强制要求（A1）。现有的独立扩展面保持一等公民地位；插件是它们之上的可选打包层。
- **Tier 3 进程内执行。** 社区插件在进程外运行（A2）。将 `source:"community"` 插件加载到进程内违反本 RFC（见反例：为何不允许 Tier 3 进程内运行）。

## 规范

### 1. 插件概念定位（决策 A1）

**插件（Plugin）** 是完整的可分发扩展单元 —— 不是与 Skill / MCP / Tool 并列的第四种原语，也不是薄包装。它是一个高层的打包 + 生命周期 + 分发层，可以在其 `provides` 块中声明任意能力组合。

**插件类型系统。** 清单携带一个可选的 `type` 字段，声明插件的主要用途。当前的生产类型是 `frontend-response`（让 agent 响应可扩展：卡片、组件、iframe 渲染器）。未来类型构成一个开放枚举，宿主将其视为前向兼容：

- `frontend-response`（主要，当前）
- `backend-tool-only`
- `llm-adapter`
- `storage-provider`
- `mcp-server-only`
- `agent-preset`

未知类型不是加载错误 —— 宿主将插件作为不透明对象安装，但仍然应用所有权限、命名空间和生命周期规则。类型仅影响 UI 分类和（未来市场中）路由；它不放宽任何合规条款。

**能力块。** 插件通过 `provides` 声明其贡献，其中**可以**包含以下任意项：`mcpServers`、`skills`、`rules`、`frontendEntry`、`contextProviders`、`memoryBackends`。至少一个**必须**非空（JSON Schema 通过对非空数组或存在的 `frontendEntry` 使用 `oneOf` 来强制此要求）。

**向后兼容性。** 现有的独立 Skills（从 `SKILLS_DIR` 加载）和 MCP 服务（`mcps` 表中的行）保持不变地工作。它们不会被自动包装为插件；插件纯粹是一个附加打包层。独立 MCP 和插件打包的 MCP 使用相同的 `apps/server/src/mcp/manager.ts` 代码路径；只是生命周期所有者不同。

### 2. 插件包结构

插件是一个目录，其根目录包含 `plugin.json` 和少量可选的能力子目录。该布局借鉴 Cursor 的 `.cursor-plugin/plugin.json` 约定，并适配 MyCopilot 的扁平模块风格。

```text
acme-tools/
├── plugin.json            # 清单（必需，schema 校验）
├── skills/                # skill markdown 文件（可选）
│   └── code-review.md
├── mcp.json               # MCP 服务配置（可选，镜像 McpConfig）
├── rules/                 # 确定性策略文本（可选）
│   └── no-pii.md
├── frontend/              # 用于 iframe 沙箱的前端打包产物（可选）
│   ├── index.html
│   └── assets/
├── README.md              # 人类可读文档（推荐）
└── LICENSE                # 纯文本许可证（推荐）
```

`plugin.json` 是唯一严格要求的文件。所有其他路径都在清单的 `provides` 块中声明，并对照 schema 校验（路径必须匹配 `skills/*.md`、`rules/*.(md|txt)` 或 `frontend/index.html`）。宿主从不扫描任意子目录 —— `provides` 中未声明的一切对运行时不可见。

### 3. `plugin.json` Schema

清单由 `docs/rfc/schemas/plugin.manifest.schema.json` 校验（draft-07、自包含、在 `$defs` 之上使用 `allOf` / `oneOf` / `$ref`）。九个字段是必需的：

1. `name` —— 小写 kebab-case id，跨版本稳定。
2. `version` —— SemVer 2.0.0。
3. `description` —— 单行人类可读摘要。
4. `author` —— `{name, email?, url?}`。
5. `license` —— SPDX 标识符（`MIT`、`Apache-2.0`、…）。
6. `engineCompatibility` —— 针对宿主的 `{minVersion, maxVersion?}`。
7. `source` —— `"official"` 或 `"community"`（决策 A4）。
8. `permissions` —— 最小权限能力声明。
9. `provides` —— 非空能力块（见 §1）。

可选字段：`homepage`、`icon`、`keywords`、`dependencies`、`lifecycleHooks`、`type`。

```json
{
  "name": "acme-tools",
  "version": "1.2.0",
  "description": "Acme code review + private HTTP tool",
  "author": { "name": "Acme", "url": "https://acme.example" },
  "license": "Apache-2.0",
  "engineCompatibility": { "minVersion": "0.4.0" },
  "source": "community",
  "permissions": {
    "tools": true,
    "network": true,
    "filesystem": { "read": ["cache/*"], "write": ["cache/*"] },
    "childProcess": false,
    "envVars": ["ACME_API_KEY"]
  },
  "provides": {
    "mcpServers": [{ "id": "acme-mcp", "transport": "stdio", "command": "node", "args": ["mcp.js"] }],
    "skills": [{ "path": "skills/code-review.md" }],
    "rules": [{ "path": "rules/no-pii.md" }]
  },
  "dependencies": [{ "name": "acme-core", "versionRange": "^1.0.0" }],
  "lifecycleHooks": { "onInstall": { "command": "node setup.js", "timeoutMs": 5000 } },
  "type": "frontend-response"
}
```

TypeScript 镜像位于 `docs/rfc/types/plugin-manifest.d.ts`（自包含、全部 `export`、无外部导入）。

### 4. 生命周期状态机

每个插件经历七个状态。每次转换记录为一个 `PluginLifecycleEvent`（见 `docs/rfc/schemas/plugin.lifecycle-event.schema.json`）。状态机也渲染在 `docs/rfc/diagrams/plugin-lifecycle.mmd`（子图 `SM`）中。

| 状态 | 触发器 | 副作用 | 可逆 |
| --- | --- | --- | --- |
| `discovered` | registry 扫描 / 导入 / 安装请求 | 在 `plugins` 表中插入一行 | 是（重新扫描） |
| `downloaded` | 用户或系统安装 | 磁盘上 `$PLUGINS_DIR/<id>/` 下的字节 | 是（清除） |
| `verified` | 下载后检查（摘要 + 引擎匹配） | 摘要记录在事件 payload 中 | 是（重新验证） |
| `installed` | verified + `engineCompatibility` OK | 能力已注册（已命名空间化） | 是（卸载） |
| `enabled` | `onEnable` 钩子返回 ok | MCP 服务已连接、工具已上线、前端可挂载 | 是（禁用） |
| `disabled` | 用户请求或可恢复故障 | 资源已销毁、清单保留 | 是（重新启用） |
| `uninstalled` | 用户显式操作 | `plugin_data` 行 + 沙箱目录被清除 | **否**（终态） |

转换图为：`discovered → downloaded → verified → installed → enabled ↔ disabled → uninstalled`。Tier 2 官方插件直接从 `installed → disabled`，**不能**到达 `uninstalled`（见 §5）。

### 5. 三层模型（决策 A4）

| 层级 | 来源 | 安装 | 禁用 | 卸载 | 执行 |
| --- | --- | --- | --- | --- | --- |
| 1 —— 内置 | 编译进宿主 | 不适用 | 不适用 | 不适用 | 进程内，完全信任 |
| 2 —— 一方 | `source:"official"` | 默认、自动 | 是 | **否** | 进程内 |
| 3 —— 社区 | `source:"community"` | 用户显式 | 是 | 是 | 子进程 |

Tier 1（内置）**不是**插件 —— 它是宿主本身（`apps/server/src/tools/` 中的七个内置工具、stdio MCP 传输等）。它从不走插件协议，也没有 `plugin.json`。Tier 2 插件是一方的：由项目发布、默认安装、可以禁用但不能卸载，这样宿主始终保持一个已知良好的基线。Tier 3 插件由用户安装，走完整生命周期，包括卸载。

`source` 字段是唯一的权威判别器。宿主在安装时读取一次，并路由到正确的执行环境（A2）：Tier 1 和 Tier 2 进程内，Tier 3 子进程（`worker_threads` 或 `child_process`）。远程插件是可选的未来兼容层（MCP HTTP 服务），此处不规定。

### 6. 状态归属（决策 A5）

插件通过单个 SQLite 表持久化状态，只能通过公开 API 访问。任何插件都不直接写 SQL。

```sql
CREATE TABLE IF NOT EXISTS plugin_data (
  plugin_id  TEXT NOT NULL,
  key        TEXT NOT NULL,
  value      TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_plugin_data_id_key ON plugin_data(plugin_id, key);
```

这遵循仓库约定（`repo/summary.ts`、`repo/message.ts`）：每个单元一行、扁平模块、无 `services/` 层。新的 `repo/plugin-data.ts` 负责它。

**公开 API。** 每个已启用的插件收到一个 `plugin.store` 对象，其读写按调用插件的 id 自动加作用域：

```typescript
plugin.store.get<T>(key: string): Promise<T | undefined>;
plugin.store.set<T>(key: string, value: T): Promise<void>;
plugin.store.delete(key: string): Promise<void>;
plugin.store.list(): Promise<string[]>;
```

插件不能读写其他插件的 key —— `plugin_id` 过滤器在服务端应用，而非由调用者应用。TypeScript 形状是 `docs/rfc/types/plugin-manifest.d.ts` 中的 `PluginStore`。

**可选文件系统。** 需要文件（模型权重、缓存）的插件将 `permissions.filesystem.write` 声明为 glob 白名单。所有路径都相对于 `$PLUGINS_DIR/<plugin_id>/` 解释；路径穿越（`..`）会被拒绝。卸载会清除整个沙箱目录。

### 7. 命名空间规则

插件注册的每个资源 —— 工具、MCP 服务、context provider、memory backend —— 在外部都以 `pluginId:resourceName` 寻址。这种强前缀防止冲突，并使来源在 UI 中可审计。

在内部，现有的唯一索引 `idx_tools_name_type_source ON tools(name, type, COALESCE(source_mcp_id, ''))`（迁移 0003）已经将 MCP 提供的工具与内置工具分开。插件层增加一个判别器：`source_mcp_id`（或新的 `source_plugin_id`）携带插件 id，因此两个插件都可以各自发布名为 `search` 的工具而不互相遮蔽。

**冲突解决。** 如果两个已启用的插件（或一个插件和一个内置）注册相同的全限定名，宿主以 `errorCode: "namespace_conflict"` 拒绝第二次注册，并向用户展示冲突。禁止静默遮蔽。推荐的解决方案是用户禁用其中一个冲突插件；宿主从不自动重命名。

### 8. 热更新策略

会话内热更新被**拒绝**。插件的启用/禁用状态、已注册工具和 MCP 连接在**会话启动时**解析，并在该会话的生命周期内保持不变。安装、启用、禁用或卸载插件只影响转换完成**之后**启动的会话。

这有意简化了语义：agent 循环、组装的上下文和前端不需要处理运行中途出现的工具消失或出现。代价是用户必须启动新会话（或重启宿主）才能获取变更 —— 对于自托管产品，这是一个可接受的权衡，并且它消除了整类竞态条件（见 ADR-3）。

### 9. 失败传播

两种失败模式按可恢复性区分：

- **工具调用失败（可恢复）。** 插件提供的工具抛出异常、超时或返回 `isError: true` 时，作为失败的工具结果报告给 agent 循环。agent 可以重试、选择另一个工具，或向用户展示错误。插件保持启用。默认 30s 超时（`apps/server/src/mcp/manager.ts:26` 已对 MCP 强制此值）即契约。
- **生命周期钩子失败（fail-fast）。** `onInstall`、`onEnable` 或 `onUninstall` 出错或超过 5s 预算时**会导致转换失败**。插件被移至 `disabled`（对于 `onEnable`）或安装被回滚（对于 `onInstall`）。fail-fast 防止半安装的插件累积。

Tier 3 子进程中的内存溢出和进程崩溃被宿主视为下一次调用时的工具调用失败；子进程按需惰性重启，镜像现有的 MCP"不主动重连"策略（`apps/server/src/mcp/manager.ts:11`）。

### 10. 性能预算

| 操作 | 默认超时 | 覆盖 |
| --- | --- | --- |
| 工具调用 | 30000 ms | 每次调用 `timeoutMs`（已在 `manager.ts` 中） |
| 生命周期钩子（`onInstall` / `onEnable` / `onUninstall`） | 5000 ms | 清单中每钩子 `timeoutMs` |
| 插件启动（初始注册遍） | 10000 ms | 宿主配置 |

这些默认值编码为 `docs/rfc/types/plugin-manifest.d.ts` 中的 `DEFAULT_PLUGIN_BUDGET`。需要更多时间完成合法设置步骤（编译语法、索引语料库）的插件**必须**在 `lifecycleHooks.<hook>.timeoutMs` 中显式声明 —— 宿主拒绝要求单个钩子超过 30000 ms 的清单。

## 概念映射（现有 → 插件）

| 现有扩展面 | 插件关系 |
| --- | --- |
| `SKILLS_DIR` 下的 Skill 文件 | 不变。插件的 `provides.skills` 通过同一加载器添加**更多** skills；独立 skills 不被包装。 |
| `mcps` 表中的 MCP 服务行 | 运行时不变。插件的 `provides.mcpServers` 注册相同的 `McpConfig` 形状；宿主用 `source_plugin_id` 标记它以便卸载清理。工具保持临时（`manager.ts:10-11`）。 |
| `apps/server/src/tools/` 中的内置工具 | 不变。插件的 `permissions.tools: true` + `provides` **可以**通过同一 `ToolExecutor` 接口添加插件作用域的工具；它们以 `pluginId:toolName` 命名空间化。 |
| 工具安全等级（safe/restricted/danger） | 不变且继承。插件工具默认 `restricted`，MCP 提供的插件工具通过现有 `stricterLevel` 规则（`executor.ts:232-234`）被钳制到至少 `restricted`。 |
| 前端 Zustand stores | 不变。插件的 `frontendEntry` 在 iframe+CSP 沙箱（A2）中运行，并通过 `postMessage` 通信；它从不直接导入宿主 stores。 |

## 合规性

当且仅当以下所有条件成立时，实现符合本 RFC：

- 合规实现**必须**拒绝任何未通过 `docs/rfc/schemas/plugin.manifest.schema.json` 校验的 `plugin.json`，包括要求恰好一个 `provides` 块非空（C1）。
- 合规实现**必须**以 `pluginId:resourceName` 对外寻址每个插件注册的资源，并以 `errorCode: "namespace_conflict"` 拒绝重复全限定名的注册，而不是静默遮蔽（C2）。
- 合规实现**必须**在存储层按调用插件的 id 对每个 `plugin.store` 读写加作用域，从不信任调用者提供的 id（C3）。
- 合规实现**必须**在进程外（子进程或 worker 线程）执行每个 Tier 3（`source:"community"`）插件，且**不得**将社区插件代码加载到宿主进程中（C4）。
- 合规实现**必须**将生命周期钩子失败视为 fail-fast：`onInstall` 失败回滚安装，`onEnable` 失败将插件移至 `disabled`，`onUninstall` 失败被记录但不阻塞终态 `uninstalled` 转换（C5）。
- 合规实现**不得**将插件状态变更（安装/启用/禁用/卸载）应用到已经运行的会话；变更在下一次会话启动时生效（C6）。
- 合规实现**必须**为每次状态转换记录一行 `PluginLifecycleEvent`，填充 `fromState`、`toState`、`trigger` 和 `result`，匹配 `docs/rfc/schemas/plugin.lifecycle-event.schema.json`（C7）。

## 反例

### 反例：为何不直接用 npm 作为插件格式

把插件作为 npm 包发布并复用 `package.json`、semver 解析和 npm registry 很诱人。本 RFC 基于四个理由拒绝它。（1）`package.json` 没有 `permissions`、`engineCompatibility`、`source` 或 `provides` 的 schema 槽位；通过 sidecar 文件附加这些字段会以更差的工具重建本清单。（2）npm 包设计为在进程内 `require()`，这与 Tier 3 子进程边界（A2）和前端代码的 iframe 沙箱冲突。（3）npm 解析在安装时拉取传递依赖，没有权限门控，破坏了 §3 的最小权限模型。（4）插件市场和注册中心是明确的非目标；复用 npm registry 会隐式地将本 RFC 耦合到我们已选择不依赖的第三方服务。插件是一个自带清单的自包含目录；该目录如何分发是另一个关注点。

### 反例：为何不允许 Tier 3 插件进程内运行

将社区插件代码直接加载到宿主进程更快（无 IPC）且更简单（无序列化）。它也是可用的最大安全漏洞：进程内运行的社区插件可以读取 `AUTH_TOKEN`、SQLite 数据库、每个其他插件的 `plugin_data` 和宿主文件系统。决策 A2 明确要求 Tier 3 的子进程隔离，使得恶意或有缺陷的社区插件的失败模式是"该插件的工具调用失败"，而不是"宿主泄露了每个用户会话"。性能成本受 §10 的预算约束，且仅在实际工具调用时支付，而非空闲时。

## 架构决策记录

### 决策 (ADR-1：社区插件的子进程 vs 进程内)

**背景。** Tier 3 社区插件需要执行模型。宿主可以在进程内加载其代码（快速、简单）或在进程外运行（安全、较慢）。

**选项。** （a）所有插件进程内。（b）所有插件进程外。（c）按层级划分：Tier 1/2 进程内，Tier 3 进程外（决策 A2）。

**决策。** （c）。内置和一方插件受信任（由项目签名），为性能进程内运行。社区插件在子进程中运行（CPU 密集 JS 用 `worker_threads`，二进制用 `child_process`），因此恶意或有缺陷的插件无法读取宿主内存、`AUTH_TOKEN` 或其他插件的状态。

**备选方案。** （a）坍塌了信任边界 —— 一个坏的社区插件就危及宿主。（b）为常见情况（内置工具）支付 IPC 开销却无安全收益，因为内置工具按定义已受信任。

### 决策 (ADR-2：三层模型，而非两层)

**背景。** 宿主需要为信任、生命周期和 dogfooding 目的区分"编译进的核心"、"官方发布的扩展"和"用户安装的扩展"。

**选项。** （a）两层：内置 vs 插件。（b）三层：内置 / 一方插件 / 社区插件（决策 A4）。（c）四层：在一方和社区之间增加"已验证（Verified）"层。

**决策。** （b）。一方层让项目通过社区使用的同一协议发布官方插件（例如 PDF 渲染器、代码评审 skill 包）—— 在生产中 dogfooding 该协议。两层模型迫使每个官方扩展要么进入编译二进制（无法独立更新），要么进入社区池（无信任信号）。四层模型增加了一个本 RFC 明确推迟到 T6 的验证层。

**备选方案。** （a）失去 dogfooding 循环和信任信号。（c）预先承诺了一个本 RFC 拒绝指定的验证流程。

### 决策 (ADR-3：拒绝会话内热更新)

**背景。** 当插件在会话中途被启用/禁用/安装时，正在运行的会话是否应立即获取变更？

**选项。** （a）热更新：在运行的 agent 循环中实时添加/移除工具和 MCP 连接。（b）会话作用域：变更仅应用于转换后启动的会话。

**决策。** （b）。插件状态在会话启动时解析，并在会话内保持不变。用户必须启动新会话（或重启宿主）才能看到变更。

**理由。** 热更新引入了大量竞态面：工具执行到一半时其插件被禁用；组装的上下文工具列表不再匹配模型的工具调用；前端挂载的 iframe 在用户交互时被销毁。这些没有一个能在没有复杂得多的协调层的情况下处理，且用户收益（即时反馈）对于会话重启成本低廉的自托管产品来说很小。

**备选方案。** （a）UX 有吸引力，但竞态面在现阶段不值这个成本；未来的 RFC 可以增加一个严格定义的"会话重载"原语，它不尝试实时变更。

### 决策 (ADR-4：SQLite plugin_data + 公开 store API)

**背景。** 插件需要持久状态。选项：（a）每个插件管理自己的存储（文件、嵌入式 DB）；（b）每个插件一张 SQLite 表；（c）一张共享的 `plugin_data` 表，以 `(plugin_id, key)` 为键，配公开 API（决策 A5）。

**决策。** （c）。单张 `plugin_data(plugin_id, key, value, created_at, updated_at)` 表，仅通过 `plugin.store.{get,set,delete,list}` 访问，按插件 id 自动加作用域。

**理由。** （a）使卸载清理不可能 —— 插件可能在任何地方留下数据。（b）增加了 schema 管理负担并破坏单数据库约定。（c）保持数据层可检查（一条 SQL 查询列出插件拥有的所有内容），使卸载成为单条 `DELETE WHERE plugin_id = ?`，并让宿主在不信任插件的情况下强制隔离。公开 API 让插件代码免于 SQL，符合仓库的扁平函数式风格。

**备选方案。** （a）无法管理；（b）在此规模下无收益地重复迁移机制。

## 迁移

迁移是附加性的；`tools`、`mcps`、`messages` 或 `message_summaries` 中的现有行都不被修改。

1. **阶段 0 —— 发布契约。** 落地清单 schema、生命周期事件 schema、TypeScript 类型和图表。无 DB 变更，无运行时行为变更。独立 Skills 和 MCP 服务继续工作。
2. **阶段 1 —— `plugin_data` 表。** 添加迁移，创建 `plugin_data(plugin_id, key, value, created_at, updated_at)` 并在 `(plugin_id, key)` 上建立唯一索引。新的 `repo/plugin-data.ts` 负责它；没有其他模块写该表。
3. **阶段 2 —— 清单加载。** 实现针对 schema 的 `plugin.json` 校验和 `discovered → verified` 转换。尚未连接任何能力；插件安装但不贡献任何内容。
4. **阶段 3 —— 能力连接。** 通过现有 MCP manager 连接 `provides.mcpServers`，通过现有 skills 加载器连接 `provides.skills`，通过现有 `ToolExecutor` registry 连接 `provides.tools` —— 全部以 `pluginId:resourceName` 命名空间化。
5. **阶段 4 —— Tier 3 子进程。** 在 §10 的预算背后为 `source:"community"` 插件添加子进程运行时。Tier 2 保持进程内。

每个阶段都可独立回滚。没有阶段修改现有的持久化行；`tools` 和 `mcps` 表是插件状态的只读消费者，从不被插件层原地重写。

## 开放问题

1. **Tier 3 传输。** 社区插件使用 `worker_threads`（同语言、更低开销）还是 `child_process`（语言无关、更强隔离）。本 RFC 规定了边界（进程外）但不规定传输；后续工作将基于真实 Tier 3 插件做出选择。
2. **依赖解析算法。** §3 携带 `dependencies` 字段，但解析器（npm 风格、拓扑排序、带环检测）在此不规定。阶段 2 将定义它。
3. **前端沙箱消息协议。** A2 为前端插件固定了 iframe+CSP，但沙箱与宿主之间的 `postMessage` 通道（请求/响应形状、允许的宿主 API）是 Extension Points RFC 的主题。
4. **沙箱外的插件自有文件。** §6 将文件系统写入限定在 `$PLUGINS_DIR/<plugin_id>/`。插件是否能读取该前缀之外的宿主文件（例如代码评审插件读取用户项目目录）留给 Tool Safety RFC，后者已有 `danger` 级确认路径。
5. **遥测面。** 多少插件生命周期遥测（安装延迟、钩子失败、工具调用超时）被暴露，以及通过哪个现有调试面（`useDebugStore`），未规定。

## 参考文献

- `docs/rfc/_architecture-decisions.md` —— 决策 A1（插件概念）、A2（执行边界）、A3（扩展点，含 `Memory Backends`）、A4（三层模型）、A5（状态归属）、B6（单循环 + 模式提示）。
- `docs/rfc/context-management-v2.md` —— 插件工具消费的 `RunContext`，以及 `Memory Backends` 扩展点桥接。
- `docs/rfc/schemas/plugin.manifest.schema.json` —— 清单的正式 JSON Schema（draft-07、自包含、使用 `$defs`）。
- `docs/rfc/schemas/plugin.lifecycle-event.schema.json` —— 生命周期事件记录的正式 JSON Schema。
- `docs/rfc/types/plugin-manifest.d.ts` —— 镜像两个 schema 的 TypeScript 类型（自包含、全部 `export`）。
- `docs/rfc/diagrams/plugin-lifecycle.mmd` —— 状态机和安装/卸载时序图。
- `apps/server/src/mcp/manager.ts` —— 为插件提供的 MCP 服务复用的 MCP 连接管理器；临时工具、惰性重连、30s 默认超时。
- `apps/server/src/mcp/transport-factory.ts:12-24` —— 仅 stdio 的传输基线。
- `apps/server/src/tools/registry.ts` —— 插件提供的工具使用的 `ToolExecutor` 接口和模块作用域 registry。
- `apps/server/src/tools/executor.ts:25-29,232-234` —— 插件工具继承的三级安全严格性和 `stricterLevel` 规则。
- `apps/server/src/repo/summary.ts`、`apps/server/src/repo/message.ts` —— 仓库约定（每个单元一行、扁平模块），新的 `repo/plugin-data.ts` 遵循之。
