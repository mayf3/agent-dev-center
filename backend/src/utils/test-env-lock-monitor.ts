/**
 * 测试环境锁 TTL 监控 — 超时告警
 *
 * 检查 test_env_lock 持有时间，超过阈值则发送飞书告警。
 * 
 * 规则：
 * 1. 锁持有超过 30 分钟无进展 → 飞书告警催办
 * 2. 锁持有超过 2 小时 → 升级告警给老板
 *
 * 告警仅发送一次（不会重复刷屏），基于 lock.updatedAt 减少误报。
 */

import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';

const LOCK_WARN_MS = 30 * 60 * 1000;   // 30 分钟
const LOCK_ESCALATE_MS = 2 * 60 * 60 * 1000; // 2 小时

/** 上次告警记录：requirementId → warningLevel + timestamp */
const warnedLock = new Map<string, { level: 'warn' | 'escalate'; at: number }>();

/**
 * 检查锁 TTL 并发送告警（由 server.ts 定时调用）
 */
export async function checkTestEnvLockTTL(): Promise<{
  warningCount: number;
  escalateCount: number;
}> {
  const lock = await prisma.testEnvLock.findUnique({ where: { id: 'singleton' } });
  if (!lock) {
    // 锁为空 → 清理所有告警记录
    warnedLock.clear();
    return { warningCount: 0, escalateCount: 0 };
  }

  const now = Date.now();
  const heldMs = now - lock.acquiredAt.getTime();
  const reqIdShort = lock.requirementId?.slice(0, 8) ?? 'unknown';
  const reqTitle = lock.requirementTitle ?? lock.requirementId ?? 'unknown';
  const heldMinutes = Math.round(heldMs / 60000);

  let warningCount = 0;
  let escalateCount = 0;

  // 2 小时 → 升级告警
  if (heldMs > LOCK_ESCALATE_MS) {
    const prev = warnedLock.get(lock.requirementId);
    if (!prev || prev.level !== 'escalate' || (now - prev.at) > LOCK_ESCALATE_MS) {
      await sendFeishuAlert(
        '🔴 [测试环境锁升级告警]',
        `需求「${reqTitle}」(${reqIdShort}) 持有测试环境锁已超过 **2 小时**（实际: ${heldMinutes} 分钟）\n`
        + `锁定时间: ${lock.acquiredAt.toISOString().replace('T', ' ').slice(0, 19)}\n`
        + `请立即检查该需求状态，必要时联系 CTO 强制释放。`,
      );
      warnedLock.set(lock.requirementId, { level: 'escalate', at: now });
      escalateCount = 1;
    }
  }
  // 30 分钟 → 催办告警（仅在未达到升级级别时发送）
  else if (heldMs > LOCK_WARN_MS) {
    const prev = warnedLock.get(lock.requirementId);
    if (!prev || prev.level !== 'warn' || (now - prev.at) > LOCK_WARN_MS) {
      await sendFeishuAlert(
        '🟡 [测试环境锁催办]',
        `需求「${reqTitle}」(${reqIdShort}) 持有测试环境锁已超过 **30 分钟**（实际: ${heldMinutes} 分钟）\n`
        + `锁定时间: ${lock.acquiredAt.toISOString().replace('T', ' ').slice(0, 19)}\n`
        + `请检查该需求是否有进展，超 2 小时将升级告警给老板。`,
      );
      warnedLock.set(lock.requirementId, { level: 'warn', at: now });
      warningCount = 1;
    }
  }

  return { warningCount, escalateCount };
}

/**
 * 发送飞书文本告警
 * 如果 env.FEISHU_WEBHOOK_URL 未配置，仅打印日志
 */
async function sendFeishuAlert(title: string, body: string): Promise<void> {
  const url = env.FEISHU_WEBHOOK_URL;
  if (!url) {
    console.log(`[test-env-lock-monitor] ${title}\n${body}`);
    return;
  }

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') {
      console.warn('[test-env-lock-monitor] FEISHU_WEBHOOK_URL 必须使用 HTTPS');
      return;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        msg_type: 'text',
        content: { text: `${title}\n\n${body}` },
      }),
    });

    if (!response.ok) {
      console.warn(`[test-env-lock-monitor] 飞书告警发送失败: HTTP ${response.status}`);
    }
  } catch (err) {
    console.warn('[test-env-lock-monitor] 飞书告警发送异常:', err);
  }
}
