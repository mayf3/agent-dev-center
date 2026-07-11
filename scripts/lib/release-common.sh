#!/usr/bin/env bash
# ============================================================
# release-common.sh — ADC Release 公共库函数
#
# 被 deploy.sh 的远程 SSH heredoc 通过 source 或内联使用。
# 独立单元可测试，不依赖外部状态。
# ============================================================

# ─── 获取运行容器的真实 image ID ─────────────────────────
# 用法: get_running_image_id <compose-file> <service-name>
# 返回: image digest (sha256:...) 或空字符串
get_running_image_id() {
  local compose_file="$1"
  local service_name="$2"
  local container_id
  container_id=$(docker compose -f "${compose_file}" ps -q "${service_name}" 2>/dev/null || true)
  if [ -n "${container_id}" ]; then
    docker inspect --format '{{.Image}}' "${container_id}" 2>/dev/null || echo ""
  else
    echo ""
  fi
}

# ─── 验证 image ID 真实有效 ──────────────────────────────
# image_id 必须是一个有效的 docker image digest
is_valid_image_id() {
  local image_id="$1"
  [ -n "${image_id}" ] && docker image inspect "${image_id}" >/dev/null 2>&1
}

# ─── 保存运行镜像为 previous ─────────────────────────────
# 在 build 前调用，基于容器真实 image ID 而非 tag
save_previous_images() {
  local compose_file="$1"
  local backend_image="$2"   # e.g. agent-dev-center-backend
  local frontend_image="$3"  # e.g. agent-dev-center-frontend

  echo "[deploy] Saving running container images as :previous..."

  # Backend
  local be_id
  be_id=$(get_running_image_id "${compose_file}" "backend")
  if is_valid_image_id "${be_id}"; then
    docker tag "${be_id}" "${backend_image}:previous"
    echo "[deploy] ✅ Backend previous: ${be_id:0:19}..."
  else
    echo "[deploy] ⚠️  No running Backend container, skipping Backend previous"
  fi

  # Frontend
  local fe_id
  fe_id=$(get_running_image_id "${compose_file}" "frontend")
  if is_valid_image_id "${fe_id}"; then
    docker tag "${fe_id}" "${frontend_image}:previous"
    echo "[deploy] ✅ Frontend previous: ${fe_id:0:19}..."
  else
    echo "[deploy] ⚠️  No running Frontend container, skipping Frontend previous"
  fi
}

# ─── 自动回滚 ────────────────────────────────────────────
# 将 previous 镜像恢复为 prod，重启服务
rollback_release() {
  local compose_file="$1"
  local env_file="$2"
  local backend_image="$3"
  local frontend_image="$4"

  echo "[deploy] ⚠️  ROLLING BACK production release..."
  echo "[deploy] Restoring :previous → :prod"

  # Backend
  if docker images "${backend_image}:previous" --format '{{.Repository}}' 2>/dev/null | grep -q .; then
    docker tag "${backend_image}:previous" "${backend_image}:prod" 2>/dev/null || true
    echo "[deploy] ✅ Backend restored: ${backend_image}:previous → :prod"
  else
    echo "[deploy] ⚠️  No ${backend_image}:previous available for rollback"
  fi

  # Frontend
  if docker images "${frontend_image}:previous" --format '{{.Repository}}' 2>/dev/null | grep -q .; then
    docker tag "${frontend_image}:previous" "${frontend_image}:prod" 2>/dev/null || true
    echo "[deploy] ✅ Frontend restored: ${frontend_image}:previous → :prod"
  else
    echo "[deploy] ⚠️  No ${frontend_image}:previous available for rollback"
  fi

  # Restart with --no-build to prevent compose from rebuilding
  echo "[deploy] Restarting services with --no-build..."
  docker compose --env-file "${env_file}" -f "${compose_file}" up -d --no-build 2>&1 || {
    echo "[deploy] ❌ ROLLBACK_FAILED: compose up --no-build failed" >&2
    echo "[deploy]    Container state:" >&2
    docker compose --env-file "${env_file}" -f "${compose_file}" ps 2>/dev/null >&2 || true
    echo "[deploy]    Backend images: ${backend_image}:prod / :previous" >&2
    echo "[deploy]    Frontend images: ${frontend_image}:prod / :previous" >&2
    return 1
  }

  # Verify rollback health
  sleep 10
  if verify_backend_health "${compose_file}" "${env_file}" 3; then
    echo "[deploy] ✅ Rollback health OK"
    return 0
  else
    echo "[deploy] ❌ ROLLBACK_FAILED: health check failed after rollback" >&2
    return 1
  fi
}

# ─── Backend 健康检查 ─────────────────────────────────────
# 重试指定次数，每次间隔 5s
verify_backend_health() {
  local compose_file="$1"
  local env_file="$2"
  local max_retries="${3:-6}"

  for i in $(seq 1 "${max_retries}"); do
    if docker compose --env-file "${env_file}" -f "${compose_file}" exec -T backend \
      node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))" 2>/dev/null; then
      return 0
    fi
    [ "$i" -lt "${max_retries}" ] && sleep 5
  done
  return 1
}

# ─── Frontend 健康检查 ────────────────────────────────────
verify_frontend_health() {
  local compose_file="$1"
  local env_file="$2"
  local max_retries="${3:-6}"

  for i in $(seq 1 "${max_retries}"); do
    if docker compose --env-file "${env_file}" -f "${compose_file}" exec -T frontend \
      wget -qO- http://127.0.0.1/health >/dev/null 2>&1; then
      return 0
    fi
    [ "$i" -lt "${max_retries}" ] && sleep 5
  done
  return 1
}

# ─── buildCommit 精确验证 ─────────────────────────────────
# 检查新启动的 Backend /api/health 的 buildCommit
verify_build_commit() {
  local compose_file="$1"
  local env_file="$2"
  local expected_commit="$3"
  local max_retries="${4:-6}"

  for i in $(seq 1 "${max_retries}"); do
    local health_json
    health_json=$(docker compose --env-file "${env_file}" -f "${compose_file}" exec -T backend \
      node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>r.json()).then(d=>process.stdout.write(JSON.stringify(d))).catch(()=>process.stdout.write('fail'))" 2>/dev/null || echo "fail")

    if [ "${health_json}" = "fail" ]; then
      [ "$i" -lt "${max_retries}" ] && sleep 5
      continue
    fi

    local reported_commit reported_entry
    reported_commit=$(echo "${health_json}" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.buildCommit||'')}catch{console.log('parse-fail')}})")
    reported_entry=$(echo "${health_json}" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.runtimeEntry||'')}catch{console.log('parse-fail')}})")

    local errors=""
    if [ "${reported_commit}" != "${expected_commit}" ]; then
      errors="buildCommit mismatch: expected=${expected_commit:0:12}, got=${reported_commit:0:12}"
    fi
    if [ "${reported_entry}" != "dist/src/server.js" ]; then
      errors="${errors:+${errors}; }runtimeEntry mismatch: got=${reported_entry}"
    fi

    if [ -z "${errors}" ]; then
      echo "[deploy] ✅ buildCommit verified: ${reported_commit:0:12}"
      echo "[deploy] ✅ runtimeEntry verified: ${reported_entry}"
      return 0
    fi

    if [ "$i" -lt "${max_retries}" ]; then
      echo "[deploy] Retry $i/${max_retries}: ${errors}"
      sleep 5
    else
      echo "[deploy] ❌ ${errors}" >&2
    fi
  done
  return 1
}

# ─── 写入 CURRENT_RELEASE ─────────────────────────────────
# 只在所有验证通过后调用
write_current_release() {
  local release_dir="$1"
  local remote_dir="$2"
  local commit="$3"
  local timestamp="$4"
  local be_id="$5"
  local fe_id="$6"
  local prev_be_id="$7"
  local prev_fe_id="$8"

  {
    echo "# ADC Production Release"
    echo "commit=${commit}"
    echo "timestamp=${timestamp}"
    echo "backend_image_id=${be_id}"
    echo "frontend_image_id=${fe_id}"
    echo "previous_backend_image_id=${prev_be_id:-}"
    echo "previous_frontend_image_id=${prev_fe_id:-}"
    echo "release_dir=${release_dir}"
  } > "${remote_dir}/CURRENT_RELEASE"

  echo "[deploy] ✅ CURRENT_RELEASE written to ${remote_dir}/CURRENT_RELEASE"
}
