import { z } from 'zod';

export const registerSchema = z.object({
  body: z.object({
    name: z.string().trim().min(2, '姓名至少需要 2 个字符'),
    email: z.string().trim().email('邮箱格式不正确').transform((email) => email.toLowerCase()),
    password: z.string().min(6, '密码至少需要 6 个字符').optional(),  // bf651cbc: optional, auto-gen if omitted
    role: z.enum(['requester', 'developer', 'cto-agent']).default('requester').transform(r => r === 'cto-agent' ? 'cto_agent' : r),
    inviteCode: z.string().min(1, '邀请码不能为空')  // e03c7b39: 邀请码必填
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

export const adminResetPasswordSchema = z.object({
  body: z.object({
    email: z.string().trim().email().transform((email) => email.toLowerCase())
  })
});

export const batchRegisterSchema = z.object({
  body: z.object({
    agents: z.array(z.object({
      name: z.string().trim().min(2, '姓名至少需要 2 个字符'),
      email: z.string().trim().email('邮箱格式不正确').transform((email) => email.toLowerCase()),
      password: z.string().min(6, '密码至少需要 6 个字符').optional(),  // bf651cbc: optional, auto-gen if omitted
      role: z.enum(['requester', 'developer', 'agent', 'cto-agent']).default('agent').transform(r => r === 'cto-agent' ? 'cto_agent' : r),
      internalRole: z.enum(['cto', 'pm', 'tester', 'security', 'ops', 'qa', 'architect']).optional()
    })).min(1, '至少需要注册 1 个 Agent').max(100, '单次最多注册 100 个 Agent')
  })
});

export const forceChangePasswordSchema = z.object({
  body: z.object({
    newPassword: z.string().min(6, '新密码至少需要 6 个字符')
  })
});
