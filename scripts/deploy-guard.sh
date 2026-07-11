#!/usr/bin/env bash
# ============================================================
# deploy-guard.sh — ADC 部署前置守卫
#
# 在 build/package/deploy 门禁中自动检查：
#   1. 不存在嵌套的 backend/src/src/ 目录
#   2. Runtime entrypoint 不包含 src/src 路径
#   3. backend/package.json 的 start/start:migrate 指向正确路径
#   4. 检查 backend/dist/src/server.js 是否存在（若 dist 已生成）
#   5. 验证 build 输出目录结构干净
#
# 任何检查失败 → 退出码 1，部署中止。
# 用法:
#   bash scripts/deploy-guard.sh                   # 检查当前目录
#   bash scripts/deploy-guard.sh /opt/release       # 检查指定目录
#   bash scripts/deploy-guard.sh --build            # 构建后检查（包含 dist 验证）
# ============================================================

set -Eeuo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
HAS_ERROR=0

# ─── 目标目录 ──────────────────────────────────────────────
CHECK_MODE=""
CHECK_DIR="$(pwd)"
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
echo -n "[1/5] 检查 backend/src/src/ 嵌套目录 ... "
if [ -d "backend/src/src" ]; then
  echo -e "${RED}❌ FAIL${NC}"
  echo "    发现嵌套目录: ${CHECK_DIR}/backend/src/src/"
  echo "    生产 Runtime 可能从此路径而非 backend/dist/ 加载旧版代码"
  echo "    请清理: rm -rf backend/src/src"
  HAS_ERROR=1
else
  echo -e "${GREEN}✅ PASS${NC}"
fi

# ─── Guard 2: 递归检查任何 src/src 嵌套 ──────────────────
echo -n "[2/5] 递归检查 src/src 嵌套 ... "
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
echo -n "[3/5] 验证 runtime entrypoint 路径 ... "

if [ -f "backend/package.json" ]; then
  # 检查 start 脚本
  START_CMD=$(node -e "const p=require('./backend/package.json'); console.log(p.scripts?.start||'')" 2>/dev/null || echo "")
  START_MIGRATE_CMD=$(node -e "const p=require('./backend/package.json'); console.log(p.scripts?.['start:migrate']||'')" 2>/dev/null || echo "")

  ENTRYPOINT_ERROR=0

  if echo "${START_CMD}" | grep -q "src/src"; then
    echo -e "${RED}❌ FAIL${NC}"
    echo "    start 脚本包含错误的 src/src 路径: ${START_CMD}"
    ENTRYPOINT_ERROR=1
  fi
  if echo "${START_MIGRATE_CMD}" | grep -q "src/src"; then
    echo -e "${RED}❌ FAIL${NC}"
    echo "    start:migrate 脚本包含错误的 src/src 路径: ${START_MIGRATE_CMD}"
    ENTRYPOINT_ERROR=1
  fi
  # 验证指向 dist/ 目录
  if echo "${START_CMD}" | grep -q "node dist/src/server"; then
    echo -ne "${GREEN}✅${NC} (${START_CMD})"
  else
    echo -ne "${YELLOW}⚠️${NC} start 非标准路径: ${START_CMD}"
  fi
  if echo "${START_MIGRATE_CMD}" | grep -q "node dist/src/server"; then
    echo -e " ${GREEN}✅${NC} (${START_MIGRATE_CMD})"
  else
    echo -e " ${YELLOW}⚠️${NC} start:migrate 非标准: ${START_MIGRATE_CMD}"
  fi

  if [ "${ENTRYPOINT_ERROR}" -eq 1 ]; then
    HAS_ERROR=1
  fi
else
  echo -e "${YELLOW}⚠️  SKIP${NC} (找不到 backend/package.json)"
fi

# ─── Guard 4: Build 输出验证（仅 --build 模式） ──────────
if [ "${CHECK_MODE}" = "--build" ]; then
  echo -n "[4/5] 验证 build 输出（--build 模式） ... "
  if [ -f "backend/dist/src/server.js" ]; then
    echo -e "${GREEN}✅ PASS${NC}"
    echo "    entrypoint: backend/dist/src/server.js"
    ls -la backend/dist/src/server.js | sed 's/^/      /'
  else
    echo -e "${RED}❌ FAIL${NC}"
    echo "    Build 产物 missing: backend/dist/src/server.js"
    echo "    运行: npm --workspace backend run build"
    HAS_ERROR=1
  fi

  # 验证 dist 目录没有 src/src 嵌套
  echo -n "[5/5] 验证 dist 目录结构 ... "
  if [ -d "backend/dist/src/src" ]; then
    echo -e "${RED}❌ FAIL${NC}"
    echo "    Build 输出包含嵌套: backend/dist/src/src/"
    echo "    tsconfig rootDir 或 outDir 配置可能导致路径嵌套"
    HAS_ERROR=1
  else
    echo -e "${GREEN}✅ PASS${NC}"
  fi
else
  echo -e "[4/5] ${YELLOW}⚠️  SKIP${NC} (非 --build 模式，跳过 dist 验证)"
  echo -e "[5/5] ${YELLOW}⚠️  SKIP${NC} (非 --build 模式)"
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
