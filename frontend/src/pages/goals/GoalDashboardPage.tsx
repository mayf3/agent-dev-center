import { useEffect, useState } from 'react';
import {
  Card,
  Col,
  Row,
  Tag,
  Space,
  Button,
  Select,
  Typography,
  Empty,
  Spin,
  message,
  Avatar,
  Badge,
  Tooltip,
} from 'antd';
import {
  PlusOutlined,
  AimOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { goalsApi, type GoalCard } from '../../api/goals';

const { Title, Text, Paragraph } = Typography;

const PIPELINE_CONFIG: Record<string, { label: string; color: string }> = {
  content: { label: '内容生产', color: 'blue' },
  parenting: { label: '育儿', color: 'pink' },
  investment: { label: '投资', color: 'gold' },
  health: { label: '健康', color: 'green' },
  planning: { label: '规划', color: 'purple' },
  lifestyle: { label: '生活', color: 'orange' },
  devops: { label: '运维', color: 'cyan' },
  education: { label: '教育', color: 'geekblue' },
};

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  active: { label: '活跃', color: 'green', icon: <CheckCircleOutlined /> },
  paused: { label: '暂停', color: 'orange', icon: <ClockCircleOutlined /> },
  archived: { label: '已归档', color: 'default', icon: <ExclamationCircleOutlined /> },
};

function getGoalStats(monthlyGoals: GoalCard['monthlyGoals']) {
  let total = 0;
  let done = 0;
  let inProgress = 0;

  for (const group of monthlyGoals || []) {
    for (const goal of group.goals || []) {
      total++;
      if (goal.status === 'done') done++;
      if (goal.status === 'in_progress') inProgress++;
    }
  }

  return { total, done, inProgress };
}

function GoalCardItem({ card }: { card: GoalCard }) {
  const stats = getGoalStats(card.monthlyGoals);
  const pipeline = PIPELINE_CONFIG[card.pipeline] || { label: card.pipeline, color: 'default' };
  const status = STATUS_CONFIG[card.status] || STATUS_CONFIG.active;
  const currentMonth = new Date().toISOString().slice(0, 7);
  const currentGoals = card.monthlyGoals?.find((g) => g.month === currentMonth);

  return (
    <Link to={`/goals/${card.agentId}`} style={{ textDecoration: 'none' }}>
      <Card
        hoverable
        style={{ height: '100%' }}
        bodyStyle={{ padding: '16px 20px' }}
      >
        <Space direction="vertical" style={{ width: '100%' }} size={8}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Space>
              <Avatar
                size={32}
                style={{ backgroundColor: '#1677ff' }}
                src={card.agent?.avatar}
              >
                {card.agent?.displayName?.[0] || card.agent?.name?.[0] || '?'}
              </Avatar>
              <div>
                <Text strong>{card.agent?.displayName || card.agent?.name}</Text>
                <br />
                <Text type="secondary" style={{ fontSize: 12 }}>{card.agent?.name}</Text>
              </div>
            </Space>
            <Badge
              count={status.icon}
              style={{ color: status.color === 'green' ? '#52c41a' : undefined }}
            />
          </div>

          {/* Pipeline & Status */}
          <div>
            <Tag color={pipeline.color}>{pipeline.label}</Tag>
            <Tag color={status.color}>{status.label}</Tag>
          </div>

          {/* Current Month Goals */}
          {currentGoals && (
            <div style={{ fontSize: 13 }}>
              <Text type="secondary">本月目标: </Text>
              <Text>{currentGoals.goals.length} 项</Text>
              {stats.total > 0 && (
                <Text type="secondary" style={{ marginLeft: 8 }}>
                  ({stats.done}/{stats.total} 达成)
                </Text>
              )}
            </div>
          )}

          {/* Progress Bar */}
          {stats.total > 0 && (
            <div
              style={{
                width: '100%',
                height: 4,
                backgroundColor: '#f0f0f0',
                borderRadius: 2,
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${(stats.done / stats.total) * 100}%`,
                  height: '100%',
                  backgroundColor: '#52c41a',
                  borderRadius: 2,
                  transition: 'width 0.3s',
                }}
              />
            </div>
          )}

          {/* Long term direction preview */}
          <Paragraph
            type="secondary"
            ellipsis={{ rows: 2 }}
            style={{ fontSize: 12, marginBottom: 0 }}
          >
            {card.longTermDirection}
          </Paragraph>
        </Space>
      </Card>
    </Link>
  );
}

function UnassignedAgentItem({ agent, onCreated }: { agent: { id: string; name: string; displayName: string; avatar?: string }; onCreated: () => void }) {
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleCreate = async () => {
    navigate(`/goals?create=${agent.id}`);
  };

  return (
    <Card
      size="small"
      style={{ borderStyle: 'dashed', borderColor: '#ffccc7' }}
      bodyStyle={{ padding: '12px 16px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Space>
          <Avatar size={28} style={{ backgroundColor: '#ff4d4f' }}>
            {agent.displayName?.[0] || agent.name?.[0] || '?'}
          </Avatar>
          <div>
            <Text>{agent.displayName || agent.name}</Text>
            <br />
            <Text type="secondary" style={{ fontSize: 11 }}>⚠️ 无目标卡</Text>
          </div>
        </Space>
        <Button
          type="link"
          size="small"
          icon={<PlusOutlined />}
          loading={loading}
          onClick={handleCreate}
        >
          创建
        </Button>
      </div>
    </Card>
  );
}

export function GoalDashboardPage() {
  const [goalCards, setGoalCards] = useState<GoalCard[]>([]);
  const [unassigned, setUnassigned] = useState<GoalCard['agent'][]>([]);
  const [loading, setLoading] = useState(true);
  const [pipelineFilter, setPipelineFilter] = useState<string | undefined>();
  const navigate = useNavigate();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [goalsRes, unassignedRes] = await Promise.all([
        goalsApi.list(pipelineFilter ? { pipeline: pipelineFilter } : undefined),
        goalsApi.getUnassigned(),
      ]);
      setGoalCards(goalsRes.data.goalCards || []);
      setUnassigned(unassignedRes.data.agents || []);
    } catch (err) {
      message.error('加载目标卡失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [pipelineFilter]);

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Space>
          <AimOutlined style={{ fontSize: 24, color: '#1677ff' }} />
          <Title level={3} style={{ margin: 0 }}>Agent 目标卡</Title>
        </Space>
        <Space>
          <Select
            placeholder="管线筛选"
            allowClear
            style={{ width: 140 }}
            value={pipelineFilter}
            onChange={setPipelineFilter}
            options={Object.entries(PIPELINE_CONFIG).map(([key, val]) => ({
              label: val.label,
              value: key,
            }))}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => navigate('/goals?create=new')}
          >
            新建目标卡
          </Button>
        </Space>
      </div>

      <Spin spinning={loading}>
        {/* Goal Cards Grid */}
        {goalCards.length > 0 ? (
          <Row gutter={[16, 16]}>
            {goalCards.map((card) => (
              <Col key={card.id} xs={24} sm={12} md={8} lg={6}>
                <GoalCardItem card={card} />
              </Col>
            ))}
          </Row>
        ) : !loading ? (
          <Empty description="暂无目标卡" style={{ marginBottom: 24 }} />
        ) : null}

        {/* Unassigned Agents */}
        {unassigned.length > 0 && (
          <>
            <div style={{ marginTop: 32, marginBottom: 16 }}>
              <Space>
                <ExclamationCircleOutlined style={{ color: '#ff4d4f' }} />
                <Text strong>未规划 Agent ({unassigned.length})</Text>
              </Space>
            </div>
            <Row gutter={[16, 12]}>
              {unassigned.map((agent) => (
                <Col key={agent.id} xs={24} sm={12} md={8} lg={6}>
                  <UnassignedAgentItem agent={agent} onCreated={fetchData} />
                </Col>
              ))}
            </Row>
          </>
        )}
      </Spin>
    </div>
  );
}
