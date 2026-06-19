import { z } from 'zod';

export const ssoLoginSchema = z.object({
  body: z.object({
    email: z.string().trim().email().transform((email) => email.toLowerCase()),
    password: z.string().min(1),
    // 登录成功后跳转的目标服务（可选）
    redirectService: z.string().optional(),
  }),
});

export const ssoVerifySchema = z.object({
  query: z.object({
    // 可选：指定要验证的服务名，用于检查 token 是否有权限访问该服务
    service: z.string().optional(),
  }),
});

export const ssoTokenSchema = z.object({
  body: z.object({
    // 目标服务名
    service: z.string().trim().min(1),
    // token 有效期（可选，默认 24h）
    expiresIn: z.string().optional(),
  }),
});
