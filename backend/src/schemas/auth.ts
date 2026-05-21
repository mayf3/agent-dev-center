import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, '姓名至少需要 2 个字符'),
    email: z.string().trim().email('邮箱格式不正确').transform((email) => email.toLowerCase()),
    password: z.string().min(8, '密码至少需要 8 个字符'),
    role: z.enum(['requester', 'developer', 'cto-agent']).default('requester').transform(r => r === 'cto-agent' ? 'cto_agent' : r),
    inviteCode: z.string().optional().default('')
  })
});

export const loginSchema = z.object({
  body: z.object({
    email: z.string().trim().email().transform((email) => email.toLowerCase()),
    password: z.string().min(1)
  })
});

export const changePasswordSchema = z.object({
  body: z.object({
    oldPassword: z.string().min(1, '请输入当前密码'),
    newPassword: z.string().min(6, '新密码至少需要 6 个字符')
  })
});
