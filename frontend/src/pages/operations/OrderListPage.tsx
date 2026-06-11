import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  PlusOutlined,
  ReloadOutlined,
  SearchOutlined,
  ShoppingCartOutlined,
} from '@ant-design/icons';
import { App as AntApp, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { agentsApi, type AgentListItem } from '../../api/agents';
import {
  operationsApi,
  type Customer,
  type Order,
  type OrderPayload,
  type OrderStatus,
} from '../../api/operations';
import { formatDate, formatMoney, moneyToNumber, nullWhenEmpty, orderStatusMeta, orderStatusOptions } from './constants';

const { Title, Text } = Typography;

type OrderFormValues = Omit<OrderPayload, 'amount'> & { amount: number; status: OrderStatus };

interface SelectOption {
  value: string;
  label: string;
}

export function OrderListPage() {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<OrderFormValues>();
  const [orders, setOrders] = useState<Order[]>([]);
  const [customerOptions, setCustomerOptions] = useState<SelectOption[]>([]);
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<OrderStatus | undefined>();
  const [pagination, setPagination] = useState<TablePaginationConfig>({
    current: 1,
    pageSize: 20,
    total: 0,
    showSizeChanger: true,
  });
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const agentMap = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const agentOptions = useMemo(() => agents.map((agent) => ({
    value: agent.id,
    label: agent.displayName || agent.name,
  })), [agents]);

  const fetchOrders = useCallback(async (page = 1, pageSize = 20, nextSearch = search, nextStatus = statusFilter) => {
    setLoading(true);
    try {
      const { data } = await operationsApi.listOrders({
        page,
        limit: pageSize,
        search: nextSearch || undefined,
        status: nextStatus,
      });
      setOrders(data.data);
      setPagination((prev) => ({
        ...prev,
        current: data.pagination.page,
        pageSize: data.pagination.limit,
        total: data.pagination.total,
      }));
    } catch {
      message.error('订单列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [message, search, statusFilter]);

  const fetchCustomerOptions = useCallback(async (keyword = '') => {
    try {
      const { data } = await operationsApi.listCustomers({ search: keyword || undefined, limit: 20 });
      setCustomerOptions(data.data.map((customer) => ({
        value: customer.id,
        label: `${customer.name}${customer.email ? ` (${customer.email})` : ''}`,
      })));
    } catch {
      message.error('客户选项加载失败');
    }
  }, [message]);

  useEffect(() => {
    void fetchOrders();
    void fetchCustomerOptions();
    agentsApi.list().then((res) => setAgents(res.data.data)).catch(() => undefined);
  }, []);

  const handleSearch = (value: string) => {
    setSearch(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      void fetchOrders(1, pagination.pageSize, value, statusFilter);
    }, 350);
  };

  const handleStatusChange = (value?: OrderStatus) => {
    setStatusFilter(value);
    void fetchOrders(1, pagination.pageSize, search, value);
  };

  const ensureCustomerOption = (customer?: Customer) => {
    if (!customer) return;
    setCustomerOptions((prev) => {
      if (prev.some((item) => item.value === customer.id)) return prev;
      return [{ value: customer.id, label: customer.name }, ...prev];
    });
  };

  const openCreateModal = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ status: 'pending' });
    setModalOpen(true);
  };

  const openEditModal = (record: Order) => {
    setEditing(record);
    ensureCustomerOption(record.customer);
    form.setFieldsValue({
      customerId: record.customerId,
      agentId: record.agentId ?? undefined,
      serviceType: record.serviceType,
      amount: moneyToNumber(record.amount),
      status: record.status,
      description: record.description ?? undefined,
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const payload: OrderPayload = {
      customerId: values.customerId,
      agentId: nullWhenEmpty(values.agentId),
      serviceType: values.serviceType,
      amount: Number(values.amount),
      status: values.status,
      description: nullWhenEmpty(values.description),
    };

    setSaving(true);
    try {
      if (editing) {
        await operationsApi.updateOrder(editing.id, payload);
        message.success('订单已更新');
      } else {
        await operationsApi.createOrder(payload);
        message.success('订单已创建');
      }
      setModalOpen(false);
      void fetchOrders(pagination.current, pagination.pageSize);
    } catch {
      message.error('订单保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (record: Order) => {
    try {
      await operationsApi.deleteOrder(record.id);
      message.success('订单已删除');
      void fetchOrders(pagination.current, pagination.pageSize);
    } catch {
      message.error('订单删除失败，请先确认是否存在营收记录');
    }
  };

  const columns: ColumnsType<Order> = [
    {
      title: '服务类型',
      dataIndex: 'serviceType',
      width: 180,
      fixed: 'left',
      render: (value: string, record) => (
        <Button type="link" style={{ padding: 0, height: 'auto' }} onClick={() => navigate(`/operations/orders/${record.id}`)}>
          {value}
        </Button>
      ),
    },
    {
      title: '客户',
      dataIndex: ['customer', 'name'],
      width: 180,
      render: (_: unknown, record) => record.customer ? (
        <Button type="link" style={{ padding: 0, height: 'auto' }} onClick={() => navigate(`/operations/customers/${record.customerId}`)}>
          {record.customer.name}
        </Button>
      ) : record.customerId,
    },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 130,
      render: formatMoney,
      sorter: (a, b) => moneyToNumber(a.amount) - moneyToNumber(b.amount),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (status: OrderStatus) => {
        const meta = orderStatusMeta[status];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: 'Agent',
      dataIndex: 'agentId',
      width: 160,
      render: (agentId: string | null) => {
        if (!agentId) return '-';
        const agent = agentMap.get(agentId);
        return agent ? agent.displayName || agent.name : <Text code>{agentId.slice(0, 8)}</Text>;
      },
    },
    {
      title: '营收记录',
      dataIndex: 'revenues',
      width: 100,
      render: (records: Order['revenues']) => records?.length ?? 0,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 140,
      render: formatDate,
    },
    {
      title: '操作',
      width: 210,
      fixed: 'right',
      render: (_: unknown, record) => (
        <Space size="small">
          <Button size="small" icon={<EyeOutlined />} onClick={() => navigate(`/operations/orders/${record.id}`)}>
            详情
          </Button>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditModal(record)}>
            编辑
          </Button>
          <Popconfirm title="删除该订单？" onConfirm={() => void handleDelete(record)}>
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
          <ShoppingCartOutlined style={{ fontSize: 24, color: '#1677ff' }} />
          <Title level={3} style={{ margin: 0 }}>订单管理</Title>
        </Space>
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreateModal}>新建订单</Button>
      </div>

      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap>
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索服务、客户"
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
            options={orderStatusOptions}
            style={{ width: 140 }}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void fetchOrders(pagination.current, pagination.pageSize)} loading={loading}>
            刷新
          </Button>
        </Space>
      </Card>

      <Table
        rowKey="id"
        columns={columns}
        dataSource={orders}
        loading={loading}
        pagination={pagination}
        onChange={(nextPagination) => void fetchOrders(nextPagination.current, nextPagination.pageSize)}
        scroll={{ x: 1220 }}
      />

      <Modal
        title={editing ? '编辑订单' : '新建订单'}
        open={modalOpen}
        onOk={() => void handleSave()}
        onCancel={() => setModalOpen(false)}
        confirmLoading={saving}
        destroyOnClose
      >
        <Form form={form} layout="vertical" preserve={false}>
          <Form.Item name="customerId" label="客户" rules={[{ required: true, message: '请选择客户' }]}>
            <Select
              showSearch
              filterOption={false}
              onSearch={fetchCustomerOptions}
              options={customerOptions}
              placeholder="搜索客户"
            />
          </Form.Item>
          <Form.Item name="agentId" label="Agent">
            <Select
              showSearch
              allowClear
              optionFilterProp="label"
              options={agentOptions}
              placeholder="选择交付 Agent"
            />
          </Form.Item>
          <Form.Item name="serviceType" label="服务类型" rules={[{ required: true, message: '请输入服务类型' }]}>
            <Input maxLength={120} />
          </Form.Item>
          <Form.Item name="amount" label="订单金额" rules={[{ required: true, message: '请输入订单金额' }]}>
            <InputNumber min={0} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="status" label="状态" rules={[{ required: true, message: '请选择状态' }]}>
            <Select options={orderStatusOptions} />
          </Form.Item>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={4} maxLength={1000} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
