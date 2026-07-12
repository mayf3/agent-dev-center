#!/usr/bin/env bash
# ============================================================
# deploy-guard.sh — ADC 部署前置守卫
#
# 在 build/package/deploy 门禁中自动检查。
#
# 背景: 生产曾因镜像构建于旧 commit (5403a16) 导致 workflowSnapshot
# fallback 未生效。仓库代码已包含正确逻辑但镜像未重建。
# 本守卫防止同类问题复发。
#
# 检查项:
#   1. 不存在嵌套的 backend/src/src/ 目录（部署卫生，非历史根因）
#   2. Runtime entrypoint 指向 dist/src/server.js
#   3. OCI revision 身份标签
#   4. nginx 配置语法正确
#   5. 编译产物包含 workflowSnapshot 回退逻辑
#   6. 验证 build 输出目录结构干净
#
# 任何检查失败 → 退出码 1，部署中止。
# 用法:
#   bash scripts/deploy-guard.sh                        # 检查当前目录
#   bash scripts/deploy-guard.sh /opt/agent-dev-center   # 检查指定目录
#   bash scripts/deploy-guard.sh --build                 # 构建后检查
#   bash scripts/deploy-guard.sh --build /opt/staging    # 构建后检查指定目录
# ============================================================

set -Eeuo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
HAS_ERROR=0
CHECK_MODE=""
CHECK_DIR="$(pwd)"

# ─── 参数解析 ─────────────────────────────────────────────
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build) CHECK_MODE="--build"; shift ;;
    *) CHECK_DIR="$1"; shift ;;
  esac
done

cd "${CHECK_DIR}" 2>/dev/null || {
  echo -e "${RED}[FATAL]${NC} 目录不存在: ${CHECK_DIR}"
  exit 1
}

if [ ! -d "backend" ]; then
  echo -e "${RED}[FATAL]${NC} 当前目录不是 ADC 项目根目录（缺少 backend/）"
  exit 1
fi

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  ADC 部署守卫"
echo "  检查目录: ${CHECK_DIR}"
echo "  检查模式: ${CHECK_MODE:-标准}"
echo "═══════════════════════════════════════════════════════"
echo ""

# ─── Guard 1: 不存在嵌套的 backend/src/src/ ──────────────
echo -n "[1/8] 检查 backend/src/src/ 嵌套目录 ... "
if [ -d "backend/src/src" ]; then
  echo -e "${RED}❌ FAIL${NC}"
  echo "    发现嵌套目录: ${CHECK_DIR}/backend/src/src/"
  echo "    部署卫生问题，请清理: rm -rf backend/src/src"
  HAS_ERROR=1
else
  echo -e "${GREEN}✅ PASS${NC}"
fi

echo -n "[2/8] 递归检查 src/src 嵌套 ... "
NESTED_DIRS=$(find backend -type d -path "*/src/src" 2>/dev/null || true)
if [ -n "${NESTED_DIRS}" ]; then
  echo -e "${RED}❌ FAIL${NC}"
  echo "    发现嵌套 src/src 目录:"
  echo "${NESTED_DIRS}" | sed 's/^/      /'
  HAS_ERROR=1
else
  echo -e "${GREEN}✅ PASS${NC}"
fi

# ─── Guard 3: Runtime entrypoint 路径正确性 ──────────────
echo -n "[3/8] 验证 runtime entrypoint 路径 ... "
ENTRYPOINT_ERROR=0
if [ -f "backend/package.json" ]; then
  START_CMD=$(node -e "const p=require('./backend/package.json'); console.log(p.scripts?.start||'')" 2>/dev/null || echo "")
  START_MIGRATE_CMD=$(node -e "const p=require('./backend/package.json'); console.log(p.scripts?.['start:migrate']||'')" 2>/dev/null || echo "")

  # Check both point to dist/src/server.js (not src/src)
  for cmd_label in "start" "start:migrate"; do
    cmd_val=""
    [ "$cmd_label" = "start" ] && cmd_val="$START_CMD" || cmd_val="$START_MIGRATE_CMD"
    if echo "$cmd_val" | grep -q "src/src"; then
      echo -e "${RED}❌ FAIL${NC}"
      echo "    ${cmd_label} 脚本包含错误的 src/src 路径: ${cmd_val}"
      ENTRYPOINT_ERROR=1
    fi
    if ! echo "$cmd_val" | grep -q "node dist/src/server"; then
      echo -e "${RED}❌ FAIL${NC}"
      echo "    ${cmd_label} 脚本未指向 dist/src/server.js: ${cmd_val}"
      ENTRYPOINT_ERROR=1
    fi
  done

  if [ "${ENTRYPOINT_ERROR}" -eq 0 ]; then
    echo -e "${GREEN}✅ PASS${NC}"
    echo "    start:          ${START_CMD}"
    echo "    start:migrate:  ${START_MIGRATE_CMD}"
  else
    HAS_ERROR=1
  fi
else
  echo -e "${YELLOW}⚠️  SKIP${NC} (找不到 backend/package.json)"
fi

# ─── Guard 4: OCI 身份标签 ───────────────────────────────────
echo -n "[4/8] 验证 OCI revision 身份标签 ... "
OCI_ERROR=0

check_oci_labels() {
  local dockerfile="$1"
  local name="$2"
  if [ ! -f "${dockerfile}" ]; then
    echo ""
    echo "    ${name} Dockerfile 不存在: ${dockerfile}"
    return 1
  fi
  local last_from
  last_from=$(grep -nE '^FROM\s+\S+\s+AS\s+' "${dockerfile}" 2>/dev/null | tail -1 | cut -d: -f1)
  if [ -z "${last_from}" ]; then
    echo ""
    echo "    无法解析 ${name}: 未找到 FROM ... AS 行"
    return 1
  fi
  local tail_content
  tail_content=$(tail -n +"${last_from}" "${dockerfile}")
  if ! echo "${tail_content}" | grep -q 'LABEL org.opencontainers.image.revision'; then
    echo ""
    echo "    ${name} 最终 stage 缺少 LABEL org.opencontainers.image.revision"
    return 1
  fi
  if ! echo "${tail_content}" | grep -q 'LABEL org.opencontainers.image.created'; then
    echo ""
    echo "    ${name} 最终 stage 缺少 LABEL org.opencontainers.image.created"
    return 1
  fi
  if ! echo "${tail_content}" | grep -q 'ARG BUILD_COMMIT'; then
    echo ""
    echo "    ${name} 最终 stage 缺少 ARG BUILD_COMMIT"
    return 1
  fi
  return 0
}

if ! check_oci_labels "backend/Dockerfile" "Backend"; then
  OCI_ERROR=1
fi
if ! check_oci_labels "frontend/Dockerfile" "Frontend"; then
  OCI_ERROR=1
fi

if [ "${OCI_ERROR}" -eq 0 ]; then
  echo -e "${GREEN}✅ PASS${NC}"
  echo "    backend/Dockerfile: 最终 stage 已声明 OCI revision + created 标签"
  echo "    frontend/Dockerfile: 最终 stage 已声明 OCI revision + created 标签"
else
  echo -e "${RED}❌ FAIL${NC}"
  HAS_ERROR=1
fi

# ─── Guard 5: nginx 配置语法检查 ──────────────────────────
echo -n "[5/8] 验证 nginx 配置语法 ... "
if [ -f "nginx-site.conf" ]; then
  if command -v nginx >/dev/null 2>&1; then
    if nginx -t -c /dev/null -g "daemon off; $(cat nginx-site.conf | sed 's/listen 80;/listen 8080;/')" 2>/dev/null; then
      echo -e "${GREEN}✅ PASS${NC}"
    else
      echo -e "${RED}❌ FAIL${NC}"
      echo "    nginx 配置语法错误"
      nginx -t -c /dev/null -g "daemon off; $(cat nginx-site.conf | sed 's/listen 80;/listen 8080;/')" 2>&1 | head -5 | sed 's/^/      /'
      HAS_ERROR=1
    fi
  else
    # Fallback: basic grep-level checks
    ERRORS=0
    if grep -q "{your-server-ip}" nginx-site.conf 2>/dev/null; then
      echo -e "${RED}❌ FAIL${NC}"
      echo "    nginx-site.conf 包含未替换的 {your-server-ip} 占位符"
      ERRORS=1
    fi
    # Check basic syntax (server blocks closed)
    OPEN=$(grep -c "{" nginx-site.conf 2>/dev/null || echo 0)
    CLOSED=$(grep -c "}" nginx-site.conf 2>/dev/null || echo 0)
    if [ "$OPEN" -ne "$CLOSED" ]; then
      echo -e "${RED}❌ FAIL${NC}"
      echo "    nginx 配置大括号不匹配: {=$OPEN }=$CLOSED"
      ERRORS=1
    fi
    if [ "$ERRORS" -eq 0 ]; then
      echo -e "${GREEN}✅ PASS${NC} (nginx 不可用，基础语法检查通过)"
    else
      HAS_ERROR=1
    fi
  fi
else
  echo -e "${YELLOW}⚠️  SKIP${NC} (找不到 nginx-site.conf)"
fi

# ─── 构建后检查（仅 --build 模式） ────────────────────
if [ "${CHECK_MODE}" = "--build" ]; then
  # Guard 6: Compile output exists
  echo -n "[6/8] 验证 build 输出 entrypoint ... "
  if [ -f "backend/dist/src/server.js" ]; then
    echo -e "${GREEN}✅ PASS${NC}"
    ls -la backend/dist/src/server.js | sed 's/^/      /'
  else
    echo -e "${RED}❌ FAIL${NC}"
    echo "    Build 产物 missing: backend/dist/src/server.js"
    echo "    运行: npm --workspace backend run build"
    HAS_ERROR=1
  fi

  # Guard 7: Compile output contains workflowSnapshot fallback
  echo -n "[7/8] 验证编译产物包含 workflowSnapshot 逻辑 ... "
  ADVANCE_FILE="backend/dist/src/routes/requirements/workflow-advance.js"
  REJECT_FILE="backend/dist/src/routes/requirements/workflow-reject.js"
  HELPERS_FILE="backend/dist/src/routes/requirements/workflow-helpers.js"

  if [ -f "${ADVANCE_FILE}" ]; then
    HAS_SNAPSHOT_CHECK=0
    # Check for the workflowSnapshot fallback check in compiled output
    if grep -q "workflowSnapshot" "${ADVANCE_FILE}" 2>/dev/null; then
      HAS_SNAPSHOT_CHECK=1
    fi
    if grep -q "workflowSnapshot" "${REJECT_FILE}" 2>/dev/null; then
      HAS_SNAPSHOT_CHECK=1
    fi
    # Check getWorkflowRawJson or getWorkflowSteps references snapshot
    if grep -q "workflowSnapshot" "${HELPERS_FILE}" 2>/dev/null; then
      HAS_SNAPSHOT_CHECK=1
    fi
    if [ "${HAS_SNAPSHOT_CHECK}" -eq 1 ]; then
      echo -e "${GREEN}✅ PASS${NC}"
      echo "    ${ADVANCE_FILE}: $(grep -c "workflowSnapshot" "${ADVANCE_FILE}" 2>/dev/null || echo 0) references"
      echo "    ${REJECT_FILE}: $(grep -c "workflowSnapshot" "${REJECT_FILE}" 2>/dev/null || echo 0) references"
      echo "    ${HELPERS_FILE}: $(grep -c "workflowSnapshot" "${HELPERS_FILE}" 2>/dev/null || echo 0) references"
    else
      echo -e "${RED}❌ FAIL${NC}"
      echo "    编译产物不包含 workflowSnapshot 引用"
      echo "    可能构建于旧代码或缓存，请确认 commit 包含 snapshot fallback"
      HAS_ERROR=1
    fi
  else
    echo -e "${RED}❌ FAIL${NC}"
    echo "    编译产物 ${ADVANCE_FILE} 不存在"
    HAS_ERROR=1
  fi

  # Guard 8: Verify dist directory structure
  echo -n "[8/8] 验证 dist 目录结构 ... "
  if [ -d "backend/dist/src/src" ]; then
    echo -e "${RED}❌ FAIL${NC}"
    echo "    Build 输出包含嵌套: backend/dist/src/src/"
    HAS_ERROR=1
  else
    echo -e "${GREEN}✅ PASS${NC}"
  fi
else
  echo -e "[6/8] ${YELLOW}⚠️  SKIP${NC} (非 --build 模式)"
  echo -e "[7/8] ${YELLOW}⚠️  SKIP${NC} (非 --build 模式)"
  echo -e "[8/8] ${YELLOW}⚠️  SKIP${NC} (非 --build 模式)"
fi

# ─── 总结 ──────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════"
if [ "${HAS_ERROR}" -eq 0 ]; then
  echo -e "${GREEN}✅ 所有部署守卫检查通过。${NC}"
else
  echo -e "${RED}❌ 发现 ${HAS_ERROR} 个错误，部署中止。${NC}"
fi
echo "═══════════════════════════════════════════════════════"
exit ${HAS_ERROR}
