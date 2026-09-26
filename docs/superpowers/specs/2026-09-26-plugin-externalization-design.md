# 插件外部化：自带渲染器与页面上传安装（Plugin Externalization）

> 日期：2026-09-26 · 状态：已批准（待实施） · 范围：server + web + plugins/bilibili-search + docker
> 决议：合并实施 B7-lite 渲染器 + 页面上传安装；community 插件在非 demo 模式下可确认启用；
> 旧 ` ```bilibili-card ` 历史块回退为代码块显示，不留兼容垫片。

## 动机

当前实现存在两个结构性问题：

1. **渲染器内置于宿主**：`apps/web/src/components/BilibiliVideoCard/` 是 web 仓库代码，
   每新增一种卡片都要改宿主仓库——违背插件系统"外部导入、宿主零改动"的定义。RFC
   `plugin-extension-points.md` 的 B7（Artifact Renderer）早已定义了正确形态（插件
   frontendEntry + iframe 沙箱 + postMessage），但宿主端从未实现。
2. **页面无法真正安装插件**：`POST /api/plugins/install` 只接收 PLUGINS_DIR 下已存在
   的目录名；Docker/原生部署时用户必须手动把文件放进服务器磁盘（docker cp / 卷挂载），
   且 docker-compose 未挂 plugins 卷（容器重建即丢）。

## 目标

- 插件 ZIP 从页面上传安装：上传 → 校验 → 落盘 → 复用既有安装事务，全程不碰服务器
  文件系统、不碰宿主仓库。
- 插件自带卡片渲染器（`frontend/index.html`），宿主提供**通用**沙箱渲染组件
  （PluginCardHost），web 仓库删除 BilibiliVideoCard 等一切 bilibili 特化代码。
- 插件包可移植：manifest 中 MCP args 用相对路径，安装时由宿主解析为绝对路径（同一
  ZIP 在 Windows dev 与 Docker 通用）。
- community（用户上传）插件在非 demo 模式下可启用，启用前强制确认框明示声明的
  权限与命令。

## 非目标

- 插件市场、签名校验、付费分发（远期）。
- 多 entry / 多 HTML 资源渲染器：v1 约定单文件自包含 `frontend/index.html`。
- 渲染器沙箱之外的 UI 扩展点（UI Panels、Context Providers 等其余 RFC 扩展点）。
- 已安装插件的在线升级/版本管理（同 id 重复上传 → 409，升级流程后续另议）。
- Docker 基镜像升级（见"运行时约束"——插件侧适配 node:20）。

## 规范

### 1. 卡片数据协议（围栏块泛化）

- 围栏代码块语言从 `bilibili-card` 泛化为 **`<pluginId>:card`**（如
  `bilibili-search:card`）。`pluginId` 需匹配 `^[a-z][a-z0-9-]{1,63}$`（与清单
  PluginName 一致）。
- 载荷为 JSON，schema 归渲染器所有（宿主不解释）；单块载荷上限 1 MiB
  （`DEFAULT_ARTIFACT_RENDERER_BUDGET.maxPayloadBytes`，对齐 RFC B7）。
- 数据通道不变：插件工具输出围栏块 → 宿主在「工具时间线条目」与「markdown 正文」
  两处拦截（拦截逻辑泛化，无插件特化分支）。
- 旧会话中的 ` ```bilibili-card ` 块不再匹配新协议 → 按普通代码块显示（决议：不留
  兼容垫片）。

### 2. 渲染器交付与沙箱（PluginCardHost）

**插件侧**：manifest 声明 `provides.frontendEntry: { entry: "frontend/index.html" }`
（现有 schema 已支持该字段，无需改 schema）。约定单文件自包含：内联 CSS/JS、零外部
脚本/样式、除封面图外零网络请求。渲染器模板必须自带：

```html
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
<meta name="referrer" content="no-referrer">
```

**宿主侧**（新组件 `apps/web/src/components/PluginCardHost/index.tsx`，通用、无插件
特化）：

- `props: { pluginId: string; payload: unknown }`。
- 经认证 API `GET /api/plugins/:id/frontend` 拉取 entry HTML（`api/real.ts` 新增
  `fetchPluginFrontend`，内存 Map 缓存）。
- `<iframe sandbox="allow-scripts" srcDoc={html} style={{height}}>`——**不含**
  `allow-same-origin`：渲染器运行在 null origin，拿不到宿主 cookie/token/DOM
  （RFC C4；srcdoc 无法注入 header，CSP 由渲染器 meta 承担，sandbox 属性是硬边界）。
- postMessage 协议（渲染器 null origin，宿主 `postMessage(..., '*')`，收消息时校验
  来源为自身 iframe 的 contentWindow 与 requestId）：
  - 宿主 → 渲染器：`{ type: 'render', requestId, payload }`
  - 渲染器 → 宿主：`{ type: 'rendered', requestId, height }`（允许多次上报，图片
    加载后应再次上报新高度，宿主取最新值）
  - 渲染器 → 宿主：`{ type: 'error', requestId, message }`
- 超时 10s（`renderTimeoutMs`）或收到 error → 拆除 iframe，显示兜底卡片
  （「插件渲染器不可用」+ 可折叠原始 JSON）。
- 未启用 / 未声明 frontendEntry 的插件 → 直接渲染兜底卡片。

### 3. 页面上传安装 API

`POST /api/plugins/upload`（multipart，字段 `file`，复用 fflate 内存解压——与
skills/zip-import.ts 同一依赖先例）：

1. 校验：`.zip` 后缀；大小 ≤ `PLUGIN_UPLOAD_MAX_MB`（默认 20，环境变量可调）；
   解压后总大小同限。
2. zip-slip 防护：每个条目路径拒绝 `..`、绝对路径、反斜杠；条目数 ≤ 500。
3. 结构归一化：接受「单一根目录/plugin.json」或「根直接含 plugin.json」两种形态；
   根目录名不要求等于 manifest.name。
4. **先校验后落盘**：zip 内解析 plugin.json → `validateManifest`（现有 ajv）→ 目标
   目录强制为 `PLUGINS_DIR/<manifest.name>`；同名插件已存在 → 409
   `plugin_already_installed`。
5. 落盘后调用现有 `installFromDirectory(manifest.name)`（单事务、digest、能力注册）。
6. 错误码（沿用 plugins 路由错误映射表）：`plugins_dir_not_configured` /
   `manifest_invalid`（附 errors 数组）/ `plugin_already_installed` /
   `zip_invalid` / `upload_too_large`。

### 4. 可移植插件包（args 相对路径安装时改写）

`capabilities-mcp.ts` 注册时：`args` 中以 `./` 开头的项解析为
`resolve(pluginDir, arg)` 后入库（flag、绝对路径等其他形态原样保留）；manifest 文件
本身保持相对路径。效果：同一 ZIP 在 Windows dev（F:\...\plugins\）与 Docker
（/app/plugins/）通用。`command` 字段约定为可执行名（如 `node`），不改写。

### 5. community 启用政策

- 移除 loader 的 `community_enable_forbidden` 守卫（该规则为未来市场审核流预留，
  自托管场景由页面确认框承担信任决策）。
- demo 角色禁用一切插件写操作：沿用现有 demo 路由白名单（default-deny）机制，
  实现时核实 `PATCH /api/plugins/:id/enable` 不在白名单即可，无需新增逻辑。
- 前端：启用 `source === 'community'` 的插件前弹确认框，明示 `permissions`
  （network/childProcess/…）与各 MCP 的 `command`；official 保持直接启用。

### 6. PluginsPage UI

- 安装弹窗改为双模式：「目录安装」（现有）+「上传 ZIP」（file picker →
  `POST /api/plugins/upload` → 成功后刷新列表并提示可启用）。
- community 启用确认框（见上）。

### 7. web 去特化

- 删除 `apps/web/src/components/BilibiliVideoCard/`（index.tsx / parse.ts /
  index.test.tsx）。
- `extractBilibiliCardPayload` 泛化为 `extractCardPayload(raw)`：返回
  `{ pluginId, payload } | null`（匹配 `<pluginId>:card` 围栏语言；保留 MCP content
  包装解包逻辑），放入 PluginCardHost 模块（parse 子模块）。
- MarkdownRenderer 与 AgentTimeline 的拦截改为调用通用提取器 + PluginCardHost；
  两处现有测试改写为通用协议测试（fixture 插件 id，如 `demo-plugin:card`）。

### 8. bilibili-search 插件更新（示范插件）

- 新增 `frontend/index.html`：卡片渲染器（移植现 BilibiliVideoCard 视觉：2 列网格、
  16:9 封面、时长角标、标题两行截断、UP/播放/弹幕、hover 遮罩、整卡链接），实现
  render/rendered postMessage 协议，图片 `onload` 后二次上报高度。
- `plugin.json`：`provides.frontendEntry` 声明；MCP args 改相对
  `["server/index.mjs"]`。
- `server/index.ts` 转为 `server/index.mjs`（纯 JS + JSDoc，删除文件）：**理由**——
  Docker 基镜像为 node:20-slim，无法直跑 TS（type stripping 需 Node ≥22.6/24）；
  升基镜像涉及 better-sqlite3 原生模块重建风险，本期不升，插件侧适配。
- 工具输出围栏语言改为 `bilibili-search:card`；skill 文案同步（呈现逻辑不变）。

### 9. Docker 与运行时约束

- `docker/docker-compose.yml`：新增 `plugins` 卷挂载（如 `./docker/plugins:/app/plugins`）
  并设 `PLUGINS_DIR=/app/plugins`——上传的插件在容器重建后保留。
- README「Docker 部署」段补一句：插件经页面上传安装，持久化于该卷。
- 上传插件若携带 stdio MCP，其 `command` 必须在容器内可用（如 `node`）——确认框
  已明示 command，用户自负其责。

## 验收标准

1. 页面上传 bilibili-search ZIP → 安装成功 → 确认框启用 → 对话搜索 → 工具条目处
   渲染出沙箱卡片网格（封面正常加载、高度自适应）；宿主网络面板可见
   `GET /api/plugins/:id/frontend` 请求。
2. 同 ZIP 重复上传 → 409；含 `../` 条目的恶意 ZIP → 400 `zip_invalid`；超限 ZIP →
   400 `upload_too_large`；无 plugin.json → 400 `manifest_invalid`。
3. manifest 写相对 args `["server/index.mjs"]`，安装后 mcps 表内为绝对路径且 MCP
   可连接同步工具（本机验证；Docker 路径改写逻辑以单测覆盖）。
4. community 插件启用前出现确认框（含 permissions 与 command 信息）；demo token
   无法到达插件写接口。
5. `apps/web` 内无任何 bilibili 特化代码（`git grep -i bilibili apps/web/src` 为空，
   api 方法与 PluginsPage 通用逻辑除外）；旧 ` ```bilibili-card ` 历史块显示为代码块。
6. 全部门禁：server / web 测试全绿、lint 0、tsc 0；渲染器超时与 error 路径有单测
   （fake 消息/不回消息的渲染器 → 兜底卡片）。

## 实施阶段

1. **阶段 1（server）**：args 改写 → upload 路由 + 测试 → frontend 路由 → 移除
   community 守卫（含 demo 白名单核实）。
2. **阶段 2（web）**：PluginCardHost + 通用提取器 + 测试 → 两处拦截切换 → 删除
   BilibiliVideoCard。
3. **阶段 3（插件）**：index.mjs 转换 + renderer HTML + manifest/工具输出/skill 更新。
4. **阶段 4（UI/部署）**：PluginsPage 上传与确认框 → docker 卷与 README。
5. **阶段 5（e2e）**：卸载旧插件（DB 清理）→ 页面上传安装 → 全链路验收 + 截图。

## 开放问题决议记录

| 问题 | 决议 |
|---|---|
| 旧 `bilibili-card` 块兼容 | 不留垫片，回退代码块显示 |
| community 启用 | 非 demo 模式允许，强制确认框；demo 走现有路由白名单拒绝 |
| Docker node 版本 vs 插件 TS | 不升基镜像；插件 server 转纯 .mjs（Node 20+ 通用） |
| 渲染器资源形态 | 单文件自包含 index.html；多卡片类型由 payload `kind` 区分（渲染器内部分发，manifest 不变） |
| srcdoc vs 公开静态路由 | srcdoc（复用现有认证，无公开面） |

## 风险

- srcdoc + `sandbox="allow-scripts"` 下部分老浏览器对 srcdoc CSP meta 支持差异 →
  沙箱属性本身是硬边界，CSP meta 仅为纵深防御，风险可接受。
- 渲染器多次高度上报可能引起视觉跳动 → 宿主仅在高度差 > 8px 时更新样式。
- 上传插件本质是 admin 授权的远程代码执行（stdio command）→ 确认框明示 + demo 拒绝
  + 文档声明，属自托管产品的可接受边界。
