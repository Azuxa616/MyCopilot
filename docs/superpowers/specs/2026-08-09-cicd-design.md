# CI/CD 设计规格 — MyCopilot

**日期:** 2026-08-09
**状态:** 已批准（待 spec 落地复核）
**范围:** GitHub Actions CI（lint / typecheck / 单元+集成测试 / 构建）+ Docker 镜像构建与推送（GHCR）

---

## 1. 目标与非目标

### 目标
- 在 `push` 到 `main` / `dev` 以及所有指向这两条分支的 `pull_request` 上自动运行：
  - ESLint 检查
  - TypeScript 类型检查（typecheck）
  - 单元测试与集成测试（覆盖 web / server / shared 三个 workspace）
  - 全量构建验证（`pnpm build`）
  - Docker 镜像构建（PR 仅构建校验；push 时推送至 GHCR）
- 提供快速失败反馈（lint/typecheck 在 ~30s 内出结果）。
- 三个 workspace 的测试并行执行，互不阻塞。
- Docker 推送仅使用内置 `GITHUB_TOKEN`，无需额外密钥。

### 非目标（YAGNI）
- 不做 Node 22/24 矩阵（仅 Node 20 LTS）。
- 不做浏览器 E2E（无 Playwright 现状；集成测试已覆盖逻辑接线）。
- 不做自动部署到服务器。
- 不做 release / changelog 自动化。
- 不做 Dependabot、Codecov 上传（后续可加）。

---

## 2. 工作流文件总览

在 `.github/workflows/` 下新增四个文件，触发条件统一：

```yaml
on:
  push:
    branches: [main, dev]
  pull_request:
    branches: [main, dev]
```

| 文件 | 职责 | 预计耗时 |
|---|---|---|
| `lint.yml` | ESLint + typecheck | ~30s |
| `test.yml` | 单元 + 集成测试（matrix: web/server/shared） | ~1-2min |
| `build.yml` | 全量构建产物验证 | ~1min |
| `docker.yml` | Docker 镜像构建；push 事件推送 GHCR | ~2-3min |

**并发控制（四个文件统一）：**
```yaml
concurrency:
  group: ${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```
作用：同一工作流 + 同一分支的新 run 自动取消旧 run，节省额度。

---

## 3. 各工作流详细设计

### 3.1 `lint.yml` — 快速反馈门

- **Job:** `lint`，runs-on `ubuntu-latest`，Node 20
- **Steps:**
  1. `actions/checkout@v4`
  2. `pnpm/action-setup@v4` with `version: 10.22.0`
  3. `actions/setup-node@v4` with `node-version: '20'`, `cache: 'pnpm'`
  4. `pnpm install --frozen-lockfile`
  5. `pnpm lint`
  6. `pnpm typecheck`
- **Permissions:** `contents: read`
- **目的：** style/type 错误在 ~30s 内反馈，不等待完整测试。

### 3.2 `test.yml` — 测试门（3 个并行 job）

- **Strategy matrix:** `workspace: [web, server, shared]`
- **Job:** `test`（matrix 展开），runs-on `ubuntu-latest`，Node 20
- **Steps:**
  1. checkout / pnpm / node setup（同上）
  2. `pnpm install --frozen-lockfile`
  3. `pnpm --filter <workspace> test`
- **集成测试可靠性：**
  - `apps/server/test/integration/agent-loop-e2e.test.ts` 与 `step-b-e2e.test.ts` 在模块边界 mock 了 LLM 流、SQLite（`repo/message`、`repo/tool`、`repo/mcp`）、MCP 子进程、确认存储 —— **CI 无需任何 API key 或外部服务即可通过**。
  - `apps/server/src/attachment/__tests__/parser.integration.test.ts` 使用 `mammoth` 包自带的 fixture（`mammoth/test/test-data/single-paragraph.docx`），无外部文件依赖。
- **Permissions:** `contents: read`
- **后续可选：** 失败时上传 coverage 制品（本次不实现）。

### 3.3 `build.yml` — 构建验证门

- **Job:** `build`，runs-on `ubuntu-latest`，Node 20
- **Steps:**
  1. checkout / pnpm / node setup
  2. `pnpm install --frozen-lockfile`
  3. `pnpm build`
- **目的：** 验证 `packages/shared → web` 的跨 workspace 构建链能产出产物；隐式捕获 lint 漏掉的类型/解析错误。
- **Permissions:** `contents: read`

### 3.4 `docker.yml` — 镜像构建与推送

- **Job:** `docker`，runs-on `ubuntu-latest`
- **Permissions:** `contents: read`, `packages: write`
- **Steps:**
  1. `actions/checkout@v4`
  2. `docker/setup-buildx-action@v3`（启用构建缓存）
  3. `docker/login-action@v3` 登录 `ghcr.io`，**仅当** `github.event_name == 'push'` 时执行（PR 跳过登录）
     - `with: registry: ghcr.io, username: ${{ github.actor }}, password: ${{ secrets.GITHUB_TOKEN }}`
  4. `docker/build-push-action@v6`：
     - `context: .`
     - `file: docker/Dockerfile`
     - `push: ${{ github.event_name == 'push' }}`（PR 仅构建校验，不推送）
     - `tags:` 见下方标签策略
     - `cache-from: type=gha`
     - `cache-to: type=gha,mode=max`
- **标签策略：**
  ```
  ghcr.io/<owner>/my-copilot:latest        # 仅 main 分支
  ghcr.io/<owner>/my-copilot:dev           # dev 分支
  ghcr.io/<owner>/my-copilot:sha-<short>   # 可追溯性，每次 push
  ```
  使用 `docker/metadata-action@v5` 自动生成，避免手写条件。
- **关键：** GHCR 使用内置 `GITHUB_TOKEN`，**无需配置任何额外 secret**。

---

## 4. 关键技术决策

| 关注点 | 决策 | 理由 |
|---|---|---|
| pnpm 版本 | `pnpm/action-setup@v4`，`version: 10.22.0` | 与 `packageManager` 字段一致；确定性安装 |
| Node 版本 | `actions/setup-node@v4`，`node-version: '20'`，`cache: 'pnpm'` | LTS，README 声明 20+；setup-node 内置 pnpm store 缓存 |
| 安装标志 | `pnpm install --frozen-lockfile` | lockfile 已存在；CI 必须在 lockfile 漂移时失败 |
| 原生模块 | 无需额外步骤 | `better-sqlite3@12` 为 Node 20 / linux-x64 提供预构建；`onlyBuiltDependencies` 已在根 package.json 配置 |
| 运行器 | 全部 `ubuntu-latest` | 最快、免费额度最高；Windows/macOS 不增加价值 |
| 权限 | workflow 级默认 `contents: read`；docker.yml 额外 `packages: write` | 最小权限原则 |
| Docker 多架构 | 不做 | 仅 amd64 满足当前需求 |

---

## 5. 风险与遗留问题

### 5.1 typecheck 覆盖不完整（待修复）

**问题：** 根 `typecheck` 脚本为 `pnpm -r run tsc --noEmit`。但只有 `apps/web` 有 `tsc` 脚本（`"tsc": "tsc --noEmit"`）；`apps/server` 与 `packages/shared` 仅有 `build: tsc`，无 `tsc` 脚本。`pnpm -r run tsc` 会静默跳过没有该脚本的 workspace —— **server 与 shared 当前未被根命令类型检查**。

**修复（本工作范围内）：**
- `apps/server/package.json` 新增 `"tsc": "tsc --noEmit"`
- `packages/shared/package.json` 新增 `"tsc": "tsc --noEmit"`

修复后，根 `pnpm typecheck` 才会真正覆盖全部 workspace。

### 5.2 集成测试边界（已验证，无风险）

集成测试在模块边界 mock 全部外部依赖（见 3.2），CI 无需任何环境变量或密钥。

---

## 6. 交付物清单

| # | 文件 | 类型 | 预计行数 |
|---|---|---|---|
| 1 | `.github/workflows/lint.yml` | 新建 | ~40 |
| 2 | `.github/workflows/test.yml` | 新建 | ~50 |
| 3 | `.github/workflows/build.yml` | 新建 | ~40 |
| 4 | `.github/workflows/docker.yml` | 新建 | ~55 |
| 5 | `apps/server/package.json` | 修改（+`tsc` script） | +1 行 |
| 6 | `packages/shared/package.json` | 修改（+`tsc` script） | +1 行 |

---

## 7. 验证标准（完成定义）

实施完成后，以下条件必须全部满足：

1. 四个 workflow 文件语法正确（YAML 合法，action 版本 pin 到主版本号）。
2. `apps/server/package.json` 与 `packages/shared/package.json` 含 `tsc` 脚本。
3. 本地手动验证根命令可运行：
   - `pnpm lint`
   - `pnpm typecheck`（修复后覆盖全部 workspace）
   - `pnpm test`
   - `pnpm build`
4. 推送至任一触发分支后，GitHub Actions UI 中四个 workflow 全部出现并（在代码本身无错误的前提下）绿色通过。
5. PR 打开时，四个 workflow 均触发；`docker.yml` 的 push 步骤被正确跳过（仅构建）。
6. push 到 main 后，`ghcr.io/<owner>/my-copilot:latest` 与 `:sha-<short>` 镜像可拉取。

---

## 8. 后续可选增强（不在本次范围）

- Dependabot `.github/dependabot.yml`（监控 actions 与 npm 依赖）
- Codecov / coverage 上传
- Node 22 加入矩阵（当需要升级时）
- release drafter / changelog 自动化
- 分支保护规则（将这些 check 设为 required）—— 需在 GitHub 仓库设置中手动配置，非代码改动
