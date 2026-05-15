import { env } from '../config/env.js';

/**
 * 同步 Agent 到目标平台
 *
 * 注册/更新 Agent 后自动推送到 LLM Todo。
 * 静默失败（不阻塞主流程）。
 */
interface AgentSyncData {
  agentId: string;
  name: string;
  role: string;
  permissions: string[];
}

export async function syncAgentToLlmTodo(agent: AgentSyncData): Promise<void> {
  const targetUrl = process.env.LLM_TODO_SYNC_URL || env.AGENT_CALLBACK_URL;
  if (!targetUrl) return;

  try {
    const syncUrl = new URL('/api/agent/sync', targetUrl).toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

    await fetch(syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents: [agent] }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch {
    // 同步失败不阻塞
  }
}

/**
 * 批量同步 Agent 到 LLM Todo
 */
export async function syncAgentsToLlmTodo(agents: AgentSyncData[]): Promise<void> {
  const targetUrl = process.env.LLM_TODO_SYNC_URL || env.AGENT_CALLBACK_URL;
  if (!targetUrl) return;

  try {
    const syncUrl = new URL('/api/agent/sync', targetUrl).toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    await fetch(syncUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agents }),
      signal: controller.signal,
    });

    clearTimeout(timeout);
  } catch {
    // 同步失败不阻塞
  }
}
