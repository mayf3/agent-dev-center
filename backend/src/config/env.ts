import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z
    .string()
    .default('postgresql://postgres:postgres@localhost:5432/agent_dev_center?schema=public'),
  JWT_SECRET: z.string().min(16).default('dev-only-change-this-secret'),
  JWT_EXPIRES_IN: z.string().default('2h'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-only-refresh-secret-change-me'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('7d'),
  JWT_SECRET_SSO: z.string().min(16).default('dev-only-sso-secret-change-me'),
  // For verifying auth-service JWTs (auth-service shares this secret with all services)
  AUTH_JWT_SECRET: z.string().min(16).default('dev-only-auth-service-secret-16'),
  AUTH_JWT_ISSUER: z.string().default('auth-service'),
  AUTH_JWT_AUDIENCE: z.string().default('agent-platform'),
  // auth-service SSO login endpoint (906e46ab)
  AUTH_SERVICE_URL: z.string().default('http://localhost:4010/api'),
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),
  REGISTER_INVITE_CODE: z.string().optional(),
  FEISHU_WEBHOOK_URL: z.string().optional(),
  AGENT_CALLBACK_URL: z.string().optional(),
  GATEWAY_ALLOWED_IPS: z.string().optional(),
  // 服务注册的健康检查远程基地址（开源默认 localhost）
  ADC_PUBLIC_URL: z.string().default('http://localhost:4000'),
  // 部署服务器地址（仅部署脚本使用）
  SERVER_HOST: z.string().default('your-server-ip'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (
  parsed.data.NODE_ENV === 'production' &&
  (parsed.data.JWT_SECRET === 'dev-only-change-this-secret' ||
    parsed.data.JWT_REFRESH_SECRET === 'dev-only-refresh-secret-change-me' ||
    parsed.data.JWT_SECRET_SSO === 'dev-only-sso-secret-change-me')
) {
  console.error('JWT_SECRET, JWT_REFRESH_SECRET, and JWT_SECRET_SSO must be set to strong values in production.');
  process.exit(1);
}

export const env = parsed.data;
