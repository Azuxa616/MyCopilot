#!/usr/bin/env bash
# docker/rollback.sh — 手动回滚到上一版本镜像（my-copilot:rollback）
set -euo pipefail
cd "$(dirname "$0")"

log() { echo "[$(date '+%F %T')] [rollback] $*"; }

docker image inspect my-copilot:rollback >/dev/null 2>&1 || { log "无 rollback 标签可回滚"; exit 1; }

ENV_PERSONAL=(); [[ -f .env.personal ]] && ENV_PERSONAL=(--env-file .env.personal)
ENV_DEMO=();     [[ -f .env.demo ]]     && ENV_DEMO=(--env-file .env.demo)

docker tag my-copilot:rollback my-copilot:latest
log "已切回 rollback 镜像，重启双泳道 ..."

IMAGE=my-copilot:latest PULL_POLICY=never docker compose -f docker-compose.yml ${ENV_PERSONAL[@]+"${ENV_PERSONAL[@]}"} up -d
IMAGE=my-copilot:latest PULL_POLICY=never docker compose -f docker-compose.demo.yml ${ENV_DEMO[@]+"${ENV_DEMO[@]}"} up -d

sleep 5
curl -sf -m 3 http://127.0.0.1:3000/api/health >/dev/null && log "personal 健康 ✓"
curl -sf -m 3 http://127.0.0.1:3100/api/health >/dev/null && log "demo 健康 ✓"
log "回滚完成"
