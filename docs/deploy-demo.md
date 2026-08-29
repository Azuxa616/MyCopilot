# 演示版部署手册

面向简历演示链接的上线与日常运维。设计依据：`docs/superpowers/specs/2026-08-22-demo-deployment-design.md`。

## 拓扑

- `demo.<域名>` → nginx(443) → `127.0.0.1:3100` → mycopilot-demo 容器（DEMO_MODE=1）
- 自用实例 → `127.0.0.1:3000`，不进 nginx；外出经 Tailscale/SSH 隧道
- 两个 compose project 独立网络与数据卷，互不可达

## 首次上线步骤

1. 构建镜像并启动两实例：
   ```bash
   cd docker
   cp .env.demo.example .env.demo   # 填入真实值
   docker compose up -d                          # 自用（project: docker 自身目录名）
   docker compose -f docker-compose.demo.yml --env-file .env.demo up -d
   ```
2. 验证：`curl http://127.0.0.1:3100/api/health` 返回 ok。
3. nginx 配置（见下节），`nginx -t && systemctl reload nginx`。
4. DNS：`demo.<域名>` A 记录指向服务器。
5. 防火墙：仅放行 80/443；确认 3000/3100 未对公网开放（`ss -tlnp | grep -E '3000|3100'` 应只出现在 127.0.0.1）。

## nginx 站点配置

`limit_req_zone` / `limit_conn_zone` 必须放在 `http {}` 级（如 `/etc/nginx/conf.d/demo-ratelimit.conf`）：

```nginx
limit_req_zone $binary_remote_addr zone=demo_api:10m rate=30r/m;
limit_req_zone $binary_remote_addr zone=demo_chat:10m rate=10r/m;
limit_conn_zone $binary_remote_addr zone=demo_conn:10m;
```

站点（`/etc/nginx/sites-available/demo.example.com.conf`，按发行版放入对应目录）：

```nginx
server {
    listen 443 ssl;
    server_name demo.example.com;

    # 复用已有证书或 acme.sh 签发
    # ssl_certificate     /path/to/fullchain.pem;
    # ssl_certificate_key /path/to/privkey.pem;

    client_max_body_size 3m;

    # 聊天 + 会话 SSE：更严限流，关闭缓冲
    location /api/sessions/ {
        limit_req zone=demo_chat burst=5 nodelay;
        limit_conn demo_conn 10;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }

    # 任务进度 SSE
    location /api/jobs/stream {
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_read_timeout 3600s;
    }

    location /api/ {
        limit_req zone=demo_api burst=10 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:3100;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
    }

    location / {
        proxy_pass http://127.0.0.1:3100;
        proxy_set_header Host $host;
    }
}

server {
    listen 80;
    server_name demo.example.com;
    return 301 https://$host$request_uri;
}
```

## 每日重置

宿主机 crontab（`crontab -e`）：

```
30 4 * * * /path/to/MyCopilot/docker/reset-demo.sh >> /var/log/mycopilot-demo-reset.log 2>&1
```

效果：访客数据最多存活 24 小时；演示 Provider 每次重置后自动重新播种，token 不变。

## 评估快照更新

演示站评估页（`/evaluations`）的指标与场景列表来自随仓库分发的快照 `apps/server/src/eval/snapshot.json`（打进镜像按请求读取）。修改 agent 相关代码后，按以下流程刷新快照：

1. 本地重新生成快照：
   ```bash
   pnpm eval -- --report
   ```
2. 检查并提交 `apps/server/src/eval/snapshot.json`（提交惯例：`chore(eval): 更新评估快照`）。
3. 重建镜像并重启演示实例：
   ```bash
   pnpm docker:build
   docker compose -f docker-compose.demo.yml --env-file .env.demo up -d
   ```

说明：评估页的「现场回放」不依赖快照，它以子进程方式用当前镜像内的代码确定性重放场景（独立临时数据库、不调用真实模型、不触碰主库），因此回放结果与快照数值存在差异是预期行为。每日重置只清数据卷，不影响快照与回放。

## 上线后验收清单

- [ ] 打开 `https://demo.<域名>`，输入 DEMO_TOKEN，30 秒内能流式对话
- [ ] demo 角色看不到侧栏"设置"区块
- [ ] 手动 `curl -H "Authorization: Bearer <DEMO_TOKEN>" https://demo.<域名>/api/providers` 返回 403
- [ ] 快速连发消息触发 429
- [ ] 执行 `docker/reset-demo.sh` 后链接仍可用
- [ ] 打开 `https://demo.<域名>/capabilities` 与 `https://demo.<域名>/evaluations`，demo token 登录后两页均可访问
- [ ] 评估页对确定性场景点击「现场回放」，能返回执行轨迹时间线
- [ ] 公网扫描 3000/3100 端口不通

## 故障排查

| 现象 | 排查 |
|---|---|
| 聊天不流式、整段蹦出 | nginx 未对 `/api/sessions/` 关 `proxy_buffering` |
| 演示 token 登录被拒 | `.env.demo` 的 DEMO_TOKEN 与输入不一致；看 `docker compose -f docker-compose.demo.yml logs` |
| 重置后无法对话 | 播种失败：检查三个 DEMO_PROVIDER_* 变量与 LLM 余额 |
| 误触发限流（429） | 调高 nginx 中 demo_chat/demo_api zone 的 rate 或 burst |