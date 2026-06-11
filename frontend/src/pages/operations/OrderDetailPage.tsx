import { ArrowLeftOutlined, DeleteOutlined, DollarOutlined, EditOutlined, PlusOutlined, ShoppingCartOutlined } from '@ant-design/icons';
import { App as AntApp, Button, Card, Col, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { agentsApi, type AgentListItem } from '../../api/agents';
import {
  operationsApi,
  type Order,
  type OrderStatus,
  type RevenueRecord,
  type RevenueRecordPayload,
  type RevenueType,
} from '../../api/operations';
import {
  formatDateTime,
  formatMoney,
  moneyToNumber,
  nullWhenEmpty,
  orderStatusMeta,
  revenueTypeMeta,
  revenueTypeOptions,
} from './constants';

const { Title, Text } = Typography;

type RevenueFormValues = RevenueRecordPayload & { amount: number; type: RevenueType };

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [form] = Form.useForm<RevenueFormValues>();
  const [order, setOrder] = useState<Order | null>(null);
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<RevenueRecord | null>(null);

  const agentMap = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents]);
  const agentOptions = useMemo(() => agents.map((agent) => ({
    value: agent.id,
    label: agent.displayName || agent.name,
  })), [agents]);

  const fetchOrder = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const { data } = await operationsApi.getOrder(id);
      setOrder(data.data);
    } catch {
      message.error('订单详情加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchOrder();
    agentsApi.list().then((res) => setAgents(res.data.data)).catch(() => undefined);
  }, [id]);

  const revenueStats = useMemo(() => {
    const records = order?.revenues ?? [];
    return records.reduce((stats, record) => {
      const amount = moneyToNumber(record.amount);
      if (record.type === 'refund') {
        stats.refund += Math.abs(amount);
        stats.net -= Math.abs(amount);
      } else {
        stats.gross += amount;
        stats.net += amount;
      }
      return stats;
    }, { gross: 0, refund: 0, net: 0 });
  }, [order]);

  if (loading) return <Spin className="page-spin" />;

  if (!order) {
    return (
      <Space direction="vertical" align="center" style={{ width: '100%', padding: 48 }}>
        <Typography.Text type="secondary">订单不存在</Typography.Text>
        <Button onClick={() => navigate('/operations/orders')}>返回订单列表</Button>
      </Space>
    );
  }

  const statusMeta = orderStatusMeta[order.status];
  const orderAgent = order.agentId ? agentMap.get(order.agentId) : null;

  const openCreateRevenue = () => {
    setEditingRecord(null);
    form.resetFields();
    form.setFieldsValue({
      agentId: order.agentId ?? undefined,
      amount: moneyToNumber(order.amount),
      type: 'one_time',
      month: currentMonth(),
    });
    setModalOpen(true);
  };

  const openEditRevenue = (record: RevenueRecord) => {
    setEditingRecord(record);
    form.setFieldsValue({
      agentId: record.agentId ?? undefined,
      amount: moneyToNumber(record.amount),
      type: record.type,
      month: record.month ?? undefined,
    });
    setModalOpen(true);
  };

  const handleSaveRevenue = async () => {
    const values = await form.validateFields();
    const payload: RevenueRecordPayload = {
      agentId: nullWhenEmpty(values.agentId),
      amount: Number(values.amount),
      type: values.type,
      month: nullWhenEmpty(values.month),
    };

    setSaving(true);
    try {
      if (editingRecord) {
        await operationsApi.updateRevenueRecord(editingRecord.id, payload);
        message.success('营收记录已更新');
      } else {
        await operationsApi.createRevenueRecord(order.id, payload);
        message.success('营收记录已创建');
      }
      setModalOpen(false);
      await fetchOrder();
    } catch {
      message.error('营收记录保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteRevenue = async (record: RevenueRecord) => {
    try {
      await operationsApi.deleteRevenueRecord(record.id);
      message.success('营收记录已删除');
      await fetchOrder();
    } catch {
      message.error('营收记录删除失败');
    }
  };

  const revenueColumns: ColumnsType<RevenueRecord> = [
    {
      title: '月份',
      dataIndex: 'month',
      width: 110,
      render: (value: string | null) => value || '-',
    },
    {
      title: '类型',
      dataIndex: 'type',
      width: 110,
      render: (type: RevenueType) => {
        const meta = revenueTypeMeta[type];
        return <Tag color={meta.color}>{meta.label}</Tag>;
      },
    },
    {
      title: '金额',
      dataIndex: 'amount',
      width: 130,
      render: (_: unknown, record) => (
        <Text type={record.type === 'refund' ? 'danger' : undefined}>
          {record.type === 'refund' ? '-' : ''}{formatMoney(record.amount)}
        </Text>
      ),
      sorter: (a, b) => moneyToNumber(a.amount) - moneyToNumber(b.amount),
    },
    {
      title: 'Agent',
      dataIndex: 'agentId',
      render: (agentId: string | null) => {
        if (!agentId) return '-';
        const agent = agentMap.get(agentId);
        return agent ? agent.displayName || agent.name : <Text code>{agentId.slice(0, 8)}</Text>;
      },
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      render: formatDateTime,
    },
    {
      title: '操作',
      width: 140,
      render: (_: unknown, record) => (
        <Space size="small">
          <Button size="small" icon={<EditOutlined />} onClick={() => openEditRevenue(record)} />
          <Popconfirm title="删除该营收记录？" onConfirm={() => void handleDeleteRevenue(record)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/operations/orders')} />
            <ShoppingCartOutlined style={{ fontSize: 24, color: '#1677ff' }} />
            <Title level={3} style={{ margin: 0 }}>{order.serviceType}</Title>
            <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
          </Space>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreateRevenue}>新增营收</Button>
        </div>

        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small"><Statistic title="订单金额" value={formatMoney(order.amount)} /></Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small"><Statistic title="营收净额" value={formatMoney(revenueStats.net)} /></Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small"><Statistic title="退款" value={formatMoney(revenueStats.refund)} /></Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small"><Statistic title="记录数" value={order.revenues?.length ?? 0} /></Card>
          </Col>
        </Row>

        <Card title="订单信息" size="small">
          <Descriptions bordered column={{ xs: 1, md: 2 }} size="small">
            <Descriptions.Item label="客户">
              {order.customer ? (
                <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/operations/customers/${order.customerId}`)}>
                  {order.customer.name}
                </Button>
              ) : order.customerId}
            </Descriptions.Item>
            <Descriptions.Item label="状态"><Tag color={statusMeta.color}>{statusMeta.label}</Tag></Descriptions.Item>
            <Descriptions.Item label="服务类型">{order.serviceType}</Descriptions.Item>
            <Descriptions.Item label="订单金额">{formatMoney(order.amount)}</Descriptions.Item>
            <Descriptions.Item label="Agent">{orderAgent ? orderAgent.displayName || orderAgent.name : order.agentId || '-'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{formatDateTime(order.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="更新时间">{formatDateTime(order.updatedAt)}</Descriptions.Item>
            <Descriptions.Item label="描述" span={2}>{order.description || '-'}</Descriptions.Item>
          </Descriptions>
        </Card>

        <Card
          title={<Space><DollarOutlined /> 营收记录</Space>}
          size="small"
          extra={<Button size="small" icon={<PlusOutlined />} onClick={openCreateRevenue}>新增</Button>}
        >
          <Table
            rowKey="id"
            columns={revenueColumns}
            dataSource={order.revenues ?? []}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 820 }}
          />
        </Card>

        <Modal
          title={editingRecord ? '编辑营收记录' : '新增营收记录'}
          open={modalOpen}
          onOk={() => void handleSaveRevenue()}
          onCancel={() => setModalOpen(false)}
          confirmLoading={saving}
          destroyOnClose
        >
          <Form form={form} layout="vertical" preserve={false}>
            <Form.Item name="type" label="类型" rules={[{ required: true, message: '请选择类型' }]}>
              <Select options={revenueTypeOptions} />
            </Form.Item>
            <Form.Item name="amount" label="金额" rules={[{ required: true, message: '请输入金额' }]}>
              <InputNumber min={0} precision={2} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="month"
              label="月份"
              rules={[{ pattern: /^\d{4}-(0[1-9]|1[0-2])$/, message: '格式为 YYYY-MM' }]}
            >
              <Input placeholder="YYYY-MM" />
            </Form.Item>
            <Form.Item name="agentId" label="Agent">
              <Select allowClear showSearch optionFilterProp="label" options={agentOptions} />
            </Form.Item>
          </Form>
        </Modal>
      </Space>
    </div>
  );
}
