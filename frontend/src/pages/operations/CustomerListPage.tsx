import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { App as AntApp, Button, Card, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  operationsApi,
  type Customer,
  type CustomerPayload,
  type CustomerStatus,
} from '../../api/operations';
import { customerStatusMeta, customerStatusOptions, formatDate, nullWhenEmpty } from './constants';

const { Title, Text } = Typography;

type CustomerFormValues = CustomerPayload & { status: CustomerStatus };

export function CustomerListPage() {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<CustomerFormValues>();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<CustomerStatus | undefined>();
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 20,
    total: 0,
    showSizeChanger: true,
  });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchCustomers = useCallback(async (page = 1, pageSize = 20, nextSearch = search, nextStatus = statusFilter) => {
    setLoading(true);
    try {
      const { data } = await operationsApi.listCustomers({
        page,
        limit: pageSize,
        search: nextSearch || undefined,
        status: nextStatus,
      });
      setCustomers(data.data);
      setPagination((prev) => ({
        ...prev,
        current: data.pagination.page,
        pageSize: data.pagination.limit,
        total: data.pagination.total,
      }));
    } catch {
      message.error('客户列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [message, search, statusFilter]);

  useEffect(() => {
    void fetchCustomers();
  }, []);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      void fetchCustomers(1, pagination.pageSize, value, statusFilter);
    }, 350);
  };

  const handleStatusChange = (value?: CustomerStatus) => {
    setStatusFilter(value);
    void fetchCustomers(1, pagination.pageSize, search, value);
  };

  const openCreateModal = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 'lead' });
    setModalOpen(true);
  };

  const openEditModal = (record: Customer) => {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      email: record.email ?? undefined,
      phone: record.phone ?? undefined,
      source: record.source ?? undefined,
      status: record.status,
      notes: record.notes ?? undefined,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const payload: CustomerPayload = {
      name: values.name,
      email: nullWhenEmpty(values.email),
      phone: nullWhenEmpty(values.phone),
      source: nullWhenEmpty(values.source),
      status: values.status,
      notes: nullWhenEmpty(values.notes),
    };

    setSaving(true);
    try {
      if (editing) {
        await operationsApi.updateCustomer(editing.id, payload);
        message.success('客户已更新');
      } else {
        await operationsApi.createCustomer(payload);
        message.success('客户已创建');
      }
      setModalOpen(false);
      void fetchCustomers(pagination.current, pagination.pageSize);
    } catch {
      message.error('客户保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: Customer) => {
    try {
      await operationsApi.deleteCustomer(record.id);
      message.success('客户已删除');
      void fetchCustomers(pagination.current, pagination.pageSize);
    } catch {
      message.error('客户删除失败，请先确认是否存在关联订单');
    }
  };

  const columns: ColumnsType<Customer> = [
    {
      title: '客户',
      dataIndex: 'name',
      width: 180,
      fixed: 'left',
      render: (name: string, record) => (
        <Space direction="vertical" size={0}>
          <Button type="link" style={{ padding: 0, height: 'auto' }} onClick={() => navigate(`/operations/customers/${record.id}`)}>
            {name}
          </Button>
          <Text type="secondary" style={{ fontSize: 12 }}>{record.email || record.phone || '-'}</Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (status: CustomerStatus) => {
        const meta = customerStatusMeta[status];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '来源',
      dataIndex: 'source',
      width: 120,
      render: (value: string | null) => value || '-',
    },
    {
      title: '订单数',
      dataIndex: ['_count', 'orders'],
      width: 90,
      render: (_: unknown, record) => record._count?.orders ?? 0,
      sorter: (a, b) => (a._count?.orders ?? 0) - (b._count?.orders ?? 0),
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 140,
      render: formatDate,
    },
    {
      title: '备注',
      dataIndex: 'notes',
      ellipsis: true,
      render: (value: string | null) => value || '-',
    },
    {
      title: '操作',
      width: 210,
      fixed: 'right',
      render: (_: unknown, record) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/operations/customers/${record.id}`)}>
            详情
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(record)}>
            编辑
          </Button>
          <Popconfirm title="删除该客户？" onConfirm={() => void handleDelete(record)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <Space>
          <TeamOutlined style={{ fontSize: 24, color: '#1677ff' }} />
          <Title level={3} style={{ margin: 0 }}>客户管理</Title>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>新建客户</Button>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索客户、邮箱、电话"
            value={search}
            onChange={(event) => handleSearch(event.target.value)}
            allowClear
            style={{ width: 260 }}
          />
          <Select
            placeholder="状态"
            allowClear
            value={statusFilter}
            onChange={handleStatusChange}
            options={customerStatusOptions}
            style={{ width: 140 }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void fetchCustomers(pagination.current, pagination.pageSize)} loading={loading}>
            刷新
          </Button>
        </Space>
      </Card>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={customers}
        loading={loading}
        pagination={pagination}
        onChange={(nextPagination) => void fetchCustomers(nextPagination.current, nextPagination.pageSize)}
        scroll={{ x: 1040 }}
      />

      <Modal
        title={editing ? '编辑客户' : '新建客户'}
        open={modalOpen}
        onOk={() => void handleSave()}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="name" label="客户名称" rules={[{ required: true, message: '请输入客户名称' }]}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
            <Select options={customerStatusOptions} />
          </Form.Item>
          <Form.Item name="email" label="邮箱" rules={[{ type: 'email', message: '邮箱格式不正确' }]}>
            <Input maxLength={160} />
          </Form.Item>
          <Form.Item name="phone" label="电话">
            <Input maxLength={40} />
          </Form.Item>
          <Form.Item name="source" label="来源">
            <Input maxLength={80} />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={4} maxLength={1000} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
