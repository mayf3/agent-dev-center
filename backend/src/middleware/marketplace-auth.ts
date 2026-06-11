/**
 * df8bc303: marketplace 已废弃，保留此文件仅因 goals 模块仍引用 agentTokenRequired。
 * 后续 goals 模块重构后可删除。
 */
import { authRequired } from './auth.js';

/** df8bc303: Declare agentAuth on Express.Request for backward compat */
declare module 'express-serve-static-core' {
  interface Request {
    agentAuth?: { agentId: string };
  }
}

/** 兼容旧 agent_ 前缀 token，直接委托 JWT auth */
export function agentTokenRequired(req: any, res: any, next: any) {
  return authRequired(req, res, next);
}
