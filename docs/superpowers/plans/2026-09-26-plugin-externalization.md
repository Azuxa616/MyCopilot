# 插件外部化实施计划（Plugin Externalization）

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans。步骤用 `- [ ]` 追踪。
> **Spec:** `docs/superpowers/specs/2026-09-26-plugin-externalization-design.md`
> **分支：** `feat/settings-hub-bilibili-plugin`（追加提交，PR 随之更新）
> **提交约定：** 需用户授权默认已获（本轮用户指示"继续执行"含发 PR 语境）；仍只 add 本计划文件。

**目标一句话：** 插件 ZIP 页面上传安装 + 插件自带沙箱渲染器，web 仓库删除一切 bilibili 特化代码。

**文件总览：**

| 文件 | 动作 |
|---|---|
| `apps/server/src/plugin/upload.ts` + 测试 | 新建（fflate 解压/zip-slip/限额/归一化） |
| `apps/server/src/routes/plugins.ts` | 加 `POST /upload`、`GET /:id/frontend`；删 community 守卫映射 |
| `apps/server/src/plugin/loader.ts` | 移除 community_enable_forbidden |
| `apps/server/src/plugin/capabilities-mcp.ts` + 测试 | args 相对→绝对改写 |
| `apps/server/src/routes/__tests__/plugins.test.ts` | 新建（upload/frontend 路由测试） |
| `apps/web/src/api/real.ts` | +`fetchPluginFrontend`/`uploadPlugin` |
| `apps/web/src/components/PluginCardHost/index.tsx` + `parse.ts` + 测试 | 新建（通用沙箱渲染） |
| `apps/web/src/components/MarkdownRenderer/*`、`common/AgentTimeline*` | 切换通用拦截，测试改写 |
| `apps/web/src/components/BilibiliVideoCard/` | **删除** |
| `plugins/bilibili-search/server/index.mjs`（替代 index.ts）、`frontend/index.html`、`plugin.json`、skill、README | 插件外部化改造 |
| `apps/web/src/views/settings/PluginsPage.tsx` | 上传模式 + community 确认框 |
| `docker/docker-compose.yml`、README | plugins 卷 + 文档 |

**协议关键码（实现基准）：**

```ts
// 通用围栏语言：<pluginId>:card（PluginCardHost/parse.ts）
const CARD_LANG = /^([a-z][a-z0-9-]{1,63}):card$/;
// postMessage：render{requestId,payload} / rendered{requestId,height}(可多次,Δ>8px 才应用) /
// error{requestId,message} / open{requestId,url}(宿主校验 https:// 后 window.open)
// 沙箱：sandbox="allow-scripts" srcDoc；超时 10000ms → 兜底卡片（含可折叠原始 JSON）
```

---

### Task 1: server — capabilities-mcp args 改写（TDD）
1. [ ] 测试先行：`capabilities-mcp.test.ts` 加用例——manifest args `["server/index.mjs"]`，install 后 mcps 行 args 为 `resolve(pluginDir, "server/index.mjs")` 绝对路径；绝对路径 args 原样保留
2. [ ] 实现：register 内 `args: serverDef.args?.map(a => isAbsolute(a) ? a : resolve(pluginDir, a))`（import isAbsolute/resolve）
3. [ ] `pnpm --filter server test` 绿 → commit `fix(server): resolve relative MCP args against plugin dir on install`

### Task 2: server — 上传安装（upload.ts + 路由，TDD）
1. [ ] 新建 `plugin/upload.ts`：`extractPluginZip(buffer): { ok, error?, manifest?, files?: Map<path,Buffer> }`（fail-soft；fflate unzipSync；zip-slip/条目数 500/总大小 PLUGIN_UPLOAD_MAX_MB 默认 20；单一根目录或根直含 plugin.json 归一化；plugin.json 解析 + validateManifest）
2. [ ] 路由 `POST /upload`：multipart `file` → extract → 409 `plugin_already_installed`（getPlugin 存在）→ 逐条目写 `PLUGINS_DIR/<manifest.name>/` → `installFromDirectory(manifest.name)`；错误码并入 CODE_TO_STATUS（zip_invalid/upload_too_large/manifest_invalid/plugin_already_installed）
3. [ ] 新建 `routes/__tests__/plugins.test.ts`：成功流（含落盘断言 + 装载状态）、恶意 `../` → 400、无 manifest → 400、重装 → 409（mock loader 或真库——沿用 capabilities 测试的真库模式，mkdtemp PLUGINS_DIR）
4. [ ] 门禁 → commit `feat(server): add plugin ZIP upload install with zip-slip protection`

### Task 3: server — frontend 路由 + community 政策
1. [ ] `GET /:id/frontend`：getPlugin → 404；未 enabled → 409 `plugin_not_enabled`；无 frontendEntry → 404；读 `PLUGINS_DIR/<directory>/frontend/index.html`（>1MB → 400）；`successResponse(c, html)`
2. [ ] loader 移除 `community_enable_forbidden` 抛错；routes 错误表删除该映射；grep 测试引用并修正
3. [ ] 核实 demo 白名单：读 tokenAuth 中间件确认 PATCH /api/plugins 默认拒绝（记录到 spec 旁注，不扩测试）
4. [ ] 测试：frontend 三态（enabled+声明→200 html / 未启用→409 / 未声明→404）→ commit `feat(server): serve plugin frontend entry and allow community enable`

### Task 4: web — PluginCardHost + 通用提取器（TDD）
1. [ ] `parse.ts`：`extractCardPayload(raw): { pluginId, payload } | null`（MCP 包装解包 + `CARD_LANG` 围栏匹配；单测覆盖包装/纯文本/旧 bilibili-card 不匹配）
2. [ ] `index.tsx`：PluginCardHost（html 模块级 Map 缓存 + iframe + postMessage 协议 + 高度 Δ>8px + 10s fake-timer 超时 → 兜底卡片；`open` 消息校验 https 后 window.open）
3. [ ] 测试：mock `../../../api`（fetchPluginFrontend）；MessageEvent(source=iframe.contentWindow) 模拟 rendered/error；vi.useFakeTimers 模拟超时兜底
4. [ ] commit `feat(web): add generic PluginCardHost with sandboxed plugin renderers`

### Task 5: web — 拦截切换 + 删 BilibiliVideoCard
1. [ ] MarkdownRenderer：code 组件 `extractLanguage` 匹配 `:card` 后缀 → PluginCardHost；PreComponent 直通条件同步；`childrenToText` 不变；测试改 fixture `demo-plugin:card`
2. [ ] AgentTimeline：ToolEntry 用 `extractCardPayload` → PluginCardHost（保留参数区、自动展开语义）；测试改写
3. [ ] 删除 `components/BilibiliVideoCard/`；`git grep -ri bilibili apps/web/src` 仅剩 PluginsPage 通用文案与 api 方法名合规（无组件/渲染特化）
4. [ ] 门禁 → commit `refactor(web): route card fences to PluginCardHost, drop BilibiliVideoCard`

### Task 6: 插件 — .mjs + 渲染器 + manifest
1. [ ] `server/index.ts` → `server/index.mjs`（纯 JS+JSDoc，逻辑零变更；stdio 驱动实测搜索仍过）
2. [ ] `frontend/index.html`：单文件渲染器（CSP+referrer meta；render→网格 DOM（移植卡片视觉）；rendered+图片 load 后再报高度；点击卡片 postMessage open）
3. [ ] `plugin.json`：v0.2.0、args `["server/index.mjs"]`、`provides.frontendEntry`；工具输出 lang → `bilibili-search:card`；skill/README 同步
4. [ ] commit `feat(plugins): externalize bilibili-search renderer and ship portable mcp server`

### Task 7: PluginsPage 上传 + 确认框
1. [ ] real.ts +`uploadPlugin(file)`（FormData 60s）；PluginsPage 弹窗双模式（目录/上传 ZIP）
2. [ ] enable community 前确认框：列 permissions 与 mcpServers command（official 直启）
3. [ ] 测试（PluginsPage.test 补上传 mock 用例）→ commit `feat(web): add plugin upload install and community enable confirmation`

### Task 8: docker + README
1. [ ] compose：`./docker/plugins:/app/plugins` 卷 + `PLUGINS_DIR=/app/plugins`
2. [ ] README Docker 段一句说明 → commit `docs(docker): persist plugins volume for page-installed plugins`

### Task 9: e2e 验收
1. [ ] DB 清理旧 bilibili-search 四表行 → 服务重启
2. [ ] 打包 ZIP（PowerShell Compress-Archive plugins/bilibili-search → temp）→ **浏览器**：上传安装 → 确认（official 直启）→ 新会话搜索 → 沙箱卡片渲染（封面/高度/点击 open）→ 截图
3. [ ] `git grep -i bilibili apps/web/src` 为空验证；三门禁全绿
4. [ ] commit 计划文件 `docs(superpowers): add plugin externalization plan` → push（ssh.github.com:443）

## Self-Review
- Spec 覆盖：协议§1→T4/T5；沙箱§2→T4；上传§3→T2；可移植§4→T1；政策§5→T3/T7；UI§6→T7；去特化§7→T5；插件§8→T6；docker§9→T8；验收 1-6→T2/T3/T4/T9。无缺口。
- 协议一致性：CARD_LANG/消息类型在 T4 定义、T5/T6 消费一致；`bilibili-search:card` 由 T6 产出、T9 验收。
- 占位扫描：无 TBD；"核实 demo 白名单"为读代码核实项非实现占位。
