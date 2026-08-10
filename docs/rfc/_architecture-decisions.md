# 架构决策记录 (Architecture Decisions)

本文档记录 MyCopilot Plugin 系统 RFC 的关键架构决策。所有决策已在 interview + planning 阶段经 user 确认。

---

## 决策 A1 — Plugin 概念定位

### 问题背景

需要明确定义 Plugin 系统的核心概念：

- Plugin 与现有 Skill/MCP/Tool 的关系是什么？
- Plugin 是简单的打包外壳，还是有独立语义的高层概念？
- Plugin 类型系统如何设计？

### 选项

1. **Plugin 作为 Skill+MCP+Tool 打包外壳**：无独立语义，仅作为分发单元
2. **Plugin 作为第 4 类 primitive**：与 Skill/MCP/Tool 平行的概念，直接暴露给 agent
3. **Plugin 作为完整可分发的扩展单元**：高层的"打包+生命周期+分发"单元，内部可包含多种 capability

### User 答复

选择选项 3：
**Plugin 是完整可分发的扩展单元**（参考 AstrBot Star / VS Code Extension 模式），
不是 Skill+MCP+Tool 简单打包外壳，也不是第 4 类 primitive。是高层的"打包+生命周期+分发"单元，内部可包含多种 capability。

**Plugin Type 系统**（AstrBot 没有，MyCopilot 创新）：

- 当前主推：`frontend-response`（让 agent 响应可扩展：卡片/组件/iframe）
- 未来开放枚举：`backend-tool-only` / `llm-adapter` / `storage-provider` / `mcp-server-only` / `agent-preset`

**Plugin 内部 capabilities**：

- `frontend_components`（核心）
- `tools`
- `mcp_servers`
- `skills`
- `lifecycle_hooks`

**与既有 Skill/MCP/Tool 的关系**：

- 既有独立 Skill/MCP 继续支持（向后兼容）
- Plugin 是可选的"打包层"——类比 VS Code 既有内置 settings 也有 extension 打包的 settings 集合

### 理由

User 澄清"plugin 是真正需要安装、有业务代码、支持热更新的一类概念"。Plugin 需要独立语义来支撑：

- 版本管理
- 依赖解析
- 权限控制
- 生命周期管理
- 分发机制

Type 系统让 Plugin 声明自己的能力范围，便于：

- 前端按需加载
- 权限精细化控制
- 商店分类展示

### 对 RFC 设计的影响

1. **001-plugin-system-overview.md**：
   - Plugin 作为顶层概念，内含 capabilities
   - 明确 Plugin Type 枚举及扩展机制
   - 与现有 Skill/MCP 的兼容性说明

2. **002-plugin-execution-boundary.md**：
   - 执行边界按 capability 粒度划分，而非 Plugin 整体

3. **003-extension-points.md**：
   - Extension Points 声明在 Plugin 级别，实现由 capability 提供

---

## 决策 A2 — Plugin 执行边界

### 问题背景

Plugin 代码如何在系统内执行？如何平衡性能、安全、灵活性？

- Frontend 代码（components/iframe）如何隔离？
- Backend 代码如何隔离？
- Remote Plugin 是否支持？

### 选项

1. **全流程进程隔离**：所有 Plugin 代码都在独立进程执行（性能开销大）
2. **全流程 in-process**：所有 Plugin 代码都在主进程执行（安全风险高）
3. **前后端分层执行**：前端沙箱隔离，后端按 Tier 分级隔离

### User 答复 (A2)

选择选项 3：**前后端分层执行**

**Frontend**：

- 浏览器内用 **iframe + CSP 沙箱**隔离
- 防止主应用被污染

**Backend**：

- Tier 1 Built-in：in-process（编译进二进制，完全信任）
- Tier 2 First-party Plugin：in-process（信任官方签名）
- Tier 3 Community Plugin：**subprocess**（worker_threads / child_process）隔离
- Remote：始终作为可选兼容（MCP HTTP server）

### 理由 (A2)

- **性能**：Built-in 和官方 Plugin in-process，减少 IPC 开销
- **安全**：社区 Plugin 进程隔离，防止恶意代码影响主系统
- **灵活**：Remote Plugin 作为兼容层，支持跨语言集成
- **前端必须沙箱**：防止 XSS、DOM 污染等安全问题

### 对 RFC 设计的影响 (A2)

1. **002-plugin-execution-boundary.md**：
   - 明确三 Tier 模型
   - 定义各 Tier 的执行模型、安全约束、性能特性
   - Frontend 沙箱规范（CSP 策略、跨域规则、消息通道）

2. **001-plugin-system-overview.md**：
   - Plugin 元数据需声明 `source` 字段（built-in/official/community/remote）
   - 系统自动路由到对应执行环境

---

## 决策 A3 — Extension Points 范围

### 问题背景

Plugin 可以通过哪些扩展点与系统集成？

- 必须支持的 EP 有哪些？
- 可选支持的 EP 有哪些？
- 优先级如何排序？

### 选项

1. **全可选 EP**：所有 EP 都是可选，Plugin 按需实现
2. **全必需 EP**：所有 EP 都是必需，Plugin 必须实现（过于严格）
3. **分级 EP**：MUST / MAY 分级，明确优先级

### User 答复 (A3)

选择选项 3：**分级 EP（MUST / MAY）**

**MUST（5 个核心 EP）**：

1. Frontend Response Renderer
2. Tools
3. MCP Servers
4. Skills
5. Lifecycle Hooks

**MAY（4 个可选 EP）**：

1. Context Providers
2. LLM Providers
3. Memory Backends
4. UI Panels

**Lifecycle Hooks**（参考 AstrBot EventType 子集）：

- `on_app_loaded`
- `on_message_received`
- `on_llm_request`
- `on_llm_response`
- `on_tool_call`
- `on_plugin_loaded`
- `on_plugin_unloaded`

### 理由 (A3)

当前 type=frontend-response 的核心需求是"让 agent 响应可扩展"，因此 Frontend Response Renderer EP 是 MUST。

分级 EP 机制让：

- 核心功能（MUST）保证最低可用性
- 高级功能（MAY）鼓励创新但不强制
- Plugin 可以分阶段实现

### 对 RFC 设计的影响 (A3)

1. **003-extension-points.md**：
   - EP 分级说明（MUST / MAY）
   - 每个 EP 的定义、接口规范、安全约束
   - Lifecycle Hooks 完整事件列表

2. **001-plugin-system-overview.md**：
   - Plugin 元数据需声明实现哪些 EP
   - 系统按 EP 类型进行验证和路由

---

## 决策 A4 — 三 Tier 官方扩展位

### 问题背景

官方如何通过 Plugin 机制扩展系统？

- Built-in 功能如何暴露？
- 官方 Plugin 如何与社区 Plugin 区分？
- 是否需要"中间层"来验证协议生产可用性？

### 选项

1. **二分模型**：Built-in vs Plugin（无官方 Plugin 层）
2. **三分模型**：Built-in / Official Plugin / Community Plugin
3. **四分模型**：Built-in / Official Plugin / Verified Plugin / Community Plugin

### User 答复 (A4)

选择选项 2：**三 Tier 模型**

**Tier 1 — Built-in**：

- 编译进二进制，不可卸载
- 用于核心功能（chat, storage, config）

**Tier 2 — First-party Plugin**：

- `source: "official"`
- 默认安装，可禁用不可卸载
- 用同一协议 dogfood，确保生产可用性

**Tier 3 — Community Plugin**：

- `source: "community"`
- 用户显式安装
- 完整生命周期（安装/启用/禁用/卸载）

### 理由 (A4)

- **Dogfood 验证**：官方用同一协议开发 Plugin，确保协议生产可用
- **灵活性**：官方 Plugin 可以独立更新，不依赖主应用发版
- **信任边界**：用户可以区分"官方维护"和"社区贡献"
- **向后兼容**：Built-in 保持不可变，确保稳定

### 对 RFC 设计的影响 (A4)

1. **001-plugin-system-overview.md**：
   - Plugin 元数据 `source` 字段定义
   - 三 Tier 的生命周期差异

2. **002-plugin-execution-boundary.md**：
   - 各 Tier 的执行模型差异
   - 官方 Plugin in-process 示例

---

## 决策 A5 — Plugin 状态归属

### 问题背景

Plugin 如何存储自己的状态和数据？

- SQLite vs 文件系统 vs 内存存储？
- 是否需要公共 API？
- 如何隔离数据？

### 选项

1. **自管理存储**：Plugin 自己决定存储方式（难以统一管理）
2. **强制 SQLite**：所有状态存 SQLite（无法支持文件存储）
3. **混合模式 + 公共 API**：SQLite 默认 + 可选文件声明 + 统一 API

### User 答复 (A5)

选择选项 3：**混合模式 + 公共 API**

**参考 AstrBot PluginKVStoreMixin 模式**：

**主存储（SQLite）**：

- 表：`plugin_data(plugin_id, key, value, created_at, updated_at)`
- 自动按 `plugin_id` 隔离
- 索引：`(plugin_id, key)`

**公共 API**：

```typescript
plugin.store.get(key) // 读取状态
plugin.store.set(key, value) // 写入状态
plugin.store.delete(key) // 删除状态
plugin.store.list() // 列出所有键
```

**文件存储（可选）**：

- 需声明 `permissions.filesystem.write` 白名单
- 路径前缀：`$PLUGINS_DIR/<plugin_id>/`
- 卸载时自动清理

### 理由 (A5)

- **统一管理**：SQLite 统一存储便于卸载时清理
- **简化开发**：公共 API 降低插件开发复杂度
- **灵活性**：支持文件存储（如模型文件、缓存）
- **权限控制**：文件写入需显式声明权限

### 对 RFC 设计的影响 (A5)

1. **001-plugin-system-overview.md**：
   - Plugin Runtime API 定义（store API）
   - `permissions` 字段定义（filesystem.write）

2. **002-plugin-execution-boundary.md**：
   - 存储层的安全约束（SQL 注入防护、路径遍历防护）
   - 卸载时的清理逻辑

---

## 决策 B6 — Chat 模式 vs 生成式 mode

### 问题背景

Frontend Response Renderer 如何与现有的 Chat 模式集成？

- 是否需要独立的"生成模式"？
- 用户如何切换模式？
- LLM 如何决定是否使用 Renderer？

### 选项

1. **显式模式切换**：用户手动选择"聊天模式"或"生成模式"
2. **隐式模式检测**：系统根据输入自动判断模式
3. **单一 loop + mode hint**：不区分显式 mode，LLM 自行决定产出形态

### User 答复 (B6)

选择选项 3：**单一 loop + mode hint**

- **不区分显式 mode**：agent loop 始终一致
- **LLM 自行决定**：根据 system prompt + 用户输入决定产出形态（文本/卡片/Artifact）
- **Frontend Response Renderer EP**：接收 LLM 决策并渲染

### 理由 (B6)

- **最简奢实现**：避免 mode 切换 UX 复杂度
- **智能决策**：LLM 比规则判断更灵活
- **无缝体验**：用户无需关心"模式"，自然交互

### 对 RFC 设计的影响 (B6)

1. **003-extension-points.md**：
   - Frontend Response Renderer EP 接收 LLM 的"渲染指令"
   - Agent system prompt 需包含 Renderer 触发规则

2. **001-plugin-system-overview.md**：
   - 无需显式的"模式"概念
   - Plugin 通过 Renderer EP 响应 LLM 决策

---

## 决策 B7 — Artifact 子系统承诺

### 问题背景

Frontend Response Renderer 是否需要完整的 Artifact 子系统？

- 是否需要版本管理？
- 是否需要导出格式？
- 是否需要多 artifact 关联？

### 选项

1. **完整 Artifact 子系统**：包含版本管理、导出、关联等（RFC 膨胀）
2. **最小 Renderer 协议**：仅定义渲染协议，Artifact 模型延期
3. **中间方案**：Renderer 协议 + 部分 Artifact 模型

### User 答复 (B7)

选择选项 2：**最小 Renderer 协议**

**承诺**：

- Frontend Response Renderer 完整协议
- iframe + CSP 沙箱规范

**不承诺**（列入 Future Work）：

- Artifact 数据模型（版本管理/导出格式/多 artifact 关联）
- Artifact 存储（SQLite schema）
- Artifact 分享/导出功能

### 理由 (B7)

- **核心场景**：A1 的核心场景是"agent 响应可扩展"，所以 Renderer 协议必须本轮完成
- **避免膨胀**：完整 Artifact 子系统会让 RFC 膨胀，难以 review
- **迭代开发**：先实现 Renderer，Artifact 模型可后续独立 RFC

### 对 RFC 设计的影响 (B7)

1. **003-extension-points.md**：
   - Frontend Response Renderer EP 完整定义
   - iframe + CSP 沙箱规范
   - 无 Artifact 数据模型定义

2. **Future Work**：
   - 独立 RFC 定义 Artifact 子系统
   - 版本管理、导出格式、多 artifact 关联

---

## 文档维护

- 本文档随 RFC 的开发持续更新
- 每个决策需保持 user 答复、理由、影响的明确性
- 不得包含 TBD、pending、未决内容
