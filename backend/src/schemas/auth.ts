import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, '姓名至少需要 2 个字符'),
    email: z.string().trim().email('邮箱格式不正确').transform((email) => email.toLowerCase()),
    password: z.string().min(8, '密码至少需要 8 个字符'),
    role: z.enum(['requester', 'developer']).default('requester')
  })
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().email().transform((email) => email.toLowerCase()),
    password: z.string().min(1)
  })
});
