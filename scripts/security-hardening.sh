#!/bin/bash
# security-hardening.sh — Nginx 安全加固（itops 执行）
# 修复：6e36ac20（调试端点暴露）+ 0278671c（/server-info 502）
# 执行方式：ssh root@server "bash /opt/services/agent-dev-center/scripts/security-hardening.sh"
set -euo pipefail

echo "=== Nginx 安全加固 ==="

# 1. 禁止公网访问调试/管理端点
NGINX_SECURITY_CONF="/etc/nginx/snippets/security-block.conf"
mkdir -p "$(dirname "$NGINX_SECURITY_CONF")"

cat > "$NGINX_SECURITY_CONF" << 'EOF'
# 6e36ac20: 屏蔽调试/管理端点
location ~* ^/(phpinfo|actuator|swagger-ui|swagger-resources|api-docs|server-info|\.env|\.git|\.svn|wp-admin|wp-login|xmlrpc\.php|_debugbar|telescope|_profiler) {
    return 404;
}

# 屏蔽常见调试文件后缀
location ~* \.(bak|sql|db|sqlite|log|conf|ini|sh|env|yml|yaml|git|svn)$ {
    return 404;
}

# 安全响应头
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;
EOF

echo "✅ Written $NGINX_SECURITY_CONF"

# 2. 检查主配置中是否已 include
NGINX_CONF="/etc/nginx/nginx.conf"
if ! grep -q "include.*snippets/security-block" "$NGINX_CONF" 2>/dev/null; then
  echo "⚠️  请在 nginx.conf 的 http/server block 中添加："
  echo "   include /etc/nginx/snippets/security-block.conf;"
fi

# 3. 验证配置
nginx -t 2>&1 && echo "✅ nginx config OK" || echo "❌ nginx config ERROR"

echo ""
echo "=== 修复后验证 ==="
echo "curl -s -o /dev/null -w '%{http_code}' http://localhost/server-info    (应返回 404)"
echo "curl -s -o /dev/null -w '%{http_code}' http://localhost/actuator       (应返回 404)"
echo "curl -s -o /dev/null -w '%{http_code}' http://localhost/phpinfo        (应返回 404)"
