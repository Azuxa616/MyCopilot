#!/usr/bin/env bash
# docker/reset-demo.sh
# 每日重置演示实例：清空演示数据卷并重建（DEMO_MODE 启动时自动重新播种）。
# crontab 示例（宿主机）：
#   30 4 * * * /path/to/MyCopilot/docker/reset-demo.sh >> /var/log/mycopilot-demo-reset.log 2>&1
set -euo pipefail
cd "$(dirname "$0")"

docker compose -f docker-compose.demo.yml --env-file .env.demo down
rm -rf ./demo-data
mkdir -p ./demo-data
# 容器内 app 用户 uid=999，目录须对其可写，否则 SQLITE_CANTOPEN
chown 999:999 ./demo-data
chmod 755 ./demo-data
docker compose -f docker-compose.demo.yml --env-file .env.demo up -d
