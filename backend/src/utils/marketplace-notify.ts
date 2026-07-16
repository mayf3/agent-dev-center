import { env } from '../config/env.js';
import { prisma } from '../lib/prisma.js';

/**
 * 通知 Agent 有新的任务
 *
 * 根据 Agent 的通知配置，通过 webhook 或飞书发送通知。
 * 静默失败（不抛出异常）。
 */
export async function notifyAgentNewTask(taskId: string, agentId: string): Promise<void> {
  try {
    const agent = await prisma.marketplaceAgent.findUnique({
      where: { id: agentId },
      select: {
        id: true,
        name: true,
        displayName: true,
        notificationType: true,
        feishuWebhookUrl: true,
        apiEndpoint: true,
      },
    });

    if (!agent) return;

    const task = await prisma.marketplaceTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        title: true,
        description: true,
        priority: true,
        requesterName: true,
      },
    });

    if (!task) return;

    // 根据通知类型发送
    switch (agent.notificationType) {
      case 'webhook':
        if (agent.apiEndpoint) {
          await postJson(agent.apiEndpoint, {
            event: 'task.created',
            task: {
              id: task.id,
              title: task.title,
              description: task.description,
              priority: task.priority,
              requester: task.requesterName,
            },
            agent: { name: agent.name, displayName: agent.displayName },
          });
        }
        break;

      case 'feishu':
        if (agent.feishuWebhookUrl) {
          await postJson(agent.feishuWebhookUrl, {
            msg_type: 'interactive',
            card: {
              header: {
                title: { tag: 'plain_text', content: `🤖 新任务: ${task.title}` },
                template: 'blue',
              },
              elements: [
                { tag: 'markdown', content: `**来自**: ${task.requesterName}` },
                { tag: 'markdown', content: `**优先级**: ${task.priority}` },
                { tag: 'markdown', content: `**描述**: ${task.description.slice(0, 500)}` },
                { tag: 'markdown', content: `**任务 ID**: \`${task.id}\`` },
              ],
            },
          });
        }
        break;

      case 'polling':
        // Agent 定期轮询，无需主动通知
        break;
    }

    // 标记已通知
    await prisma.marketplaceTask.update({
      where: { id: taskId },
      data: { notifiedAt: new Date() },
    });
  } catch {
    // 通知失败不阻塞主流程
  }
}

async function postJson(url: string, body: unknown): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}
