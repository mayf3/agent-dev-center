#!/bin/bash
# scan-privacy-leaks.sh — 扫描代码仓库中的隐私泄露
# 用法: bash scan-privacy-leaks.sh [目录]

DIR="${1:-.}"
FOUND=0

echo "=== 隐私泄露扫描 ==="
echo "扫描目录: $DIR"

# 扫描邮箱
echo "--- 扫描邮箱 ---"
EMAILS=$(grep -rn "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}" "$DIR" --include="*.ts" --include="*.js" --include="*.json" 2>/dev/null | grep -v "node_modules" | grep -v "test@" | grep -v "example.com" | head -5)
if [ -n "$EMAILS" ]; then
  echo "⚠️ 发现邮箱:"
  echo "$EMAILS"
  FOUND=$((FOUND + 1))
fi

# 扫描 IP 地址
echo "--- 扫描 IP 地址 ---"
IPS=$(grep -rn "8\.163\.44\.127" "$DIR" --include="*.ts" --include="*.js" --include="*.json" 2>/dev/null | grep -v "node_modules" | head -5)
if [ -n "$IPS" ]; then
  echo "⚠️ 发现服务器 IP:"
  echo "$IPS"
  FOUND=$((FOUND + 1))
fi

# 扫描本地路径
echo "--- 扫描本地路径 ---"
PATHS=$(grep -rn "{home}" "$DIR" --include="*.ts" --include="*.js" --include="*.json" 2>/dev/null | grep -v "node_modules" | head -5)
if [ -n "$PATHS" ]; then
  echo "⚠️ 发现本地路径:"
  echo "$PATHS"
  FOUND=$((FOUND + 1))
fi

echo ""
if [ $FOUND -eq 0 ]; then
  echo "✅ 未发现隐私泄露"
else
  echo "❌ 发现 $FOUND 类隐私泄露"
fi
