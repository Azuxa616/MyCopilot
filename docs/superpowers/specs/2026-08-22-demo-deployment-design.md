# MyCopilot 演示版安全部署设计

- **日期**：2026-08-22
- **状态**：已确认（待实施）
- **背景**：作为简历作品提供可公开试用的链接，同时保护服务器与自用实例安全

## 动机

把 MyCopilot 作为简历作品对外开放试用链接时，当前架构存在无法接受的安全风险：

1. **单 token 全权限**：`tokenAuthMiddleware` 仅校验一个共享 token（存于 SQLite `config` 表），任何持有者都拥有全部管理权限——拿到 token 即等于拿到管理员。
2. **API key 明文回传**：`GET /api/providers` 将 Provider 的 `apiKey` 原样返回给任何持 token 者。
3. **高危攻击面**：访客可配置 stdio MCP 服务（可执行本地命令，构成 RCE）；内置 `http_fetch` 等网络工具可探测同机内网服务（SSRF 面）。
4. **无实例隔离**：演示与自用若共用实例，访客可直接读取自用者的真实会话与真实 API key。

结论：纯部署隔离（不改代码）不可行，必须做少量服务端降权改造 + 双实例部署隔离（即方案 B）。

## 目标

- 面试官打开链接、输入公开演示口令后，30 秒内能与 AI 真实对话。
- 演示实例即使被完全攻破，也不影响自用实例与宿主机安全。
- 自用版本不暴露公网（本机 + Tailscale 访问）。
- 演示数据自洁：访客聊天内容最多留存 24 小时。
- LLM 费用可控（专用低额度 key + 供应商侧限额 + 反代限流）。

## 非目标

- 多用户账号体系。
- 为自用版本提供公网访问入口。
- 演示会话的访客间隔离（每日重置已覆盖该风险，见"已知取舍"）。
- 简历链接自动填充 token（已明确不做）。
- 预置精选示例会话（本期不做，可作为后续增强）。

## 1. 部署拓扑与实例隔离

```
境内服务器（已备案域名 example.com）
├── nginx（80/443，TLS 复用已有证书）
│     └── demo.example.com → 127.0.0.1:3100（演示实例，唯一公网入口）
├── mycopilot-demo 容器（DEMO_MODE=1，独立 bridge 网络，独立数据卷，127.0.0.1:3100）
├── mycopilot-self 容器（自用版，127.0.0.1:3000，不进 nginx，公网不可达）
└── 自用访问：服务器本机 + Tailscale（手机/外出场景）
```

关键决策：

- **自用版彻底不暴露公网**。单 token 全权限架构下任何泄露即全量泄露（真实 API key 明文存于库中），自用容器只绑定 `127.0.0.1`。若现有 docker-compose 端口映射为全接口，需改为 `127.0.0.1:3000:3000`。
- **两个 compose 项目 = 两个独立 bridge 网络**。Docker 默认禁止跨 bridge 网络互访，演示容器即使被攻破也摸不到自用实例；数据卷与 SQLite 完全分离。
- **复用现有单容器模式**：`SERVER_PUBLIC_DIR` 由 server 托管 web 构建产物，演示实例不需要独立的前端部署。
- 新增 `docker/docker-compose.demo.yml`（project name `mycopilot-demo`）承载演示实例配置。

## 2. DEMO_MODE 双 token 降权（核心改造）

新增环境变量 `DEMO_MODE` 与 `DEMO_TOKEN`，`tokenAuthMiddleware` 升级为角色分级：

| Token | 角色 | 来源 | 权限 |
|---|---|---|---|
| `AUTH_TOKEN` | admin | DB config 表（现状不变） | 全部路由 |
| `DEMO_TOKEN` | demo | 环境变量（每次启动读取，不入库） | 仅白名单路由 |

### 实现要点

- `config.ts` 新增 `demoMode`（`DEMO_MODE === '1'`）与 `demoToken` 字段。
- `tokenAuthMiddleware` 认证通过后将角色写入 Hono context（`admin` | `demo`）。
- demo 角色经独立的路由白名单校验：不匹配返回 403。白名单为方法级精确匹配（`Map<path, Set<method>>`），`/api/sessions` 使用前缀匹配。
- `DEMO_MODE=1` 但未设置 `DEMO_TOKEN` → 启动 fail-fast 报错。
- **默认拒绝**：白名单之外的新路由自动落入 admin-only，安全默认不需要维护黑名单。

### Demo 白名单

| 路由 | 方法 | 用途 |
|---|---|---|
| `/api/models` | GET | 聊天页模型下拉框 |
| `/api/sessions` | GET, POST | 会话列表/新建 |
| `/api/sessions/:id` | GET, PATCH, DELETE | 会话详情/改名/删除 |
| `/api/sessions/:id/messages` | GET | 消息历史 |
| `/api/sessions/:id/summaries` | GET | 会话摘要 |
| `/api/sessions/:sessionId/messages` | POST | 发消息（聊天 + SSE 流） |
| `/api/sessions/:sessionId/messages/stop` | POST | 停止生成 |
| `/api/sessions/:sessionId/messages/:id` | DELETE | 删除单条消息 |
| `/api/jobs` | GET | Agent 后台任务列表 |
| `/api/jobs/stream` | GET | 任务进度 SSE |
| `/api/jobs/:id` | GET | 单任务详情 |
| `/api/jobs/:id/cancel` | POST | 取消任务 |
| `/api/auth/me`（新增） | GET | 返回 `{ role, demoMode }`，前端据此适配 UI |

### Demo 一律 403

`/api/providers*`（含嵌套的 `/api/providers/:providerId/models` 增删改）、`/api/tools`、`/api/skills`、`/api/mcps`、`/api/plugins`、`/api/debug`（后者本就仅在 `MYCOPILOT_DEBUG=1` 时挂载）。

### 前端适配

认证弹窗提交后前端调用 `GET /api/auth/me` 缓存角色；`role === 'demo'` 时隐藏 Settings 导航入口（避免面试官点开设置页看到一片 403 报错）。不改其余页面逻辑。

## 3. API Key 脱敏（两种模式都生效）

- **掩码规则**：`apiKey` 长度 > 8 → 前 4 位 + `****` + 后 4 位；否则整体 `****`。
- **生效面**：`/api/providers` 的列表与详情响应统一在路由层脱敏（POST/PATCH 的响应同样处理）。
- **PATCH 语义**：提交的 `apiKey` 包含 `****`（掩码回传）或为空串时，视为"不修改该字段"，保留原 key。API key 字符集不含 `****`，无歧义。
- **动机**：纵深防御——即使 admin token 泄露，真实 key 也不经 API 外流。这是本项目作为简历作品本身应体现的安全素养。
- `POST /api/providers/:providerId/test` 响应不含 key，无需处理。

## 4. 演示实例工具与滥用防线

- **DEMO_MODE 工具过滤**：Agent 提示词组装时，`demoMode` 下仅注入非网络类且 `safetyLevel === 'safe'` 的内置工具（计算、编码/解码、哈希、JSON 格式化、UUID、当前时间）；`http_fetch`、网页搜索等网络工具一律排除（SSRF 面）。具体名单在实施时以 `builtinExecutors` 注册表为准，用白名单常量而非黑名单。
- **MCP / Skills / Plugins**：演示库不配置 + 路由 403，双保险。
- **LLM 费用**：演示实例使用专用低额度 key（如 GLM 免费档或 DeepSeek 低额充值），并在供应商控制台设月度上限兜底。
- **nginx 限流**（`limit_req_zone`）：
  - `/api/` 每 IP 30 req/min（burst 10）
  - `POST /api/sessions/*/messages` 每 IP 10 req/min
  - `client_max_body_size 3m`
  - `limit_conn` 防 SSE 连接洪水
- **附件上限**：演示实例 `MAX_ATTACHMENT_SIZE_MB=2`（现有环境变量，零代码）。
- **SSE 穿透**：nginx 对 SSE 端点设置 `proxy_buffering off` 与足够长的 `proxy_read_timeout`，否则聊天流式输出会被缓冲卡死。

## 5. 演示数据播种与每日重置

### 播种

- **触发条件**：`demoMode` 且 providers 表为空（幂等，存在即跳过）。
- **数据来源**（环境变量）：`DEMO_PROVIDER_NAME`、`DEMO_PROVIDER_BASE_URL`、`DEMO_PROVIDER_API_KEY`、`DEMO_PROVIDER_MODEL`。
- **动作**：创建 enabled 的 Provider 与 Model。
- **Token 稳定性**：`DEMO_TOKEN` 直接来自环境变量；演示实例必须显式设置 `AUTH_TOKEN` 环境变量（首次启动播种进新建的 DB，重置后重新播种为同一值）——两个 token 在每日重置后均保持不变。

### 每日重置

- `docker/reset-demo.sh`：`docker compose -p mycopilot-demo down` → 清空演示数据卷 → `up -d`（启动播种自动执行）。
- host crontab：`30 4 * * *` 每日执行。
- 效果：访客聊天内容最多存活 24 小时（隐私 + 自洁），演示库不会被垃圾数据填满，链接长期可用。

## 6. 测试与验收

### 单元测试

- 双 token 中间件：admin 全通、demo 白名单通、demo 越权 403、错误 token 401、`DEMO_MODE=1` 未设 `DEMO_TOKEN` 启动报错。
- 掩码往返：mask 显示 → PATCH 回传掩码 → 原 key 不变（`testProvider` 仍成功）。
- demo 工具过滤：`demoMode` 下网络工具不进入提示词。

### 集成测试

`DEMO_MODE=1` 启动 app：demo token 走通 sessions/messages/jobs 聊天链路；providers/tools/skills/mcps/plugins 全部 403；admin token 全通；播种幂等。

### 手动验收

1. 简历链接打开 → 输入 demo token → 30 秒内能聊上天（流式输出正常，无 nginx 缓冲卡顿）。
2. demo 角色下设置页入口不可见；直接访问 `/api/providers` 返回 403。
3. 连续快速发消息触发限流（429）。
4. 手动执行 `reset-demo.sh` 后链接仍可用、播种完成。
5. 自用实例仅 `127.0.0.1` 与 Tailscale 可达，公网扫描 3000/3100 端口不通（3100 仅 nginx 内部转发）。

## 已知取舍

- **访客间会话可见**：演示会话无用户归属，访客 A 理论上能看到访客 B 的会话列表。在演示库 + 每日重置的前提下可接受；若介意可将 cron 调密（如每 6 小时）。
- **demo token 公开 = 泄露面公开**：但权限仅限聊天 + 演示库写操作，风险闭合。
- **限流可能误伤**：阈值（30/10 req/min）可在 nginx 配置中调整。

## 开放问题

无。
