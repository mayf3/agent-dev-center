import { useState, useEffect } from 'react';
import { api } from '../api/client';

interface AgentUser {
  id: string;
  agentId: string | null;
  name: string;
  permissions: string[];
  createdAt: string;
}

const ROLE_OPTIONS = [
  { value: 'admin-agent', label: '管理员 Agent', color: '#ef4444' },
  { value: 'manager-agent', label: '主管 Agent', color: '#f59e0b' },
  { value: 'dev-agent', label: '开发 Agent', color: '#3b82f6' },
  { value: 'viewer-agent', label: '观察者 Agent', color: '#6b7280' },
] as const;

const ROLE_PERMISSIONS: Record<string, string[]> = {
  'admin-agent': ['admin'],
  'manager-agent': ['todo:read', 'todo:write', 'requirement:read', 'requirement:write', 'marketplace:read', 'marketplace:write'],
  'dev-agent': ['todo:read', 'todo:write', 'requirement:read', 'marketplace:read', 'marketplace:claim'],
  'viewer-agent': ['todo:read', 'requirement:read', 'marketplace:read'],
};

const PERMISSION_LABELS: Record<string, string> = {
  'todo:read': 'Todo 读取',
  'todo:write': 'Todo 写入',
  'requirement:read': '需求读取',
  'requirement:write': '需求写入',
  'requirement:approve': '需求审批',
  'marketplace:read': '集市读取',
  'marketplace:write': '集市写入',
  'marketplace:claim': '集市认领',
  'admin': '全部权限',
};

export default function AgentSsoPage() {
  const [agents, setAgents] = useState<AgentUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingAgent, setEditingAgent] = useState<string | null>(null);
  const [editRole, setEditRole] = useState('dev-agent');
  const [syncing, setSyncing] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');

  useEffect(() => {
    loadAgents();
  }, []);

  async function loadAgents() {
    try {
      setLoading(true);
      const res = await api.get('/auth/agent/agents');
      setAgents(res.data.data ?? []);
    } catch (err: any) {
      setError(err.response?.data?.message || '加载 Agent 列表失败');
    } finally {
      setLoading(false);
    }
  }

  async function updateRole(agentId: string) {
    try {
      const permissions = ROLE_PERMISSIONS[editRole] ?? [];
      await api.put(`/auth/agent/agents/${agentId}`, {
        role: editRole,
        permissions,
      });
      setEditingAgent(null);
      loadAgents();
    } catch (err: any) {
      setError(err.response?.data?.message || '更新失败');
    }
  }

  async function syncToLlmTodo() {
    try {
      setSyncing(true);
      setSyncMsg('');
      // 调用 migrate 端点触发全量同步（幂等，已存在的会 skipped）
      const agentsPayload = agents
        .filter((a) => a.agentId)
        .map((a) => ({
          id: a.agentId,
          name: a.name,
          category: '',
          token: '',
          capabilities: [],
        }));
      const res = await api.post('/auth/agent/migrate', { agents: agentsPayload });
      const data = res.data;
      setSyncMsg(`同步完成: ${data.created} 新建, ${data.skipped} 已存在, ${data.errors} 错误`);
    } catch (err: any) {
      setSyncMsg(`同步失败: ${err.response?.data?.message || err.message}`);
    } finally {
      setSyncing(false);
    }
  }

  function getRoleForAgent(agent: AgentUser): string {
    const perms = agent.permissions ?? [];
    for (const [role, rolePerms] of Object.entries(ROLE_PERMISSIONS)) {
      if (JSON.stringify(perms.sort()) === JSON.stringify([...rolePerms].sort())) {
        return role;
      }
    }
    return perms.includes('admin') ? 'admin-agent' : 'dev-agent';
  }

  const roleBadge = (role: string) => {
    const opt = ROLE_OPTIONS.find((r) => r.value === role);
    return (
      <span
        style={{
          display: 'inline-block',
          padding: '2px 10px',
          borderRadius: 12,
          fontSize: 12,
          color: '#fff',
          background: opt?.color ?? '#6b7280',
        }}
      >
        {opt?.label ?? role}
      </span>
    );
  };

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <div>
          <h2 style={{ margin: 0 }}>🤖 Agent SSO 统一认证</h2>
          <p style={{ color: '#6b7280', margin: '4px 0 0' }}>
            管理所有 Agent 的身份和权限，一套凭据访问所有平台
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={loadAgents}
            style={{
              padding: '8px 16px',
              background: '#f3f4f6',
              border: '1px solid #d1d5db',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            🔄 刷新
          </button>
          <button
            onClick={syncToLlmTodo}
            disabled={syncing}
            style={{
              padding: '8px 16px',
              background: syncing ? '#9ca3af' : '#3b82f6',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: syncing ? 'not-allowed' : 'pointer',
            }}
          >
            {syncing ? '⏳ 同步中...' : '📤 同步到 LLM Todo'}
          </button>
        </div>
      </div>

      {error && (
        <div style={{ padding: 12, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, marginBottom: 16, color: '#dc2626' }}>
          {error}
          <button onClick={() => setError('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#dc2626' }}>✕</button>
        </div>
      )}

      {syncMsg && (
        <div style={{ padding: 12, background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, marginBottom: 16, color: '#16a34a' }}>
          {syncMsg}
          <button onClick={() => setSyncMsg('')} style={{ float: 'right', background: 'none', border: 'none', cursor: 'pointer', color: '#16a34a' }}>✕</button>
        </div>
      )}

      {/* 权限矩阵 */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <h3 style={{ margin: '0 0 12px' }}>📋 权限矩阵</h3>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={{ padding: 8, textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>角色</th>
                <th style={{ padding: 8, textAlign: 'center', borderBottom: '2px solid #e5e7eb' }}>Todo</th>
                <th style={{ padding: 8, textAlign: 'center', borderBottom: '2px solid #e5e7eb' }}>需求平台</th>
                <th style={{ padding: 8, textAlign: 'center', borderBottom: '2px solid #e5e7eb' }}>集市</th>
                <th style={{ padding: 8, textAlign: 'center', borderBottom: '2px solid #e5e7eb' }}>Admin</th>
              </tr>
            </thead>
            <tbody>
              {ROLE_OPTIONS.map((role) => {
                const perms = ROLE_PERMISSIONS[role.value] ?? [];
                const hasTodo = perms.includes('todo:write') || perms.includes('admin');
                const hasReqWrite = perms.includes('requirement:write') || perms.includes('admin');
                const hasReqApprove = perms.includes('requirement:approve') || perms.includes('admin');
                const hasMkWrite = perms.includes('marketplace:write') || perms.includes('admin');
                const hasAdmin = perms.includes('admin');
                return (
                  <tr key={role.value}>
                    <td style={{ padding: 8, borderBottom: '1px solid #f3f4f6' }}>{roleBadge(role.value)}</td>
                    <td style={{ padding: 8, textAlign: 'center', borderBottom: '1px solid #f3f4f6' }}>
                      {hasTodo ? '✅ 读写' : perms.includes('todo:read') ? '👁️ 只读' : '❌'}
                    </td>
                    <td style={{ padding: 8, textAlign: 'center', borderBottom: '1px solid #f3f4f6' }}>
                      {hasAdmin ? '读写审批' : hasReqWrite ? '读写' : hasReqApprove ? '审批' : perms.includes('requirement:read') ? '只读' : '❌'}
                    </td>
                    <td style={{ padding: 8, textAlign: 'center', borderBottom: '1px solid #f3f4f6' }}>
                      {hasMkWrite ? '读写' : perms.includes('marketplace:claim') ? '认领' : perms.includes('marketplace:read') ? '只读' : '❌'}
                    </td>
                    <td style={{ padding: 8, textAlign: 'center', borderBottom: '1px solid #f3f4f6' }}>
                      {hasAdmin ? '✅' : '❌'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Agent 列表 */}
      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8 }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0 }}>👥 Agent 列表 ({agents.length})</h3>
        </div>

        {loading ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>加载中...</div>
        ) : agents.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: '#9ca3af' }}>暂无 Agent，请先运行迁移脚本</div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={{ padding: 8, textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>Agent</th>
                <th style={{ padding: 8, textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>角色</th>
                <th style={{ padding: 8, textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>权限</th>
                <th style={{ padding: 8, textAlign: 'left', borderBottom: '2px solid #e5e7eb' }}>注册时间</th>
                <th style={{ padding: 8, textAlign: 'right', borderBottom: '2px solid #e5e7eb' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {agents.map((agent) => {
                const role = getRoleForAgent(agent);
                const isEditing = editingAgent === agent.agentId;

                return (
                  <tr key={agent.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                    <td style={{ padding: 8 }}>
                      <div style={{ fontWeight: 600 }}>{agent.name}</div>
                      <div style={{ color: '#9ca3af', fontSize: 11 }}>{agent.agentId}</div>
                    </td>
                    <td style={{ padding: 8 }}>
                      {isEditing ? (
                        <select
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value)}
                          style={{ padding: '4px 8px', borderRadius: 4, border: '1px solid #d1d5db' }}
                        >
                          {ROLE_OPTIONS.map((r) => (
                            <option key={r.value} value={r.value}>{r.label}</option>
                          ))}
                        </select>
                      ) : (
                        roleBadge(role)
                      )}
                    </td>
                    <td style={{ padding: 8 }}>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                        {(agent.permissions ?? []).map((p) => (
                          <span
                            key={p}
                            style={{
                              padding: '1px 6px',
                              background: p === 'admin' ? '#fef3c7' : '#eff6ff',
                              borderRadius: 4,
                              fontSize: 11,
                            }}
                          >
                            {PERMISSION_LABELS[p] ?? p}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ padding: 8, color: '#6b7280', fontSize: 12 }}>
                      {new Date(agent.createdAt).toLocaleDateString('zh-CN')}
                    </td>
                    <td style={{ padding: 8, textAlign: 'right' }}>
                      {isEditing ? (
                        <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                          <button
                            onClick={() => updateRole(agent.agentId!)}
                            style={{ padding: '4px 12px', background: '#10b981', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                          >
                            保存
                          </button>
                          <button
                            onClick={() => setEditingAgent(null)}
                            style={{ padding: '4px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => {
                            setEditingAgent(agent.agentId);
                            setEditRole(getRoleForAgent(agent));
                          }}
                          style={{ padding: '4px 12px', background: '#f3f4f6', border: '1px solid #d1d5db', borderRadius: 4, cursor: 'pointer' }}
                        >
                          ✏️ 编辑
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
