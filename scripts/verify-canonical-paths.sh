#!/bin/bash
# ============================================================
# CI 路径校验 — 检测是否引用了已废弃的根目录 src/ 或 prisma/
#
# 在 CI/PR 流程中调用此脚本可防止新代码重新依赖已废弃路径。
# 用法: bash scripts/verify-canonical-paths.sh
# 退出码: 0 = 通过, 1 = 检测到违规
# ============================================================

set -eo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
HAS_ERROR=0

echo ""
echo "═══════════════════════════════════════════════════════"
echo "  Canonical 路径校验"
echo "  ADC canonical 路径: backend/"
echo "═══════════════════════════════════════════════════════"
echo ""

# ── 检查 1: Dockerfile 是否正确指向 backend/ ─────────────

if [ -f "Dockerfile" ]; then
  SRC_COPY=$(grep -c "COPY src" Dockerfile 2>/dev/null || true)
  ROOT_PRISMA_COPY=$(grep -c "COPY prisma" Dockerfile 2>/dev/null || true)

  if [ "$SRC_COPY" -gt 0 ]; then
    echo -e "${RED}[FAIL]${NC} Dockerfile 中引用了废弃的根 src/ 目录 (COPY src)"
    HAS_ERROR=1
  fi

  if [ "$ROOT_PRISMA_COPY" -gt 0 ]; then
    # 检查是否指向的是根 prisma/ 而非 backend/prisma/
    ROOT_PRISMA=$(grep "COPY prisma" Dockerfile | grep -v "backend/prisma" || true)
    if [ -n "$ROOT_PRISMA" ]; then
      echo -e "${RED}[FAIL]${NC} Dockerfile 中引用了废弃的根 prisma/ 目录"
      HAS_ERROR=1
    fi
  fi
fi

# ── 检查 2: docker-compose 是否正确指向 backend/ ──────────

if [ -f "docker-compose.yml" ]; then
  ROOT_SRC_REF=$(grep -c "src/" docker-compose.yml 2>/dev/null || true)
  if [ "$ROOT_SRC_REF" -gt 0 ]; then
    echo -e "${YELLOW}[WARN]${NC} docker-compose.yml 中引用了 src/（确认是否为 backend/src/ 的误判）"
  fi
fi

# ── 检查 3: deploy/CI 脚本是否正确指向 backend/ ──────────

for script in deploy*.sh build*.sh; do
  [ -f "$script" ] || continue
  SRC_REF=$(grep -c " src/" "$script" 2>/dev/null || true)
  ROOT_PRISMA_REF=$(grep -c " prisma/" "$script" | grep -v "backend/prisma" || true)
  if [ "$SRC_REF" -gt 0 ] && [ "$(grep " src/" "$script" | grep -v "backend/src" | wc -l)" -gt 0 ]; then
    echo -e "${RED}[FAIL]${NC} $script 中引用了废弃的根 src/（非 backend/src/）"
    HAS_ERROR=1
  fi
done

# ── 检查 4: package.json scripts 是否正确指向 backend/ ────

if [ -f "package.json" ]; then
  SRC_SCRIPTS=$(grep -c " src/" package.json 2>/dev/null || true)
  ROOT_PRISMA_SCRIPTS=$(grep -c " prisma" package.json 2>/dev/null || true)
  if [ "$SRC_SCRIPTS" -gt 0 ]; then
    echo -e "${YELLOW}[WARN]${NC} 根 package.json 引用了 src/（可能有遗留脚本）"
  fi
  if [ "$ROOT_PRISMA_SCRIPTS" -gt 0 ]; then
    echo -e "${YELLOW}[WARN]${NC} 根 package.json 引用了 prisma（确认是否应使用 backend/prisma/）"
  fi
fi

# ── 检查 5: backend/package.json 中的 prisma 路径 ─────────

if [ -f "backend/package.json" ]; then
  CORRECT_PRISMA=$(grep -c "prisma" backend/package.json 2>/dev/null || true)
  if [ "$CORRECT_PRISMA" -gt 0 ]; then
    echo -e "${GREEN}[OK]${NC} Prisma 命令在 backend/package.json 中"
  fi
fi

# ── 总结 ──────────────────────────────────────────────────

echo ""
if [ "$HAS_ERROR" -eq 0 ]; then
  echo -e "${GREEN}✅ 所有路径校验通过。${NC}"
else
  echo -e "${RED}⚠️  发现 $HAS_ERROR 个违规项，请修复后再提交。${NC}"
fi
echo "═══════════════════════════════════════════════════════"
exit $HAS_ERROR
