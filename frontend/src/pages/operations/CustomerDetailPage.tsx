import { ArrowLeftOutlined, EditOutlined, ShoppingCartOutlined, TeamOutlined } from '@ant-design/icons';
import { App as AntApp, Button, Card, Descriptions, Empty, Row, Col, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { operationsApi, type Customer, type Order, type OrderStatus } from '../../api/operations';
import { customerStatusMeta, formatDateTime, formatMoney, moneyToNumber, orderStatusMeta } from './constants';

const { Title, Text } = Typography;

export function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchCustomer = async () => {
      if (!id) return;
      setLoading(true);
      try {
        const { data } = await operationsApi.getCustomer(id);
        setCustomer(data.data);
      } catch {
        message.error('客户详情加载失败');
      } finally {
        setLoading(false);
      }
    };

    void fetchCustomer();
  }, [id, message]);

  const orderStats = useMemo(() => {
    const orders = customer?.orders ?? [];
    const totalAmount = orders.reduce((sum, order) => sum + moneyToNumber(order.amount), 0);
    const completed = orders.filter((order) => order.status === 'completed').length;
    const revenue = orders.reduce((sum, order) => {
      const records = order.revenues ?? [];
      return sum + records.reduce((inner, record) => {
        const value = moneyToNumber(record.amount);
        return inner + (record.type === 'refund' ? -Math.abs(value) : value);
      }, 0);
    }, 0);
    return { total: orders.length, totalAmount, completed, revenue };
  }, [customer]);

  if (loading) return <Spin className="page-spin" />;

  if (!customer) {
    return (
      <Space direction="vertical" align="center" style={{ width: '100%', padding: 48 }}>
        <Empty description="客户不存在" />
        <Button onClick={() => navigate('/operations/customers')}>返回客户列表</Button>
      </Space>
    );
  }

  const statusMeta = customerStatusMeta[customer.status];

  const orderColumns: ColumnsType<Order> = [
    {
      title: '服务类型',
      dataIndex: 'serviceType',
      render: (value: string, record) => (
        <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/operations/orders/${record.id}`)}>
          {value}
        </Button>
      ),
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
      title: '营收记录',
      dataIndex: 'revenues',
      width: 110,
      render: (records: Order['revenues']) => records?.length ?? 0,
    },
    {
      title: '创建时间',
      dataIndex: 'createdAt',
      width: 180,
      render: formatDateTime,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/operations/customers')} />
            <TeamOutlined style={{ fontSize: 24, color: '#1677ff' }} />
            <Title level={3} style={{ margin: 0 }}>{customer.name}</Title>
            <Tag color={statusMeta.color}>{statusMeta.label}</Tag>
          </Space>
          <Button icon={<EditOutlined />} onClick={() => navigate('/operations/customers')}>
            返回编辑
          </Button>
        </div>

        <Row gutter={[16, 16]}>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small"><Statistic title="订单数" value={orderStats.total} /></Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small"><Statistic title="已完成" value={orderStats.completed} /></Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small"><Statistic title="订单金额" value={formatMoney(orderStats.totalAmount)} /></Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small"><Statistic title="已记录营收" value={formatMoney(orderStats.revenue)} /></Card>
          </Col>
        </Row>

        <Card title="客户信息" size="small">
          <Descriptions bordered column={{ xs: 1, md: 2 }} size="small">
            <Descriptions.Item label="客户名称">{customer.name}</Descriptions.Item>
            <Descriptions.Item label="状态"><Tag color={statusMeta.color}>{statusMeta.label}</Tag></Descriptions.Item>
            <Descriptions.Item label="邮箱">{customer.email || '-'}</Descriptions.Item>
            <Descriptions.Item label="电话">{customer.phone || '-'}</Descriptions.Item>
            <Descriptions.Item label="来源">{customer.source || '-'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{formatDateTime(customer.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="更新时间">{formatDateTime(customer.updatedAt)}</Descriptions.Item>
            <Descriptions.Item label="备注" span={2}>{customer.notes || '-'}</Descriptions.Item>
          </Descriptions>
        </Card>

        <Card
          title={<Space><ShoppingCartOutlined /> 订单</Space>}
          size="small"
          extra={<Text type="secondary">{customer.orders?.length ?? 0} 条</Text>}
        >
          <Table
            rowKey="id"
            columns={orderColumns}
            dataSource={customer.orders ?? []}
            pagination={{ pageSize: 10 }}
            scroll={{ x: 820 }}
          />
        </Card>
      </Space>
    </div>
  );
}
