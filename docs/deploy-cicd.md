# CI/CD 与部署总览

自动化流水线：push → GitHub Actions CI（lint/typecheck/test/build）→ 合并 main → 构建镜像推 GHCR → 服务器 systemd timer 轮询拉取 → 双泳道滚动更新 + 健康检查 + 失败自动回滚。

## 流水线全景

```
开发者 push 分支
   │
   ▼
GitHub Actions: CI (.github/workflows/ci.yml)
   lint + typecheck + test + build（PR 门禁）
   │
   ▼ 合并到 main
GitHub Actions: Release (.github/workflows/release.yml)
   docker build → push ghcr.io/azuxa616/my-copilot:{latest, sha-<commit>}
   │
   ▼
服务器 systemd timer（每 5 分钟，mycopilot-deploy.timer）
   docker/deploy.sh:
     1. docker pull 最新镜像
     2. digest 无变化 → 跳过（幂等）
     3. 旧镜像标记 my-copilot:rollback
     4. 先更新 personal 泳道 → 健康检查 → 再更新 demo 泳道 → 健康检查
     5. 任一失败 → 自动回滚 rollback 标签
```

## 仓库文件清单

| 文件 | 作用 |
|---|---|
| `.github/workflows/ci.yml` | PR/push CI 门禁 |
| `.github/workflows/release.yml` | main 构建+推送 GHCR 镜像 |
| `docker/Dockerfile` | 多阶段构建（不变） |
| `docker/docker-compose.yml` | 自用泳道（project `mycopilot`，127.0.0.1:3000） |
| `docker/docker-compose.demo.yml` | 演示泳道（project `mycopilot-demo`，127.0.0.1:3100，DEMO_MODE） |
| `docker/deploy.sh` | 服务器拉取+滚动更新+自动回滚 |
| `docker/rollback.sh` | 手动回滚 |
| `docker/mycopilot-deploy.service` / `.timer` | systemd 定时部署单元 |
| `docker/.env.personal.example` | 自用泳道环境变量模板 |
| `docker/.env.demo.example` | 演示泳道环境变量模板 |

## 首次部署（服务器）

1. **准备 env 文件**（含密钥，永不提交）：
   ```bash
   cd docker
   cp .env.personal.example .env.personal   # 填 AUTH_TOKEN=openssl rand -hex 32
   cp .env.demo.example .env.demo          # 填 DEMO_TOKEN、DEMO_PROVIDER_* 等
   ```
2. **安装 timer**：
   ```bash
   sudo cp mycopilot-deploy.service mycopilot-deploy.timer /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now mycopilot-deploy.timer
   ```

   > timer 的 service 调用 `/home/ubuntu/MyCopilot/docker/deploy.sh`。若仓库克隆在别的路径，修改 service 中 `WorkingDirectory` 与 `ExecStart`。
3. **启动方式二选一**：
   - **A. GHCR 拉取**（需 CI 已至少成功推送过一次镜像）：timer 每 5 分钟自动执行 deploy.sh，首次可手动触发：
     ```bash
     sudo systemctl start mycopilot-deploy.service
     journalctl -u mycopilot-deploy -f
     ```
   - **B. 本地构建**（首次部署 / GHCR 不可达时的回退路径）：
     ```bash
     docker/deploy.sh my-copilot:local          # 需先 docker build -t my-copilot:local -f docker/Dockerfile .
     ```
     deploy.sh 会打 `my-copilot:latest` 别名并滚动更新双泳道。
4. **验证**：
   ```bash
   curl http://127.0.0.1:3000/api/health   # personal 泳道
   curl http://127.0.泳道3100/api/health  # demo 泳道
   docker ps --format '{{.Names}}\t{{.Status}}'
   ```

4. **nginx 演示站点**：见 `docs/deploy-demo.md`（限流、SSE 不缓冲配置不变）。
5. **每日重置**：`docker/reset-demo.sh` + crontab（见 `docs/deploy-demo.md`）。

## 日常运维

| 操作 | 命令 |
|---|---|
| 查看部署日志 | `journalctl -u mycopilot-deploy -f` |
| 手动触发部署 | `sudo systemctl start mycopilot-deploy.service` |
| 手动回滚 | `docker/rollback.sh` |
| 查看当前版本 | `docker inspect my-copilot:latest --format '{{index .RepoDigests 0}}'` |
| 停用自动部署 | `sudo systemctl disable --now mycopilot-deploy.timer` |

## 故障排查

| 现象 | 排查 |
|---|---|
| deploy.sh 报镜像拉取失败 | `docker pull ghcr.io/azuxa616/my-copilot:latest` 手动验证；检查 GitHub Actions Release 工作流是否成功、仓库是否 private（private 需 `docker login ghcr.io`） |
| 健康检查超时触发回滚 | `docker compose -p mycopilot logs` 看容器日志；常见：AUTH_TOKEN 未设置、DATA_DIR 权限 |
| demo 泳道总失败 | `.env.demo` 缺 `DEMO_PROVIDER_*` 必填项（compose 会直接报错） |
| timer 不跑 | `systemctl list-timers | grep mycopilot`；`systemctl status mycopilot-deploy.service` |
| 更新未生效 | deploy.sh 是幂等的：digest 相同会跳过；确认 GHCR latest 已变（Release 工作流） |
| 想临时禁用自动更新 | `sudo systemctl stop mycopilot-deploy.timer` |

## 安全说明

- 两泳道容器均以非 root `app` 用户运行，数据卷宿主路径不同（`data/` vs `demo-data/`）
- personal 泳道不进 nginx，仅回环 + 隧道访问
- GHCR 公开镜像匿名可拉，服务器**无需**存 GitHub 凭证
- 若仓库转 private：在服务器 `docker login ghcr.io`（fine-grained PAT, 只读 packages）即可，其余不变
