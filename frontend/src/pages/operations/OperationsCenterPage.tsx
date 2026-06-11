import {
  BarChartOutlined,
  DollarOutlined,
  LineChartOutlined,
  RightOutlined,
  ShoppingCartOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { App as AntApp, Card, Col, Row, Space, Spin, Statistic, Typography } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { operationsApi, type RevenueSummary } from '../../api/operations';
import { formatMoney } from './constants';

const { Title, Text } = Typography;

interface CenterStats {
  customers: number;
  orders: number;
  revenue: RevenueSummary['summary'];
}

export function OperationsCenterPage() {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<CenterStats>({
    customers: 0,
    orders: 0,
    revenue: {
      grossRevenue: 0,
      refundAmount: 0,
      netRevenue: 0,
      recurringRevenue: 0,
      oneTimeRevenue: 0,
      recordCount: 0,
    },
  });

  useEffect(() => {
    const fetchStats = async () => {
      setLoading(true);
      try {
        const [customersRes, ordersRes, revenueRes] = await Promise.all([
          operationsApi.listCustomers({ limit: 1 }),
          operationsApi.listOrders({ limit: 1 }),
          operationsApi.getRevenueSummary(),
        ]);

        setStats({
          customers: customersRes.data.pagination.total,
          orders: ordersRes.data.pagination.total,
          revenue: revenueRes.data.data.summary,
        });
      } catch {
        message.error('运营数据加载失败');
      } finally {
        setLoading(false);
      }
    };

    void fetchStats();
  }, [message]);

  const modules = useMemo(() => [
    {
      key: 'customers',
      title: '客户管理',
      value: stats.customers,
      suffix: '个客户',
      icon: <TeamOutlined style={{ color: '#1677ff' }} />,
      path: '/operations/customers',
    },
    {
      key: 'orders',
      title: '订单管理',
      value: stats.orders,
      suffix: '个订单',
      icon: <ShoppingCartOutlined style={{ color: '#52c41a' }} />,
      path: '/operations/orders',
    },
    {
      key: 'revenue',
      title: '营收汇总',
      value: formatMoney(stats.revenue.netRevenue),
      suffix: '净营收',
      icon: <DollarOutlined style={{ color: '#faad14' }} />,
      path: '/operations/revenue',
    },
    {
      key: 'performance',
      title: 'Agent 绩效',
      value: stats.revenue.recordCount,
      suffix: '条营收记录',
      icon: <LineChartOutlined style={{ color: '#722ed1' }} />,
      path: '/operations/agent-performance',
    },
  ], [stats]);

  if (loading) return <Spin className="page-spin" />;

  return (
    <div style={{ padding: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Space>
          <BarChartOutlined style={{ fontSize: 26, color: '#1677ff' }} />
          <Title level={3} style={{ margin: 0 }}>运营中心</Title>
        </Space>
      </div>

      <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="净营收" value={formatMoney(stats.revenue.netRevenue)} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="总订单" value={stats.orders} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="客户数" value={stats.customers} />
          </Card>
        </Col>
        <Col xs={24} sm={12} lg={6}>
          <Card size="small">
            <Statistic title="退款" value={formatMoney(stats.revenue.refundAmount)} />
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        {modules.map((item) => (
          <Col key={item.key} xs={24} sm={12} lg={6}>
            <Card hoverable onClick={() => navigate(item.path)} style={{ height: '100%' }}>
              <Space direction="vertical" size={10} style={{ width: '100%' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space>
                    <span style={{ fontSize: 22 }}>{item.icon}</span>
                    <Text strong>{item.title}</Text>
                  </Space>
                  <RightOutlined style={{ color: '#8c8c8c' }} />
                </div>
                <div>
                  <Text style={{ fontSize: 24, fontWeight: 600 }}>{item.value}</Text>
                  <Text type="secondary" style={{ marginLeft: 8 }}>{item.suffix}</Text>
                </div>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
    </div>
  );
}
