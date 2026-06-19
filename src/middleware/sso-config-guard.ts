/**
 * SSO 配置启动自检
 *
 * 防止以下问题：
 * - 占位符密钥（prod-sso-secret-at-least-16-chars-here）
 * - 密钥过短（< 32 字符）
 * - 密钥包含明显占位符模式
 *
 * 触发时机：服务启动时自动执行
 * 违规后果：生产环境拒绝启动，开发环境打印警告
 *
 * 来源：2026-05-24 SSO 密钥不同步事故（第二次重演）
 * 验尸报告：docs/postmortem-sso-secret-outofsync-20260524.md
 */

const PLACEHOLDER_PATTERNS = [
  'prod-sso-secret',
  'prod-jwt-secret',
  'at-least-16-chars',
  'change-me',
  'your-secret',
  'replace-this',
  'xxx',
];

function isPlaceholder(value: string): boolean {
  const lower = value.toLowerCase();
  return PLACEHOLDER_PATTERNS.some(p => lower.includes(p));
}

export function validateSSOConfig(): { valid: boolean; warnings: string[] } {
  const warnings: string[] = [];
  const ssoSecret = process.env.JWT_SECRET_SSO || '';
  const jwtSecret = process.env.JWT_SECRET || '';
  const nodeEnv = process.env.NODE_ENV || 'development';
  const isProd = nodeEnv === 'production';

  // Check 1: SSO secret exists
  if (!ssoSecret) {
    warnings.push('JWT_SECRET_SSO is not set');
    return { valid: false, warnings };
  }

  // Check 2: Not a placeholder
  if (isPlaceholder(ssoSecret)) {
    warnings.push(`JWT_SECRET_SSO looks like a placeholder: "${ssoSecret.substring(0, 10)}..."`);
    return { valid: false, warnings };
  }

  // Check 3: Minimum length (32 chars = 16 bytes hex = reasonable for HS256)
  if (ssoSecret.length < 32) {
    warnings.push(`JWT_SECRET_SSO is too short (${ssoSecret.length} chars, need >= 32)`);
    return { valid: false, warnings };
  }

  // Check 4: SSO secret should match JWT_SECRET (our "single key" principle)
  // In production, these should be the same value
  if (isProd && ssoSecret !== jwtSecret) {
    warnings.push(
      'JWT_SECRET_SSO differs from JWT_SECRET. ' +
      'Per postmortem-20260524, SSO should use the same key as JWT. ' +
      'If this is intentional, document why.'
    );
    // This is a warning, not a hard failure — there may be valid reasons
    console.warn(`[SSO Config] WARNING: ${warnings[warnings.length - 1]}`);
  }

  return { valid: true, warnings };
}

/**
 * Run on startup. In production, invalid config = crash.
 * In development, just warn.
 */
export function startupSSOCheck(): void {
  const result = validateSSOConfig();
  const nodeEnv = process.env.NODE_ENV || 'development';

  if (!result.valid) {
    if (nodeEnv === 'production') {
      console.error('[SSO Config] FATAL: SSO configuration invalid. Refusing to start.');
      result.warnings.forEach(w => console.error(`  - ${w}`));
      process.exit(1);
    } else {
      console.warn('[SSO Config] WARNING: SSO configuration issues (non-fatal in dev):');
      result.warnings.forEach(w => console.warn(`  - ${w}`));
    }
  } else {
    console.log('[SSO Config] ✅ SSO configuration valid');
    if (result.warnings.length > 0) {
      result.warnings.forEach(w => console.warn(`  ⚠️  ${w}`));
    }
  }
}
