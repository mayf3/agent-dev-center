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
  FRONTEND_ORIGIN: z.string().default('http://localhost:5173'),
  FEISHU_WEBHOOK_URL: z.string().optional(),
  AGENT_CALLBACK_URL: z.string().optional()
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment variables:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

if (
  parsed.data.NODE_ENV === 'production' &&
  (parsed.data.JWT_SECRET === 'dev-only-change-this-secret' ||
    parsed.data.JWT_REFRESH_SECRET === 'dev-only-refresh-secret-change-me')
) {
  console.error('JWT_SECRET and JWT_REFRESH_SECRET must be set to strong values in production.');
  process.exit(1);
}

export const env = parsed.data;
