import { useCallback, useEffect, useRef, useState } from 'react';
import { App as AntApp, Button, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { CopyOutlined, EditOutlined, KeyOutlined, SearchOutlined } from '@ant-design/icons';
import { adminApi } from '../../api/admin';
import type { AdminUser, InternalRole, OkrRole, UserRole } from '../../api/types';
import {
  internalRoleLabels,
  internalRoleOptions,
  okrRoleLabels,
  okrRoleOptions,
  roleLabels,
  userRoleOptions,
} from '../../constants/options';
import { useAuth } from '../../contexts/AuthContext';

export function UsersPage() {
  const { user: currentUser } = useAuth();
  const { message } = AntApp.useApp();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 20,
    total: 0,
    showSizeChanger: true,
  });
  const [search, setSearch] = useState('');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Edit roles modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<AdminUser | null>(null);
  const [editRole, setEditRole] = useState<UserRole | undefined>();
  const [editOkrRole, setEditOkrRole] = useState<OkrRole | undefined>();
  const [editInternalRole, setEditInternalRole] = useState<InternalRole | null | undefined>();
  const [editLoading, setEditLoading] = useState(false);

  // Reset password modal
  const [resetModalOpen, setResetModalOpen] = useState(false);
  const [generatedPassword, setGeneratedPassword] = useState('');
  const [resetTarget, setResetTarget] = useState<AdminUser | null>(null);
  const [resetLoading, setResetLoading] = useState(false);

  const fetchUsers = useCallback(
    async (page = 1, pageSize = 20, searchTerm = '') => {
      setLoading(true);
      try {
        const { data } = await adminApi.fetchUsers(page, pageSize, searchTerm || undefined);
        setUsers(data.data);
        setPagination((prev) => ({
          ...prev,
          current: data.meta.page,
          pageSize: data.meta.pageSize,
          total: data.meta.total,
        }));
      } catch {
        message.error('Failed to load users');
      } finally {
        setLoading(false);
      }
    },
    [message]
  );

  useEffect(() => {
    fetchUsers();
  }, [fetchUsers]);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      fetchUsers(1, pagination.pageSize, value);
    }, 400);
  };

  const handleTableChange = (pag: TablePaginationConfig) => {
    fetchUsers(pag.current, pag.pageSize, search);
  };

  const openEditModal = (record: AdminUser) => {
    setEditingUser(record);
    setEditRole(record.role);
    setEditOkrRole(record.okrRole);
    setEditInternalRole(record.internalRole);
    setEditModalOpen(true);
  };

  const handleEditSave = async () => {
    if (!editingUser) return;
    setEditLoading(true);
    try {
      const data: { role?: UserRole; okrRole?: OkrRole; internalRole?: InternalRole | null } = {};
      if (editRole && editRole !== editingUser.role) data.role = editRole;
      if (editOkrRole && editOkrRole !== editingUser.okrRole) data.okrRole = editOkrRole;
      if (editInternalRole !== editingUser.internalRole) data.internalRole = editInternalRole;

      if (Object.keys(data).length === 0) {
        setEditModalOpen(false);
        setEditLoading(false);
        return;
      }

      await adminApi.updateUserRoles(editingUser.id, data);
      message.success(`Updated roles for ${editingUser.email}`);
      setEditModalOpen(false);
      fetchUsers(pagination.current, pagination.pageSize, search);
    } catch {
      message.error('Failed to update roles');
    } finally {
      setEditLoading(false);
    }
  };

  const openResetModal = (record: AdminUser) => {
    setResetTarget(record);
    setResetModalOpen(true);
  };

  const handleResetPassword = async () => {
    if (!resetTarget) return;
    setResetLoading(true);
    try {
      const { data } = await adminApi.resetUserPassword(resetTarget.id);
      setGeneratedPassword(data.generatedPassword);
    } catch {
      message.error('Failed to reset password');
      setResetModalOpen(false);
    } finally {
      setResetLoading(false);
    }
  };

  const copyPassword = () => {
    navigator.clipboard.writeText(generatedPassword).then(() => {
      message.success('Password copied to clipboard');
    });
  };

  const isAdmin = currentUser?.role === 'admin' || currentUser?.internalRole === 'cto';

  if (!isAdmin) {
    return (
      <div style={{ padding: 48, textAlign: 'center' }}>
        <Typography.Title level={3} type="danger">
          403 - Access Denied
        </Typography.Title>
        <Typography.Text type="secondary">
          You do not have permission to access this page.
        </Typography.Text>
      </div>
    );
  }

  const columns: ColumnsType<AdminUser> = [
    {
      title: 'Email',
      dataIndex: 'email',
      width: 220,
      ellipsis: true,
    },
    {
      title: 'Name',
      dataIndex: 'name',
      width: 140,
      ellipsis: true,
    },
    {
      title: 'Role',
      dataIndex: 'role',
      width: 110,
      render: (val: UserRole) => <Tag color="blue">{roleLabels[val] ?? val}</Tag>,
    },
    {
      title: 'OKR Role',
      dataIndex: 'okrRole',
      width: 120,
      render: (val: OkrRole) => okrRoleLabels[val] ?? val,
    },
    {
      title: 'Internal Role',
      dataIndex: 'internalRole',
      width: 120,
      render: (val: InternalRole | null) => (val ? internalRoleLabels[val] ?? val : '-'),
    },
    {
      title: 'Created',
      dataIndex: 'createdAt',
      width: 140,
      render: (val: string) => (val ? new Date(val).toLocaleDateString() : '-'),
    },
    {
      title: 'Actions',
      width: 180,
      render: (_: unknown, record: AdminUser) => (
        <Space size="small">
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(record)}>
            Edit Roles
          </Button>
          <Popconfirm
            title="Reset this user's password?"
            description="The user will be forced to change password on next login."
            onConfirm={() => openResetModal(record)}
          >
            <Button size="small" danger icon={<KeyOutlined />}>
              Reset Pwd
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Typography.Title level={4} style={{ marginBottom: 16 }}>
        User Management
      </Typography.Title>

      <div style={{ marginBottom: 16 }}>
        <Input
          prefix={<SearchOutlined />}
          placeholder="Search by email or name..."
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          style={{ maxWidth: 400 }}
          allowClear
        />
      </div>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={users}
        loading={loading}
        pagination={pagination}
        onChange={handleTableChange}
        scroll={{ x: 1000 }}
        size="middle"
      />

      {/* Edit Roles Modal */}
      <Modal
        title={`Edit Roles - ${editingUser?.email ?? ''}`}
        open={editModalOpen}
        onOk={handleEditSave}
        onCancel={() => setEditModalOpen(false)}
        confirmLoading={editLoading}
        destroyOnClose
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
              Role
            </Typography.Text>
            <Select
              style={{ width: '100%' }}
              value={editRole}
              onChange={setEditRole}
              options={userRoleOptions}
            />
          </div>
          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
              OKR Role
            </Typography.Text>
            <Select
              style={{ width: '100%' }}
              value={editOkrRole}
              onChange={setEditOkrRole}
              options={okrRoleOptions}
            />
          </div>
          <div>
            <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
              Internal Role
            </Typography.Text>
            <Select
              style={{ width: '100%' }}
              value={editInternalRole ?? undefined}
              onChange={(val) => setEditInternalRole(val ?? null)}
              options={[{ value: undefined, label: '(None)' }, ...internalRoleOptions]}
              allowClear
            />
          </div>
        </div>
      </Modal>

      {/* Reset Password Modal */}
      <Modal
        title={`Reset Password - ${resetTarget?.email ?? ''}`}
        open={resetModalOpen}
        onCancel={() => {
          setResetModalOpen(false);
          setGeneratedPassword('');
        }}
        footer={
          generatedPassword
            ? [
                <Button key="close" onClick={() => { setResetModalOpen(false); setGeneratedPassword(''); }}>
                  Close
                </Button>,
              ]
            : [
                <Button key="cancel" onClick={() => setResetModalOpen(false)}>
                  Cancel
                </Button>,
                <Button key="reset" type="primary" danger loading={resetLoading} onClick={handleResetPassword}>
                  Reset Password
                </Button>,
              ]
        }
        destroyOnClose
      >
        {generatedPassword ? (
          <div style={{ padding: '16px 0' }}>
            <Typography.Paragraph type="warning" style={{ marginBottom: 12 }}>
              Please copy this password now. It will not be shown again.
            </Typography.Paragraph>
            <Input.TextArea
              value={generatedPassword}
              readOnly
              autoSize={{ minRows: 2, maxRows: 3 }}
              style={{ fontFamily: 'monospace' }}
            />
            <Button
              icon={<CopyOutlined />}
              onClick={copyPassword}
              style={{ marginTop: 8 }}
            >
              Copy Password
            </Button>
          </div>
        ) : (
          <Typography.Paragraph>
            This will generate a new random password for <strong>{resetTarget?.email}</strong>.
            The user will be required to change their password on next login.
          </Typography.Paragraph>
        )}
      </Modal>
    </div>
  );
}
