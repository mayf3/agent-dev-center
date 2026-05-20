import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';
import type { Response } from 'express';

// ============ SSE 管理 ============

/** 活跃的 SSE 客户端连接，按 userId 分组 */
const sseClients = new Map<string, Set<Response>>();

/** 注册 SSE 客户端 */
export function registerSSEClient(userId: string, res: Response): void {
  if (!sseClients.has(userId)) {
    sseClients.set(userId, new Set());
  }
  sseClients.get(userId)!.add(res);

  // 连接关闭时清理
  res.on('close', () => {
    const clients = sseClients.get(userId);
    if (clients) {
      clients.delete(res);
      if (clients.size === 0) sseClients.delete(userId);
    }
  });
}

/** 向指定用户推送 SSE 事件 */
function pushToUser(userId: string, event: string, data: unknown): void {
  const clients = sseClients.get(userId);
  if (!clients || clients.size === 0) return;

  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      // 写入失败，移除客户端
      clients.delete(res);
    }
  }
}

/** 向所有连接的 SSE 客户端广播 */
function broadcastSSE(event: string, data: unknown): void {
  for (const [userId] of sseClients) {
    pushToUser(userId, event, data);
  }
}

// ============ 通知事件类型 ============

type NotificationEvent =
  | 'requirement.submitted'
  | 'requirement.updated'
  | 'requirement.status_changed'
  | 'requirement.comment_added'
  | 'task.created'
  | 'task.status_changed'
  | 'task.assigned'
  | 'task.deleted'
  | 'report.submitted'
  | 'report.approved'
  | 'report.rejected'
  | 'requirement.decomposed';

interface NotificationPayload {
  id: string;
  title?: string;
  status?: string;
  actor?: string;
  assignee?: string | null;
  assigneeId?: string | null;
  requesterId?: string | null;
  agentType?: string;
  reportType?: string;
  [key: string]: unknown;
}

// ============ 通知标题生成 ============

function generateTitle(event: NotificationEvent, payload: NotificationPayload): string {
  const titles: Record<string, string> = {
    'requirement.submitted': `新需求提交: ${payload.title ?? payload.id}`,
    'requirement.updated': `需求更新: ${payload.title ?? payload.id}`,
    'requirement.status_changed': `需求状态变更: ${payload.title ?? payload.id} → ${payload.status ?? ''}`,
    'requirement.comment_added': `需求评论: ${payload.title ?? payload.id}`,
    'task.created': `新任务创建: ${payload.title ?? payload.id}`,
    'task.status_changed': `任务状态变更: ${payload.title ?? payload.id} → ${payload.status ?? ''}`,
    'task.assigned': `任务分配: ${payload.title ?? payload.id} → ${payload.assignee ?? ''}`,
    'task.deleted': `任务删除: ${payload.title ?? payload.id}`,
    'report.submitted': `报告提交: ${payload.reportType ?? ''} - ${payload.title ?? payload.id}`,
    'report.approved': `报告审批通过: ${payload.reportType ?? ''} - ${payload.title ?? payload.id}`,
    'report.rejected': `报告审批驳回: ${payload.reportType ?? ''} - ${payload.title ?? payload.id}`,
  };
  return titles[event] ?? `${event}: ${payload.title ?? payload.id}`;
}

/** 判断通知应发送给哪些用户 */
function resolveRecipients(event: NotificationEvent, payload: NotificationPayload): (string | null)[] {
  const recipients: (string | null)[] = [];

  // 根据事件类型决定通知谁
  switch (event) {
    case 'requirement.submitted':
    case 'requirement.updated':
      // 通知管理员
      recipients.push(null); // null = 全体/广播
      break;
    case 'requirement.status_changed':
      // 通知需求提出者 + 负责人
      if (payload.requesterId) recipients.push(payload.requesterId);
      if (payload.assigneeId) recipients.push(payload.assigneeId);
      break;
    case 'task.created':
    case 'task.assigned':
    case 'task.status_changed':
      // 通知任务负责人
      if (payload.assigneeId) recipients.push(payload.assigneeId);
      break;
    case 'report.submitted':
    case 'report.approved':
    case 'report.rejected':
      // 通知报告提交者 + 需求提出者
      if (payload.actor) recipients.push(null); // 广播
      break;
    default:
      recipients.push(null);
  }

  return [...new Set(recipients)];
}

// ============ 主通知函数 ============

/** 校验 URL scheme 只允许 https（防止 SSRF） */
function assertHttpsUrl(url: string, label: string): void {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS protocol, got: ${parsed.protocol}`);
  }
}

async function postJson(url: string, body: unknown) {
  assertHttpsUrl(url, 'Notification URL');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Notification request failed with ${response.status}`);
  }
}

export async function notifyEvent(event: NotificationEvent, payload: NotificationPayload): Promise<void> {
  const title = generateTitle(event, payload);
  const content = {
    event,
    requirementId: payload.id,
    status: payload.status,
    actor: payload.actor,
    assignee: payload.assignee,
    timestamp: new Date().toISOString(),
  };

  const jobs: Promise<void>[] = [];

  // 1. 写入数据库
  const recipients = resolveRecipients(event, payload);
  for (const userId of recipients) {
    jobs.push(
      prisma.notification
        .create({
          data: {
            userId,
            type: event,
            title,
            content: content as any,
            relatedReqId: payload.id,
          },
        })
        .then(() => {})
        .catch((err) => {
          console.warn('Failed to write notification to DB:', err.message);
        })
    );
  }

  // 2. SSE 实时推送
  for (const userId of recipients) {
    if (userId) {
      pushToUser(userId, event, { id: payload.id, title, content });
    }
  }
  // 广播类通知（userId=null）推给所有连接
  if (recipients.includes(null)) {
    broadcastSSE(event, { id: payload.id, title, content });
  }

  // 3. 飞书 Webhook（保留原有逻辑）
  const text = `[Agent开发中心] ${event}: ${payload.title ?? payload.id}${
    payload.status ? `，状态：${payload.status}` : ''
  }${payload.assignee ? `，负责人：${payload.assignee}` : ''}`;

  if (env.FEISHU_WEBHOOK_URL) {
    jobs.push(
      postJson(env.FEISHU_WEBHOOK_URL, {
        msg_type: 'text',
        content: { text },
      }).catch(() => {})
    );
  }

  // 4. Agent Callback（保留原有逻辑）
  if (env.AGENT_CALLBACK_URL) {
    jobs.push(
      postJson(env.AGENT_CALLBACK_URL, {
        event,
        payload,
        occurredAt: new Date().toISOString(),
      }).catch(() => {})
    );
  }

  const results = await Promise.allSettled(jobs);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('Notification delivery failed:', result.reason);
    }
  }
}
