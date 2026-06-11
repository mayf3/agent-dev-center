import { LineChartOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import { App as AntApp, Button, Card, Col, Input, Progress, Row, Select, Space, Spin, Statistic, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { useEffect, useMemo, useState } from 'react';
import { agentsApi, type AgentListItem } from '../../api/agents';
import { operationsApi, type AgentPerformance } from '../../api/operations';
import { formatMoney } from './constants';

const { Title, Text } = Typography;

const emptyPerformance: AgentPerformance = {
  summary: {
    totalAgents: 0,
    totalOrders: 0,
    completedOrders: 0,
    netRevenue: 0,
  },
  performance: [],
};

type PerformanceRow = AgentPerformance['performance'][number];

export function AgentPerformancePage() {
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<AgentPerformance>(emptyPerformance);
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [agentId, setAgentId] = useState<string | undefined>();
  const [monthFrom, setMonthFrom] = useState('');
  const [monthTo, setMonthTo] = useState('');

  const agentOptions = useMemo(() => agents.map((agent) => ({
    value: agent.id,
    label: agent.displayName || agent.name,
  })), [agents]);

  const fetchPerformance = async () => {
    setLoading(true);
    try {
      const { data: res } = await operationsApi.getAgentPerformance({
        agentId,
        monthFrom: monthFrom || undefined,
        monthTo: monthTo || undefined,
      });
      setData(res.data);
    } catch {
      message.error('Agent 绩效加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchPerformance();
    agentsApi.list().then((res) => setAgents(res.data.data)).catch(() => undefined);
  }, []);

  const completionRate = data.summary.totalOrders > 0
    ? Math.round((data.summary.completedOrders / data.summary.totalOrders) * 100)
    : 0;

  const topAgent = data.performance[0];

  const columns: ColumnsType<PerformanceRow> = [
    {
      title: '排名',
      dataIndex: 'rank',
      width: 80,
      fixed: 'left',
      sorter: (a, b) => a.rank - b.rank,
      render: (rank: number) => <Tag color={rank <= 3 ? 'gold' : 'default'}>{rank}</Tag>,
    },
    {
      title: 'Agent',
      dataIndex: ['agent', 'displayName'],
      width: 220,
      fixed: 'left',
      render: (_: unknown, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.agent.displayName || record.agent.name}</Text>
          {record.agent.id && <Text type="secondary" style={{ fontSize: 12 }}>{record.agent.name}</Text>}
        </Space>
      ),
    },
    {
      title: '净营收',
      dataIndex: 'netRevenue',
      width: 140,
      render: (value: number) => <Text strong>{formatMoney(value)}</Text>,
      sorter: (a, b) => a.netRevenue - b.netRevenue,
      defaultSortOrder: 'descend',
    },
    {
      title: '毛收入',
      dataIndex: 'grossRevenue',
      width: 140,
      render: formatMoney,
      sorter: (a, b) => a.grossRevenue - b.grossRevenue,
    },
    {
      title: '退款',
      dataIndex: 'refundAmount',
      width: 130,
      render: (value: number) => <Text type="danger">{formatMoney(value)}</Text>,
      sorter: (a, b) => a.refundAmount - b.refundAmount,
    },
    {
      title: '订单数',
      dataIndex: 'totalOrders',
      width: 110,
      sorter: (a, b) => a.totalOrders - b.totalOrders,
    },
    {
      title: '完成率',
      dataIndex: 'completionRate',
      width: 170,
      render: (value: number) => <Progress percent={Math.round(value * 100)} size="small" />,
      sorter: (a, b) => a.completionRate - b.completionRate,
    },
    {
      title: '客单价',
      dataIndex: 'averageOrderValue',
      width: 130,
      render: formatMoney,
      sorter: (a, b) => a.averageOrderValue - b.averageOrderValue,
    },
    {
      title: '营收记录',
      dataIndex: 'revenueRecords',
      width: 110,
      sorter: (a, b) => a.revenueRecords - b.revenueRecords,
    },
  ];

  return (
    <div style={{ padding: 24 }}>
      <Space direction="vertical" size="large" style={{ width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Space>
            <LineChartOutlined style={{ fontSize: 24, color: '#1677ff' }} />
            <Title level={3} style={{ margin: 0 }}>Agent 绩效</Title>
          </Space>
          <Button icon={<ReloadOutlined />} loading={loading} onClick={() => void fetchPerformance()}>刷新</Button>
        </div>

        <Card size="small">
          <Space wrap>
            <Select
              placeholder="Agent"
              allowClear
              showSearch
              optionFilterProp="label"
              value={agentId}
              onChange={setAgentId}
              options={agentOptions}
              style={{ width: 220 }}
            />
            <Input placeholder="起始月份 YYYY-MM" value={monthFrom} onChange={(event) => setMonthFrom(event.target.value)} style={{ width: 170 }} />
            <Input placeholder="结束月份 YYYY-MM" value={monthTo} onChange={(event) => setMonthTo(event.target.value)} style={{ width: 170 }} />
            <Button type="primary" icon={<SearchOutlined />} onClick={() => void fetchPerformance()}>查询</Button>
          </Space>
        </Card>

        <Spin spinning={loading}>
          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            <Col xs={24} sm={12} lg={6}>
              <Card size="small"><Statistic title="净营收" value={formatMoney(data.summary.netRevenue)} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card size="small"><Statistic title="Agent 数" value={data.summary.totalAgents} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card size="small"><Statistic title="订单完成率" value={`${completionRate}%`} /></Card>
            </Col>
            <Col xs={24} sm={12} lg={6}>
              <Card size="small"><Statistic title="最高净营收" value={topAgent ? formatMoney(topAgent.netRevenue) : formatMoney(0)} /></Card>
            </Col>
          </Row>

          <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
            {data.performance.slice(0, 3).map((row) => (
              <Col key={row.agentId ?? 'unassigned'} xs={24} md={8}>
                <Card size="small">
                  <Space direction="vertical" size={6} style={{ width: '100%' }}>
                    <Space style={{ justifyContent: 'space-between', width: '100%' }}>
                      <Text strong>{row.agent.displayName || row.agent.name}</Text>
                      <Tag color="gold">#{row.rank}</Tag>
                    </Space>
                    <Statistic title="净营收" value={formatMoney(row.netRevenue)} />
                    <Progress percent={Math.round(row.completionRate * 100)} size="small" />
                  </Space>
                </Card>
              </Col>
            ))}
          </Row>

          <Card title="绩效明细" size="small">
            <Table
              rowKey={(record) => record.agentId ?? 'unassigned'}
              columns={columns}
              dataSource={data.performance}
              pagination={{ pageSize: 20 }}
              scroll={{ x: 1250 }}
            />
          </Card>
        </Spin>
      </Space>
    </div>
  );
}
