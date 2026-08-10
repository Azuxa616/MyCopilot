# 插件扩展点（Plugin Extension Points）

> 状态：**提案（Proposal）** · 负责人：server/plugin + web · 依赖：T1
> 架构决策（A1 插件概念、A2 执行边界、A3 九个扩展点、A5 状态归属、B6
> 单循环 + 模式提示、B7 最小 Renderer 协议）以及 T4 清单与生命周期 RFC（清单
> 字段名、命名空间规则、性能预算、热更新拒绝）。
> 范围：枚举并规范每个插件扩展点的协议接口。本 RFC 仅为文档，不修改
> `apps/` 或 `packages/` 下的任何源码。

## 动机

T4 插件清单与生命周期 RFC 冻结了一个插件包*是什么*：一个含 `plugin.json`
的目录、一个七态生命周期、一个 3 层信任模型，以及一条命名空间规则。它有意
没有规定每个扩展点的*协议接口*。清单的 `provides` 块列出的是符号引用 ——
`mcpServers`、`skills`、`rules`、`frontendEntry`、`contextProviders`、
`memoryBackends` —— 但对于插件作者要写的函数签名、host 要强制执行的输入/输出
契约，以及每项能力如何桥接到既有代码路径，则只字未提。

没有本 RFC，每个插件作者都会自创一套形态，host 也会为每项能力堆砌临时的
胶水代码。有了本 RFC，决策 A3 中的七个扩展点就成了一等公民、经过 schema
校验的协议，Tier 2 或 Tier 3 插件即可基于稳定的契约来实现它们。这一点对
用户明确优先考虑的两个头条 MUST 点最为重要：Artifact Renderers（决策 B7 ——
本轮完整规范，完整 Artifact 数据模型延后）和 Lifecycle Hooks（A3 中的七个
运行内事件）。其余五个点继承相同的形态，从而保持接口的一致性。

## 目标

- 枚举决策 A3 中的**全部七个**扩展点（五个 MUST、四个 MAY；MCP Servers 与
  Skills 在此处不在范围内，因为 T4 和既有的 `mcp/manager.ts` 已经定义了它们），
  并为每一个给出接口签名、JSON Schema、错误协议、安全层级和性能预算。
- 依据决策 B7 完整规范 **Artifact Renderer 协议**：iframe + CSP 沙箱、
  postMessage 通道、payload 大小上限，以及对 `allow-scripts + allow-same-origin`
  的拒绝规则。
- 依据决策 A3 完整规范 **Lifecycle Hook 协议**：七个事件（`on_app_loaded`、
  `on_message_received`、`on_llm_request`、`on_llm_response`、`on_tool_call`、
  `on_plugin_loaded`、`on_plugin_unloaded`）、fail-fast 默认策略，以及通过既有
  `onEvent` 回调桥接到 `agent-loop/runner.ts` 的方式。
- 把每个扩展点钉到一个**具体的桥接点**上（既有代码中的 `tools/registry.ts`、
  `prompt/assembler.ts`、`llm/base.ts`、`agent-loop/runner.ts`、
  `web/src/store/`），从而让契约是针对真实代码而非假想重构来编译的。
- 明确保持**安全梯度**：哪些点默认允许 Tier 3 社区插件，哪些仅限 Tier 1/2
  进程内，以及原因。

## 非目标

以下各项明确不在范围内，任何声称符合本 RFC 的实现都不得引入它们：

- **Tier 3 插件修改 agent loop 或 SSE 协议。** agent loop
  （`agent-loop/runner.ts`）和 SSE 事件接口是 Tier 1 的 host 代码。社区插件
  可以通过 Lifecycle Hooks *观察*运行事件，但不得改变循环控制流、注入 SSE
  事件，或在运行中替换 adapter。这是本 RFC 硬性的非目标。
- **完整的 Artifact 数据模型。** 决策 B7 将版本化、导出格式、多 artifact
  关联以及 artifacts 的 SQLite schema 延后到未来的 RFC。本文档仅规范
  *renderer 协议* —— 即一个 payload 如何变成一个沙箱化的 React 组件。
- **市场、支付、签名校验。** 继承自 T4；此处不变。
- **假设某个特定前端框架（UI Panels 除外）。** 七个扩展点中有六个与框架无关。
  UI Panels 可以声明对 React 的假设，因为当前前端栈
  （`apps/web/src/`、React 19 + Zustand）就是集成目标。
- **超过 5000 字。** 如果未来的修订需要更多篇幅，就拆分为
  `plugin-extension-points.md`（核心）和 `plugin-extension-points-ui.md`
  （前端扩展点）。本单一文件保持在预算之内。

## 规范

每个扩展点都遵循相同的形态：一个接口签名（镜像于
`docs/rfc/types/extension-points/<ep>.d.ts`）、一个输入/输出契约
（`docs/rfc/schemas/extension-points/<ep>.schema.json`，draft-07，自包含并带
`$defs`）、一个错误协议、一个安全层级、一个性能预算，以及一段伪代码工作流。
按 T4 命名空间规则，每个插件注册的资源在外部都以
`pluginId:resourceName` 的形式被寻址。

决策 A3 的分级得以保留：MUST 点是 Frontend Response Renderer（此处命名为
Artifact Renderers，即 B7 的命名）、Tools、MCP Servers（不在范围内 —— T4）、
Skills（不在范围内 —— T4）和 Lifecycle Hooks；MAY 点是 Context Providers、
LLM Providers、Memory Backends 和 UI Panels。MCP Servers 和 Skills 已经通过
`apps/server/src/mcp/manager.ts` 和 skills 加载器拥有了完整规范的协议，因此
此处不再重新规范。

### 1. Tools

**桥接。** `apps/server/src/tools/registry.ts` 导出了 `ToolExecutor` 接口
（`execute(args, context)` + `describe(): Tool`）和一个模块级 registry。
`apps/server/src/tools/executor.ts` 强制执行三级安全层级（`safe=0`、
`restricted=1`、`danger=2`）以及 `executor.ts:232-234` 处的 `stricterLevel`
规则。

**接口。** 插件实现 `tools.d.ts` 中的 `PluginToolExecutor`，它与
`ToolExecutor` 结构相同，因此既有 registry 无需适配即可接受它。注册经过一个
新的 host 端 `registerPluginTool(ToolRegistration)`，它会在调用既有
`registerTool` 之前给名字加上 `pluginId:` 前缀。

**输入/输出契约。** 参数是由 host 解析的一个 JSON 对象（镜像
`executor.ts:236` 的 `parseArguments`）。输出是 `PluginToolResult`，与
`ToolExecutionResult` 字节级一致。host 在抛错或超时时复用既有的
`errorResult(...)` helper。

**错误处理。** 抛错、超时或 `isError: true` 都是*可恢复的*失败（T4 §9）：
agent loop 收到一个失败的 tool 结果，可以重试或选择另一个 tool。插件保持
启用。

**安全层级。** 插件 tool 默认为 `restricted`（每个会话+参数摘要需确认一次）。
MCP 提供的插件 tool 通过 `resolveMcpTarget` 中既有的 `stricterLevel` 调用
（`executor.ts:148-152`）被钳制到至少 `restricted`。插件可以声明 `danger`，
这会强制每次调用都需确认。任何插件 tool 都不得被钳制到 `restricted` *以下*。

**性能预算。** 每次调用 30000 ms（T4 §10，即 `mcp/manager.ts:26` 中既有的
`DEFAULT_TIMEOUT_MS`）。允许按调用覆盖至最高 30000 ms；host 会拒绝请求更长
时间的 manifest。

**伪代码。**

```text
at session start:
  for tool in enabledPluginTools:
    fq = tool.pluginId + ":" + tool.name
    if registry.has(fq): reject(namespace_conflict, fq)
    else: registry.set(fq, tool.executor)
on tool_call(tc):
  target = registry.get(tc.name)        // namespaced
  level  = stricterLevel(target.describe().safetyLevel, "restricted")
  if level in {restricted, danger}: await requestToolApproval(...)
  result = await target.execute(args, ctx) with 30s timeout
  emit tool_result to onEvent
```

完整的调用流程见 `docs/rfc/diagrams/tool-call-flow.mmd`。

### 2. Context Providers

**桥接。** `apps/server/src/prompt/assembler.ts:assembleMessages`。如今
assembler 按顺序注入三个 system-message 来源：默认 prompt、skills、先前
summary。Context Providers 默认在 *skills 之后*增加第四个槽位。

**接口。** 插件实现 `context-providers.d.ts` 中的
`ContextProvider.provide(input)`，返回零个或多个 `ContextProviderOutput` 块
（`label`、`text`、可选的 `priority`）。

**输入/输出契约。** 输入是一个只读的 `ContextProviderInput`（sessionId、
query、recentMessages、signal）。host 永远不会传入完整未截断的历史 —— 只传入
LLM 将要看到的、经过过滤和截断后的切片。输出块按 `priority`（升序）拼接、
按 `maxCharsPerProvider` 截断，并合并成一条 system message。

**错误处理。** 抛错或超时会丢弃该 provider 本轮的输出；运行继续。host 会记录
该失败，但如果 provider 出错，就永远不会把 provider 文本暴露给 LLM，以避免
半截文字泄露进 prompt。

**安全层级。** MAY 点。Tier 2（进程内）与 Tier 3（子进程）。Tier 3 provider
通过 IPC 返回文本；host 在插入之前会字符串化并做长度检查。

**性能预算。** 每轮所有 provider 合计 2000 ms；每个 provider 4000 字符。默认值
编码为 `DEFAULT_CONTEXT_PROVIDER_BUDGET`。

装配流程见 `docs/rfc/diagrams/context-provider-flow.mmd`。

### 3. LLM Providers

**桥接。** `apps/server/src/llm/base.ts` 定义了 `ProviderAdapter`
（`chatCompletionStream(messages, config, options): AsyncGenerator`）。
`runner.ts:300` 中的 agent loop 原样消费任何 adapter。

**接口。** 插件提供一个 `LlmProviderFactory.create(config)`，返回一个
`LlmProviderAdapter`（`llm-providers.d.ts`）。该 adapter 接口与
`ProviderAdapter` 结构相同，因此既有循环无需改动即可接受它。

**输入/输出契约。** 输入是 `ChatMessage[]` 加上 `AdapterConfig` 和流式选项。
输出是一个 `AsyncGenerator<StreamEvent>`。host 把每个事件原样转发给
`onEvent`；插件 adapter 不得发出 host 内部的事件类型。

**错误处理。** 一个 `ProviderError`（带 `statusCode`）会变成 agent loop 中一个
终止性的 `error` 状态。流中途的 abort 遵循既有的 `abortSignal` 管线；adapter
必须停止 yield。

**安全层级。** MAY 点，**仅限 Tier 1/2 进程内**。社区（Tier 3）插件不得注册
LLM provider：一个 LLM adapter 能看到每条聊天消息和 `AdapterConfig` 中的每个
API key，因此其信任要求与内置相同。这是本 RFC 中最严格的分层。

**性能预算。** factory `create()` 上限为 1000 ms。流本身受调用方的
`AbortSignal` 约束；因为分块由 provider 定义，所以不额外强制每个 chunk 的
预算。

### 4. Artifact Renderers（决策 B7 —— 头条 MUST 点）

**桥接。** 前端收到一个携带 renderer 指令的 `StreamEvent`，查找已注册的
`ArtifactRenderer`，并在一个带严格 CSP 的 `<iframe sandbox=...>` 中加载
`bundleUrl`。host 永远不会 import 插件的 React 代码；iframe 通过
`postMessage` 通信。

**接口。** host 注册 `ArtifactRenderer` 描述符（`artifact-renderers.d.ts`）：
`id`、`kind`、`bundleUrl`、可选的 `csp`，以及一个必填的 `sandbox` 策略。
依据决策 B6（单循环、模式提示），LLM 发出一个 `ArtifactRenderRequest`
（`rendererId`、`kind`、`payload`、可选的 `title`）—— 没有显式的“生成模式”；
LLM 依据 system prompt + 用户输入来做决定。

**输入/输出契约。** iframe 接收 `{type:'render', requestId, payload}`，且必须
在 `renderTimeoutMs`（默认 10000）内回复 `{type:'rendered', requestId,
height?}`。错误以 `{type:'error', requestId, message}` 返回。payload 上限为
`maxPayloadBytes`（默认 1 MiB）。host 永远不会检查 `payload` —— schema 由
renderer 自己拥有。

**沙箱（决策 A2 + B7）。** 每个 renderer iframe 都会得到：

- 来自注册的 `sandbox` token，默认为 `["allow-scripts"]`。
- 一个禁止 `same-origin` 和 `unsafe-eval` 的 CSP。默认值为
  `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'`。
- 一个用于 `postMessage` 的 `allowedOrigins` 列表；通配符 `*` 在注册时会被
  **拒绝**。
- `allow-scripts + allow-same-origin` 的组合在注册时会被**拒绝**（编码为
  `artifact-renderers.schema.json` 中的一条 `not` 规则），因为二者同时存在会让
  iframe 逃逸出自己的 origin，进而触及 host 的 cookies、tokens 和 DOM。

**错误处理。** 超时或未处理的 `error` 消息会拆除 iframe 并显示一个兜底的
“renderer failed”卡片。聊天消息本身不受影响 —— renderer 仅负责展示。

**安全层级。** MUST 点。Tier 2（已签名 renderer bundle）和 Tier 3（社区
renderer bundle），但无论哪个层级都**始终运行在沙箱内**。即便是第一方
renderer 也运行在 iframe 中，因为 renderer bundle 是远程加载的，处于 host 的
编译单元之外。

**性能预算。** `renderTimeoutMs` 默认 10000；`maxPostMessageBytes` 默认
65536。编码为 `DEFAULT_ARTIFACT_RENDERER_BUDGET` 和
`DEFAULT_ARTIFACT_SANDBOX`。

### 5. Memory Backends

**桥接。** T3 Context Management v2 定义了 Memory 协议和未来的 `memories`
SQLite 表。T4 §6 定义了 `plugin_data` 表和 `PluginStore` API。Memory Backend
是这两个接口背后的*可插拔实现*：一个想要向量检索、远程存储或领域特定索引的
插件实现 `MemoryBackend`，host 就把 `get/set/search/delete` 路由给它。

**接口。** `memory-backends.d.ts`：`get`、`set`、`search`、`delete`。
`search` 返回 `MemorySearchHit[]`，其中带有一个由 backend 定义的 `score`，
取值在 `[0, 1]`。

**输入/输出契约。** 以 `namespace`（通常是 session id）加记录 `id` 进行命名
空间划分。host 把检索结果转发给 context assembler；它永远不会解释 `metadata`。

**错误处理。** `get`/`search` 上的抛错或超时返回空结果；`set`/`delete` 上的
抛错或超时会浮出一个可恢复的错误，调用方回退到默认的 `PluginStore`
（SQLite `plugin_data`）。

**安全层级。** MAY 点。触及网络的 backend 必须声明
`permissions.network: true`，并建议仅用于 Tier 2；Tier 3 backend 在进程外
运行，host 在插入之前对每条记录做长度检查。

**性能预算。** `callTimeoutMs` 默认 3000；`searchHardCap` 默认 10，硬上限
50。

### 6. UI Panels

**桥接。** `apps/web/src/store/`（Zustand hooks）以及
`apps/web/src/components/` 下的 PascalCase 组件目录。host 维护一个以
`UIPanelSlot` 为键的 slot registry；渲染时读取 registry、按 `order` 排序，并
通过 `moduleUrl` 的动态 `import()` 挂载每个 panel。

**接口。** `ui-panels.d.ts`：`UIPanelDescriptor`，含 `id`、`slot`、`label`、
`iconUrl?`、`order?`、`permissions` 和 `moduleUrl`。该模块的 default export
是一个 React 组件，接收一个小巧且类型化的 props 包（slot、permissions、
active session id）。

**输入/输出契约。** host 暴露具名 slot（`sidebar`、`toolbar`、
`message-action`、`settings-tab`），并留有开放尾供未来 slot 使用。未知 slot
会被忽略（向前兼容）。权限是显式的：`readSession`、`postMessage`、
`openExternal`，每项默认为 `false`。

**错误处理。** 动态 import 失败或渲染抛错会被一个 error boundary 捕获，该
panel 会在本会话余下时间内被隐藏；host chrome 不受影响。

**安全层级。** MAY 点，是唯一可以声明 React 假设的点。panel 运行在主 web
bundle 中（不沙箱化），因此建议仅用于 Tier 2。社区 panel 仅当其 `moduleUrl`
由 host 控制的 origin 提供、且用户显式启用时才被允许。

**性能预算。** `mountTimeoutMs` 默认 5000；`maxPanelsPerSlot` 默认 8。

### 7. Lifecycle Hooks

**桥接。** `apps/server/src/agent-loop/runner.ts` 已经把每个运行事件通过
`onEvent` 回调（`runner.ts:313`、`runner.ts:420`）路由出去。host 增加一个
薄薄的 dispatcher，它在调用用户提供的 `onEvent` *之前*，把事件扇出到与对应
`LifecycleHookEvent` 匹配的、已注册的 `LifecycleHookHandler`。

**接口。** `lifecycle-hooks.d.ts`：一个 handler 绑定一个
`LifecycleHookEvent`，并返回 `LifecycleHookResult`（`action: 'continue' |
'abort'`、可选的 `reason`、可选的 `meta`）。

**事件（决策 A3 子集）。** `on_app_loaded`、`on_message_received`、
`on_llm_request`、`on_llm_response`、`on_tool_call`、`on_plugin_loaded`、
`on_plugin_unloaded`。前五个从 `runAgentLoop` 内部触发；后两个从插件生命周期
状态机（T4）触发。

**输入/输出契约。** host 只用其为该事件已有的字段填充
`LifecycleHookPayload`（例如 `on_tool_call` 时的 `toolName` 和
`toolArguments`）。handler 在 `handlerTimeoutMs`（默认 5000，T4 §10）约束下
运行。

**错误处理。** 默认 **fail-fast**（T4 §9）：一个抛错或超出预算的 handler 会
以 `status: 'aborted'` 中止本次运行。manifest 可以按 handler 声明
`failMode: 'continue'`，把失败降级为一条被记录的警告。该默认值即下文的
ADR-2。

**安全层级。** MUST 点。Tier 2 handler 在进程内运行；Tier 3 handler 在进程
外运行，host 会把迟到或缺失的响应视为超时。hook 仅作观察 —— 它们不能改变
loop 状态、注入 SSE 事件，或替换 adapter（非目标）。

派发时序见 `docs/rfc/diagrams/lifecycle-hook-sequence.mmd`。

## 合规性

当且仅当以下所有条件都成立时，一个实现才符合本 RFC：

- 合规实现必须把每个插件注册的 tool 在外部以 `pluginId:toolName` 寻址，并
  通过 `tools/executor.ts` 中既有的 `ToolExecutor` 路径执行，同时把插件
  tool 默认设为 `restricted`，并通过 `stricterLevel` 把 MCP 提供的插件
  tool 钳制到至少 `restricted`（C1）。
- 合规实现必须在任何抛错或超时时丢弃 Context Provider 本轮的输出，且必须在
  把每个 provider 的内容插入 system prompt 之前，将其截断到
  `maxCharsPerProvider`（C2）。
- 合规实现必须拒绝注册来自 `source:"community"` 插件的 LLM Provider，因为
  一个 LLM adapter 能观察到每条聊天消息和每个 API key（C3）。
- 合规实现必须把每个 Artifact Renderer bundle 加载进一个带禁止
  `same-origin` 与 `unsafe-eval` 的 CSP 的 `<iframe sandbox=...>` 中，且必须
  拒绝任何把 `allow-scripts` 与 `allow-same-origin` 组合、或把通配符 `*`
  用作 allowed origin 的注册（C4）。
- 合规实现必须在 Memory Backend 调用抛错或超时回退到默认的 `PluginStore`
  （SQLite `plugin_data`），从而使一个失败的 backend 不能破坏会话状态
  （C5）。
- 合规实现必须强制执行 `maxPanelsPerSlot`，并把每个 UI Panel 挂载包裹在
  error boundary 中，从而使一个抛错的 panel 不能卸载 host chrome（C6）。
- 合规实现必须默认把抛错或超过 `handlerTimeoutMs` 的 Lifecycle Hook
  handler 视为 fail-fast，除非该 handler 的 manifest 显式声明了
  `failMode: 'continue'`，否则就以 `status: 'aborted'` 中止运行（C7）。

## 反例

### 反例：为何不允许 Tier 3 插件直接修改 agent loop 代码

让一个强大的社区插件去“改进” agent loop 很诱人 —— 加个重试策略、改改
tool-call 扇出、注入一个 SSE 事件。允许这样做会摧毁 3 层模型本来要强制的
信任边界（`_architecture-decisions.md` A2、A4）。agent loop 持有指向 LLM
adapter 的引用（因此持有 `AdapterConfig` 中的每个 API key），写入持久化的
消息行，并驱动用户正在观看的 SSE 流。一个改变 loop 状态的社区插件可以读取
每个 key、重写历史，或注入伪造的 assistant 轮次。Lifecycle Hooks 扩展点给
社区插件提供了一条安全的 *observe-and-abort* 通道：它们能看到相同的事件、
可以停止一次运行，但不能改变 loop 内部或发出 host 的 SSE 事件。这就是把那条
硬性非目标重新表述成一条正向契约。

### 反例：为何 Artifact Renderers 即便是第一方也必须沙箱化

用一个普通的 `<div>` 加一个 `<script>` 标签来加载 renderer bundle 更简单、
更快，还能省去 postMessage 握手。但它也是本产品中最大的 XSS 攻击面。
renderer bundle 是远程加载的 —— 来自 CDN、插件作者的服务器或未来的市场 ——
因此处于 host 的编译与评审边界之外。即便是第一方 bundle，也可能在 origin
处被攻陷而 host 不知情。iframe + CSP 沙箱把失败模式从“renderer 偷走了用户的
session token”变成“renderer 渲染失败”。代价是一次 postMessage 往返加一个
固定的 CSP；收益是一个恶意或有 bug 的 renderer 无法触及 host 的 cookies、
tokens 或 DOM。这就是决策 B7 的具体落地。

## 架构决策记录

### 决策 (ADR-1：UI Panels 的 slot 模式对比 render-prop 模式)

**背景。** UI Panels 需要一个挂载契约。常见的两种模式：(a) *slot 模式* ——
host 暴露具名 slot，panel 针对一个 slot 名注册；(b) *render-prop 模式* ——
host 暴露一个函数，panel 向其传入一个 React node。

**选项。** (a) slot 模式。(b) render-prop 模式。(c) 自由 portal（panel 渲染
进它自选的 `createPortal` 目标）。

**决策。** (a) slot 模式。host 暴露一个固定、小巧的具名 slot 集合
（`sidebar`、`toolbar`、`message-action`、`settings-tab`），并留有开放尾。
panel 针对一个 slot 名注册，由 host 控制排序、error boundary 和生命周期。

**备选。** (b) 给了 panel 更多灵活性，但把 host 耦合到 panel 的 React 树，
并使错误隔离更困难。(c) 允许 panel 渲染到任意位置，这破坏了 chrome 稳定性
保证，并使 `maxPanelsPerSlot` 无法强制执行。slot 模式与
`apps/web/src/components/` 既有的组织方式（PascalCase 目录、host 拥有布局）
相匹配。

### 决策 (ADR-2：Lifecycle Hook 的 fail-fast 默认策略)

**背景。** 一个 Lifecycle Hook handler 可能抛错、挂起或返回
`action: 'abort'`。host 必须挑选一个默认的失败策略。

**选项。** (a) fail-fast：handler 抛错或超时即中止运行。(b) continue：
handler 抛错被记录，运行继续。(c) 按事件定制策略。

**决策。** (a) fail-fast，可通过 manifest 中的 `failMode: 'continue'` 按
handler 覆盖。这与 T4 §9 的 lifecycle-hook 失败规则一致。

**理由。** 一个触发 `on_tool_call` 后挂起的 hook 很可能已经看到了敏感参数
（一条路径、一个 token）。把它当作“记录并继续”会默默降低运行质量，并隐藏
一类 bug。fail-fast 立即浮现该失败，让用户可以禁用该插件。覆盖选项是为那些
确实永远不该阻塞运行的、仅用于遥测的 hook 准备的。

**备选。** (b) 会隐藏失败，正是用户在 T1 中明确拒绝的默认值。(c) 毫无收益地
倍增了策略面 —— 覆盖选项已经覆盖了合法的“continue”情形。

### 决策 (ADR-3：LLM Providers 仅限 Tier 1/2 进程内)

**背景。** 一个 LLM provider adapter 能看到每条聊天消息和 `AdapterConfig`
中的每个 API key。它可以在哪里运行？

**选项。** (a) 任意层级，进程内。(b) 任意层级，Tier 3 进程外。(c) 仅限
Tier 1/2 进程内（即此处决策）。

**决策。** (c)。社区（`source:"community"`）插件不得注册 LLM provider。
合规条款 C3 强制执行这一点。

**理由。** 即便在进程外，一个社区 LLM adapter 也会通过 IPC 收到完整的消息流
和 API key —— 移动进程边界并不能移动数据边界。唯一的防御就是从一开始就不把
数据交给一个不可信的 adapter。想要使用社区模型的用户可以把它跑在一个
OpenAI 兼容的本地服务器后面，然后把*该服务器*注册为一个内置式的 provider
配置，这样永远不会暴露 host 的其他 key。

**备选。** (a) 是系统中最大的数据外泄面。(b) 给出一种虚假的安全感：子进程
依然能看到每条消息和每个 key。

## 迁移

本次迁移是增量、分阶段的；每个阶段都可独立回滚，且没有任何阶段修改既有的
持久化行。

1. **阶段 0 —— 交付契约。** 落地七个 `.d.ts` 文件、七个 schema、三张图，
   以及本 RFC。无运行时行为变化。
2. **阶段 1 —— 接入 Tools EP。** 新增 `registerPluginTool`，它做命名空间
   处理后转发给既有的 `registerTool`。插件 tool 与内置 tool 一同出现在
   registry 中；executor 路径不变。
3. **阶段 2 —— Lifecycle Hooks dispatcher。** 在 `runAgentLoop` 的
   `onEvent` 回调之前新增 dispatcher。hook 会触发，但 agent loop 逻辑保持
   不动。
4. **阶段 3 —— Artifact Renderer host。** 在前端新增 iframe host、CSP
   默认值和 postMessage 通道。LLM 的 system prompt 获得 renderer-directive
   模式提示（决策 B6）。
5. **阶段 4 —— MAY 点。** Context Providers、LLM Providers、Memory
   Backends、UI Panels 以任意顺序接入；每一个都独立有用、独立可回滚。

## 开放问题

1. **Renderer bundle 托管。** 第一方 renderer bundle 是从 host origin 还是
   从一个专用 CDN 提供，以及版本钉选如何与 iframe CSP 交互，留给实现决定。
2. **Memory Backend 评分校准。** `score in [0, 1]` 契约是统一的，但各
   backend 自定义其刻度；host 在转发给 assembler 之前是否做归一化，未作
   规定。
3. **UI Panel props 包形态。** 交给一个 panel 的 default export 的精确类型化
   props（除 slot、permissions、active session id 之外）将在编写第一个真实
   panel 时钉死。
4. **hook handler 顺序。** 当多个插件注册同一事件时，host 按注册顺序运行
   它们；是否需要一个 priority 字段被延后决定。
5. **hook 的 Tier 3 传输。** T4 开放问题 1（worker_threads 对比
   child_process）在此同样适用；hook dispatcher 与传输无关。

## 参考文献

- `docs/rfc/plugin-manifest-lifecycle.md` —— 本 RFC 所基于的 T4 manifest、
  生命周期状态机、命名空间规则和性能预算。
- `docs/rfc/_architecture-decisions.md` —— A1（插件概念）、A2（执行边界）、
  A3（九个扩展点）、A4（3 层模型）、A5（状态归属）、B6（单循环 + 模式提示）、
  B7（最小 Renderer 协议）。
- `docs/rfc/context-management-v2.md` —— 由 Memory Backends 扩展点桥接的
  T3 Memory 协议。
- `docs/rfc/types/extension-points/*.d.ts` —— 七个自包含、镜像各 schema 的
  TypeScript 模块。
- `docs/rfc/schemas/extension-points/*.schema.json` —— 七个 draft-07 JSON
  Schema，自包含并带 `$defs`。
- `docs/rfc/diagrams/tool-call-flow.mmd`、
  `docs/rfc/diagrams/context-provider-flow.mmd`、
  `docs/rfc/diagrams/lifecycle-hook-sequence.mmd` —— 三张流程图。
- `apps/server/src/tools/registry.ts` —— `ToolExecutor` 接口和模块级
  registry（Tools EP 桥接）。
- `apps/server/src/tools/executor.ts:25-29,232-234` —— 三级安全严格度与
  `stricterLevel`。
- `apps/server/src/prompt/assembler.ts` —— system-prompt 装配（Context
  Providers EP 桥接）。
- `apps/server/src/llm/base.ts` —— `ProviderAdapter` 接口（LLM Providers EP
  桥接）。
- `apps/server/src/agent-loop/runner.ts:313,420` —— `onEvent` 回调
  （Lifecycle Hooks EP 桥接）。
- `apps/server/src/mcp/manager.ts:26` —— 30 秒的默认 tool-call 超时。
