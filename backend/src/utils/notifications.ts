import { env } from '../config/env.js';

type NotificationEvent =
  | 'requirement.submitted'
  | 'requirement.updated'
  | 'requirement.status_changed'
  | 'task.created'
  | 'task.status_changed'
  | 'task.deleted';

interface NotificationPayload {
  id: string;
  title?: string;
  status?: string;
  actor?: string;
  assignee?: string | null;
  agentType?: string;
}

/** 校验 URL scheme 只允许 https（防止 SSRF） */
function assertHttpsUrl(url: string, label: string): void {
  const parsed: URL = new URL(url);
  if (parsed.protocol !== 'https:') {
    throw new Error(`${label} must use HTTPS protocol, got: ${parsed.protocol}`);
  }
}

async function postJson(url: string, body: unknown) {
  assertHttpsUrl(url, 'Notification URL');
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`Notification request failed with ${response.status}`);
  }
}

export async function notifyEvent(event: NotificationEvent, payload: NotificationPayload) {
  const jobs: Promise<void>[] = [];
  const text = `[Agent开发中心] ${event}: ${payload.title ?? payload.id}${
    payload.status ? `，状态：${payload.status}` : ''
  }${payload.assignee ? `，负责人：${payload.assignee}` : ''}`;

  if (env.FEISHU_WEBHOOK_URL) {
    jobs.push(
      postJson(env.FEISHU_WEBHOOK_URL, {
        msg_type: 'text',
        content: { text }
      })
    );
  }

  if (env.AGENT_CALLBACK_URL) {
    jobs.push(
      postJson(env.AGENT_CALLBACK_URL, {
        event,
        payload,
        occurredAt: new Date().toISOString()
      })
    );
  }

  const results = await Promise.allSettled(jobs);
  for (const result of results) {
    if (result.status === 'rejected') {
      console.warn('Notification delivery failed:', result.reason);
    }
  }
}
