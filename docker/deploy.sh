#!/usr/bin/env bash
# docker/deploy.sh — 服务器端自动拉取部署（泳道 demo + personal 双实例）
#
# 流程：
#   1. 从 GHCR 拉取最新镜像（公开镜像无需凭证）
#   2. 与当前运行容器所用镜像 digest 对比，无变化则跳过（幂等）
#   3. 旧镜像标记为 my-copilot:rollback 作为回滚点
#   4. 先更新 personal 泳道，健康检查通过后再更新 demo 泳道
#   5. 任一泳道健康检查失败 → 自动回滚到 rollback 标签并退出非零
#
# 用法：
#   ./deploy.sh [image[:tag]]    # 默认 ghcr.io/azuxa616/my-copilot:latest
#   ./rollback.sh                # 手动回滚到上一版本
set -euo pipefail

REMOTE_REF="${1:-ghcr.io/azuxa616/my-copilot:latest}"
cd "$(dirname "$0")"

log()  { echo "[$(date '+%F %T')] [deploy] $*"; }
die()  { log "ERROR: $*"; exit 1; }
lane() { echo "mycopilot-mycopilot-1 mycopilot-demo-mycopilot-demo-1"; }

command -v docker >/dev/null || die "docker not found"

ENV_PERSONAL=(); [[ -f .env.personal ]] && ENV_PERSONAL=(--env-file .env.personal)
ENV_DEMO=();     [[ -f .env.demo ]]     && ENV_DEMO=(--env-file .env.demo)

# ---------------------------------------------------------------------------
# 1. 拉取远端镜像并取 digest（本地标签拉取失败但本地存在时容忍，便于离线/首次部署）
# ---------------------------------------------------------------------------
if [[ "${REMOTE_REF}" == *.*/* ]]; then
  log "pulling ${REMOTE_REF} ..."
  docker pull "${REMOTE_REF}" >/dev/null || die "镜像拉取失败（检查网络 / GHCR 可达性 / 镜像是否存在）"
else
  log "${REMOTE_REF} 为本地镜像，跳过拉取"
  docker image inspect "${REMOTE_REF}" >/dev/null 2>&1 || die "本地镜像 ${REMOTE_REF} 不存在，请先构建"
fi
REMOTE_DIGEST=$(docker image inspect "${REMOTE_REF}" --format '{{index .RepoDigests 0}}' 2>/dev/null | sed 's/.*@//')
[[ -n "${REMOTE_DIGEST}" ]] || die "无法读取远端 digest"

# ---------------------------------------------------------------------------
# 2. 幂等：当前运行容器已在用该 digest 则跳过
# ---------------------------------------------------------------------------
RUNNING_DIGEST=""
for c in $(lane); do
  RUNNING_DIGEST=$(docker inspect --format '{{.Image}}' "${c}" 2>/dev/null || true)
  break
done
if [[ -n "${RUNNING_DIGEST}" ]]; then
  # 运行容器记录的是本地 image ID；比对镜像 RepoTags 是否指向同一次拉取
  LATEST_ID=$(docker image inspect my-copilot:latest --format '{{.Id}}' 2>/dev/null || true)
  REMOTE_ID=$(docker image inspect "${REMOTE_REF}" --format '{{.Id}}')
  if [[ "${RUNNING_DIGEST}" == "${REMOTE_ID}" && "${LATEST_ID}" == "${REMOTE_ID}" ]]; then
    log "已是最新（digest ${REMOTE_DIGEST:0:19}...），无需更新"
    exit 0
  fi
fi

# ---------------------------------------------------------------------------
# 3. 记录回滚点
# ---------------------------------------------------------------------------
if docker image inspect my-copilot:latest >/dev/null 2>&1; then
  docker image rm my-copilot:rollback >/dev/null 2>&1 || true
  docker tag my-copilot:latest my-copilot:rollback
  log "回滚点已记录: my-copilot:rollback"
fi
docker tag "${REMOTE_REF}" my-copilot:latest

# ---------------------------------------------------------------------------
# 4. 滚动更新两个泳道（先 personal 后 demo），失败自动回滚
# ---------------------------------------------------------------------------
update_lane() {
  local name="$1" compose="$2" port="$3"; shift 3
  local env_opts=("$@")

  log "更新泳道 [${name}] ..."
  IMAGE=my-copilot:latest PULL_POLICY=never \
    docker compose -f "${compose}" "${env_opts[@]}" up -d >/dev/null \
    || { log "[${name}] 容器启动失败"; return 1; }

  log "等待 [${name}] 健康检查（最多 120s）..."
  local i=0
  until curl -sf -m 3 "http://127.0.0.1:${port}/api/health" >/dev/null 2>&1; do
    i=$((i+1))
    [[ ${i} -gt 40 ]] && { log "[${name}] 健康检查超时"; return 1; }
    sleep 3
  done
  log "泳道 [${name}] 健康检查通过 ✓"
}

rollback_all() {
  log "触发自动回滚 ..."
  docker tag my-copilot:rollback my-copilot:latest 2>/dev/null || die "无可用回滚镜像"
  IMAGE=my-copilot:latest PULL_POLICY=never \
    docker compose -f docker-compose.yml "${ENV_PERSONAL[@]}" up -d >/dev/null 2>&1 || true
  IMAGE=my-copilot:latest PULL_POLICY=never \
    docker compose -f docker-compose.demo.yml "${ENV_DEMO[@]}" up -d >/dev/null 2>&1 || true
  die "部署失败，已回滚到上一版本（请查看 docker compose logs）"
}
[[ ${#ENV_PERSONAL[@]} -gt 0 ]] || ENV_PERSONAL=("")
[[ ${#ENV_DEMO[@]} -gt 0 ]]     || ENV_DEMO=("")

update_lane personal docker-compose.yml 3000 "${ENV_PERSONAL[@]}"     || rollback_all
update_lane demo docker-compose.demo.yml 3100 "${ENV_DEMO[@]}"       || rollback_all

log "双泳道部署完成 ✓  digest: ${REMOTE_DIGEST:0:19}..."
