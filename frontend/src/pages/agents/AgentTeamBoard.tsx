import { useEffect, useMemo, useState } from 'react';
import {
  Avatar,
  Button,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  AimOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  MinusCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { agentsApi, type AgentListItem } from '../../api/agents';

const { Title, Text } = Typography;

const LAYER_CONFIG: Record<string, { label: string; color: string }> = {
  main: { label: '核心管线', color: 'blue' },
  exploration: { label: '探索管线', color: 'purple' },
  life: { label: '生活管线', color: 'green' },
  infra: { label: '基础设施', color: 'orange' },
  'cross-cutting': { label: '跨层职能', color: 'cyan' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  active: { label: '活跃', color: 'green' },
  inactive: { label: '停用', color: 'default' },
  maintenance: { label: '维护中', color: 'orange' },
};

const PIPELINE_CONFIG: Record<string, string> = {
  content: '内容生产',
  parenting: '育儿',
  investment: '投资',
  health: '健康',
  planning: '规划',
  lifestyle: '生活',
  devops: '运维',
  education: '教育',
};

function DualProgressBar({ done, total }: { done: number; total: number }) {
  const inProgress = total - done; // simplified: we show remaining as "in progress"
  const donePct = total > 0 ? (done / total) * 100 : 0;
  const remainingPct = total > 0 ? ((total - done) / total) * 100 : 0;

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%' }}>
      <div
        style={{
          flex: 1,
          height: 8,
          backgroundColor: '#f0f0f0',
          borderRadius: 4,
          overflow: 'hidden',
          display: 'flex',
        }}
      >
        <div
          style={{
            width: `${donePct}%`,
            height: '100%',
            backgroundColor: '#52c41a',
            transition: 'width 0.3s',
          }}
        />
        <div
          style={{
            width: `${remainingPct}%`,
            height: '100%',
            backgroundColor: '#1677ff',
            transition: 'width 0.3s',
            opacity: 0.3,
          }}
        />
      </div>
      <Text type="secondary" style={{ fontSize: 12, whiteSpace: 'nowrap', minWidth: 36 }}>
        {done}/{total}
      </Text>
    </div>
  );
}

function AgentCard({ agent }: { agent: AgentListItem }) {
  const navigate = useNavigate();
  const layer = agent.tags[0] || 'unknown';
  const layerCfg = LAYER_CONFIG[layer] || { label: layer, color: 'default' };
  const statusCfg = STATUS_CONFIG[agent.status] || STATUS_CONFIG.active;
  const goalCard = agent.goalCard;
  const stats = goalCard?.stats || { total: 0, done: 0, inProgress: 0 };
  const pipeline = goalCard?.pipeline || '';

  return (
    <Card
      hoverable
      size="small"
      style={{ height: '100%' }}
      styles={{ body: { padding: '14px 16px' } }}
      onClick={() => navigate(`/team/agents/${agent.id}`)}
    >
      <Space direction="vertical" style={{ width: '100%' }} size={8}>
        {/* Header: Avatar + Name + Status */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <Space>
            <Avatar
              size={36}
              style={{ backgroundColor: '#1677ff', flexShrink: 0 }}
              src={agent.avatar}
            >
              {agent.displayName[0] || '?'}
            </Avatar>
            <div style={{ minWidth: 0 }}>
              <Text strong ellipsis style={{ maxWidth: 160, display: 'block' }}>
                {agent.displayName}
              </Text>
              <Text type="secondary" style={{ fontSize: 11 }}>
                @{agent.name}
              </Text>
            </div>
          </Space>
          <Tag color={statusCfg.color} style={{ margin: 0, flexShrink: 0, fontSize: 11 }}>
            {statusCfg.label}
          </Tag>
        </div>

        {/* Layer + Pipeline tags */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          <Tag color={layerCfg.color} style={{ fontSize: 11 }}>
            {layerCfg.label}
          </Tag>
          {pipeline && (
            <Tag style={{ fontSize: 11 }}>
              {PIPELINE_CONFIG[pipeline] || pipeline}
            </Tag>
          )}
        </div>

        {/* OKR Progress */}
        {goalCard ? (
          <div style={{ width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
              <Text type="secondary" style={{ fontSize: 12 }}>
                <AimOutlined /> OKR 进度
              </Text>
              {stats.total > 0 && (
                <Text
                  style={{
                    fontSize: 12,
                    color: stats.done === stats.total ? '#52c41a' : '#1677ff',
                    fontWeight: 500,
                  }}
                >
                  {Math.round((stats.done / stats.total) * 100)}%
                </Text>
              )}
            </div>
            <DualProgressBar done={stats.done} total={stats.total} />
          </div>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            <ExclamationCircleOutlined style={{ color: '#faad14' }} /> 暂未设定目标
          </Text>
        )}
      </Space>
    </Card>
  );
}

export function AgentTeamBoard() {
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [layerFilter, setLayerFilter] = useState<string | undefined>();
  const [searchText, setSearchText] = useState('');

  const loadAgents = async () => {
    setLoading(true);
    try {
      const params: Record<string, string> = {};
      if (layerFilter) params.layer = layerFilter;
      if (searchText) params.search = searchText;

      const response = await agentsApi.list(
        Object.keys(params).length > 0 ? params : undefined
      );
      setAgents(response.data.data || []);
    } catch {
      message.error('加载 Agent 数据失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAgents();
  }, [layerFilter]);

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchText) {
        void loadAgents();
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [searchText]);

  const stats = useMemo(() => {
    const total = agents.length;
    const withGoals = agents.filter((a) => a.goalCard).length;
    const totalDone = agents.reduce((sum, a) => sum + (a.goalCard?.stats.done || 0), 0);
    const totalGoals = agents.reduce((sum, a) => sum + (a.goalCard?.stats.total || 0), 0);
    return { total, withGoals, totalDone, totalGoals };
  }, [agents]);

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div>
          <Space>
            <TeamOutlined style={{ fontSize: 24, color: '#1677ff' }} />
            <Title level={3} style={{ margin: 0 }}>
              Agent 团队看板
            </Title>
          </Space>
          <div style={{ marginTop: 4 }}>
            <Text type="secondary">
              共 {stats.total} 个 Agent，{stats.withGoals} 个已设定目标
              {stats.totalGoals > 0 && `（${stats.totalDone}/${stats.totalGoals} 达成）`}
            </Text>
          </div>
        </div>
        <Space wrap>
          <Input
            placeholder="搜索 Agent..."
            prefix={<SearchOutlined />}
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 200 }}
            allowClear
            onPressEnter={() => void loadAgents()}
          />
          <Select
            placeholder="按层筛选"
            allowClear
            style={{ width: 140 }}
            value={layerFilter}
            onChange={(v) => setLayerFilter(v || undefined)}
            options={Object.entries(LAYER_CONFIG).map(([key, val]) => ({
              label: val.label,
              value: key,
            }))}
          />
          <Button icon={<ReloadOutlined />} onClick={() => void loadAgents()}>
            刷新
          </Button>
        </Space>
      </div>

      <Spin spinning={loading}>
        {agents.length > 0 ? (
          <Row gutter={[12, 12]}>
            {agents.map((agent) => (
              <Col key={agent.id} xs={24} sm={12} md={8} lg={6}>
                <AgentCard agent={agent} />
              </Col>
            ))}
          </Row>
        ) : !loading ? (
          <Empty description="暂无符合条件的 Agent" style={{ marginTop: 60 }} />
        ) : null}
      </Spin>
    </div>
  );
}
