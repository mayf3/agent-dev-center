import { DollarOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { App as AntApp, Button, Card, Col, Input, Row, Select, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { operationsApi, type RevenueRecord, type RevenueSummary, type RevenueType } from '../../api/operations';
import { formatDateTime, formatMoney, moneyToNumber, revenueTypeMeta, revenueTypeOptions } from './constants';

const { Title, Text } = Typography;

const emptySummary: RevenueSummary = {
  summary: {
    grossRevenue: 0,
    refundAmount: 0,
    netRevenue: 0,
    recurringRevenue: 0,
    oneTimeRevenue: 0,
    recordCount: 0,
  },
  monthly: [],
  byAgent: [],
  recentRecords: [],
};

type MonthlyRow = RevenueSummary['monthly'][number];
type AgentRow = RevenueSummary['byAgent'][number];

export function RevenueSummaryPage() {
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<RevenueSummary>(emptySummary);
  const [monthFrom, setMonthFrom] = useState('');
  const [monthTo, setMonthTo] = useState('');
  const [typeFilter, setTypeFilter] = useState<RevenueType | undefined>();

  const fetchSummary = async () => {
    setLoading(true);
    try {
      const { data } = await operationsApi.getRevenueSummary({
        monthFrom: monthFrom || undefined,
        monthTo: monthTo || undefined,
        type: typeFilter,
      });
      setSummary(data.data);
    } catch {
      message.error('营收汇总加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchSummary();
  }, []);

  const monthlyColumns: ColumnsType<MonthlyRow> = [
    {
      title: '月份',
      dataIndex: 'month',
      width: 120,
      sorter: (a, b) => a.month.localeCompare(b.month),
      defaultSortOrder: 'descend',
    },
    {
      title: '毛收入',
      dataIndex: 'grossRevenue',
      width: 150,
      render: formatMoney,
      sorter: (a, b) => a.grossRevenue - b.grossRevenue,
    },
    {
      title: '退款',
      dataIndex: 'refundAmount',
      width: 150,
      render: (value: number) => <Text type="danger">{formatMoney(value)}</Text>,
      sorter: (a, b) => a.refundAmount - b.refundAmount,
    },
    {
      title: '净营收',
      dataIndex: 'netRevenue',
      width: 150,
      render: (value: number) => <Text strong>{formatMoney(value)}</Text>,
      sorter: (a, b) => a.netRevenue - b.netRevenue,
    },
    {
      title: '记录数',
      dataIndex: 'recordCount',
      width: 100,
      sorter: (a, b) => a.recordCount - b.recordCount,
    },
  ];

  const agentColumns: ColumnsType<AgentRow> = [
    {
      title: 'Agent',
      dataIndex: ['agent', 'displayName'],
      render: (_: unknown, record) => record.agent.displayName || record.agent.name,
    },
    {
      title: '毛收入',
      dataIndex: 'grossRevenue',
      width: 150,
      render: formatMoney,
      sorter: (a, b) => a.grossRevenue - b.grossRevenue,
    },
    {
      title: '退款',
      dataIndex: 'refundAmount',
      width: 150,
      render: (value: number) => <Text type="danger">{formatMoney(value)}</Text>,
      sorter: (a, b) => a.refundAmount - b.refundAmount,
    },
    {
      title: '净营收',
      dataIndex: 'netRevenue',
      width: 150,
      render: (value: number) => <Text strong>{formatMoney(value)}</Text>,
      sorter: (a, b) => a.netRevenue - b.netRevenue,
      defaultSortOrder: 'descend',
    },
    {
      title: '记录数',
      dataIndex: 'recordCount',
      width: 100,
      sorter: (a, b) => a.recordCount - b.recordCount,
    },
  ];

  const recentColumns: ColumnsType<RevenueRecord> = [
    {
      title: '订单',
      dataIndex: ['order', 'serviceType'],
      render: (_: unknown, record) => record.order ? (
        <Button type="link" style={{ padding: 0 }} onClick={() => navigate(`/operations/orders/${record.orderId}`)}>
          {record.order.serviceType}
        </Button>
      ) : record.orderId,
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
      title: '月份',
      dataIndex: 'month',
      width: 110,
      render: (value: string | null) => value || '-',
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
            <DollarOutlined style={{ fontSize: 24, color: '#1677ff' }} />
            <Title level={3} style={{ margin: 0 }}>营收汇总</Title>
          </Space>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void fetchSummary()}>刷新</Button>
        </div>

        <Card size="small">
          <Space wrap>
            <Input placeholder="起始月份 YYYY-MM" value={monthFrom} onChange={(event) => setMonthFrom(event.target.value)} style={{ width: 170 }} />
            <Input placeholder="结束月份 YYYY-MM" value={monthTo} onChange={(event) => setMonthTo(event.target.value)} style={{ width: 170 }} />
            <Select
              placeholder="类型"
              allowClear
              value={typeFilter}
              onChange={setTypeFilter}
              options={revenueTypeOptions}
              style={{ width: 140 }}
            />
            <Button type="primary" icon={<SearchOutlined />} onClick={() => void fetchSummary()}>查询</Button>
          </Space>
        </Card>

        <Spin spinning={loading}>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={12} lg={6}>
              <Card size="small"><Statistic title="净营收" value={formatMoney(summary.summary.netRevenue)} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card size="small"><Statistic title="毛收入" value={formatMoney(summary.summary.grossRevenue)} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card size="small"><Statistic title="订阅收入" value={formatMoney(summary.summary.recurringRevenue)} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card size="small"><Statistic title="记录数" value={summary.summary.recordCount} /></Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]}>
            <Col xs={24} xl={12}>
              <Card title="按月汇总" size="small">
                <Table rowKey="month" columns={monthlyColumns} dataSource={summary.monthly} pagination={{ pageSize: 8 }} scroll={{ x: 670 }} />
              </Card>
            </Col>
            <Col xs={24} xl={12}>
              <Card title="按 Agent 汇总" size="small">
                <Table rowKey={(record) => record.agentId ?? 'unassigned'} columns={agentColumns} dataSource={summary.byAgent} pagination={{ pageSize: 8 }} scroll={{ x: 700 }} />
              </Card>
            </Col>
            <Col xs={24}>
              <Card title="最近记录" size="small">
                <Table rowKey="id" columns={recentColumns} dataSource={summary.recentRecords} pagination={false} scroll={{ x: 760 }} />
              </Card>
            </Col>
          </Row>
        </Spin>
      </Space>
    </div>
  );
}
