import { useCallback, useEffect, useState } from 'react';
import {
  Avatar,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  Divider,
  Empty,
  Form,
  Input,
  List,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Timeline,
  Typography,
  message,
} from 'antd';
import {
  AimOutlined,
  ArrowLeftOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  EditOutlined,
  FieldTimeOutlined,
  FileTextOutlined,
  HistoryOutlined,
  MinusCircleOutlined,
  RocketOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { agentsApi, type AgentDetail } from '../api/agents';

const { Title, Text, Paragraph } = Typography;

const LAYER_CONFIG: Record<string, { label: string; color: string }> = {
  main: { label: '核心管线', color: 'blue' },
  exploration: { label: '探索管线', color: 'purple' },
  life: { label: '生活管线', color: 'green' },
  infra: { label: '基础设施', color: 'orange' },
  'cross-cutting': { label: '跨层职能', color: 'cyan' },
};

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

const GOAL_STATUS_MAP: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  not_started: { label: '未开始', color: 'default', icon: <MinusCircleOutlined /> },
  in_progress: { label: '进行中', color: 'processing', icon: <ClockCircleOutlined /> },
  done: { label: '已完成', color: 'success', icon: <CheckCircleOutlined /> },
};

export function AgentDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [agent, setAgent] = useState<AgentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [weeklyModalOpen, setWeeklyModalOpen] = useState(false);
  const [weeklyForm] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const fetchAgent = useCallback(async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const response = await agentsApi.get(agentId);
      setAgent(response.data.data);
    } catch {
      message.error('加载 Agent 详情失败');
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    void fetchAgent();
  }, [fetchAgent]);

  const handleWeeklySubmit = async () => {
    try {
      const values = await weeklyForm.validateFields();
      setSubmitting(true);
      await agentsApi.submitWeeklyReport(agentId!, {
        week: values.week.format('YYYY-MM-DD'),
        content: values.content,
        summary: values.summary || '',
        nextWeekPlan: values.nextWeekPlan || '',
        blockers: values.blockers || '',
      });
      message.success('周报提交成功');
      setWeeklyModalOpen(false);
      weeklyForm.resetFields();
    } catch {
      // validation error
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <Spin className="page-spin" />;
  }

  if (!agent) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Empty description="Agent 不存在" />
        <Button type="link" onClick={() => navigate('/team')}>
          返回看板
        </Button>
      </div>
    );
  }

  const layer = agent.tags[0] || 'unknown';
  const layerCfg = LAYER_CONFIG[layer] || { label: layer, color: 'default' };
  const goalCard = agent.goalCard;
  const stats = goalCard?.stats || { total: 0, done: 0, inProgress: 0 };
  const pipelineCfg = goalCard
    ? PIPELINE_CONFIG[goalCard.pipeline] || { label: goalCard.pipeline, color: 'default' }
    : null;

  return (
    <div style={{ padding: 24, maxWidth: 960 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: 20,
          flexWrap: 'wrap',
          gap: 8,
        }}
      >
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/team')}>
            返回
          </Button>
          <Avatar size={40} style={{ backgroundColor: '#1677ff' }} src={agent.avatar}>
            {agent.displayName[0] || '?'}
          </Avatar>
          <div>
            <Title level={4} style={{ margin: 0 }}>
              {agent.displayName}
            </Title>
            <Text type="secondary">@{agent.name}</Text>
          </div>
        </Space>
        <Space>
          <Tag color={layerCfg.color}>{layerCfg.label}</Tag>
          <Tag
            color={
              agent.status === 'active'
                ? 'green'
                : agent.status === 'inactive'
                  ? 'default'
                  : 'orange'
            }
          >
            {agent.status === 'active' ? '活跃' : agent.status === 'inactive' ? '停用' : '维护中'}
          </Tag>
        </Space>
      </div>

      {/* Basic Info */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Row gutter={24}>
          <Col xs={24} sm={12}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="名称">{agent.displayName}</Descriptions.Item>
              <Descriptions.Item label="标识">@{agent.name}</Descriptions.Item>
              <Descriptions.Item label="层">{layerCfg.label}</Descriptions.Item>
              {goalCard && pipelineCfg && (
                <Descriptions.Item label="管线">
                  <Tag color={pipelineCfg.color}>{pipelineCfg.label}</Tag>
                </Descriptions.Item>
              )}
            </Descriptions>
          </Col>
          <Col xs={24} sm={12}>
            <Descriptions column={1} size="small">
              <Descriptions.Item label="状态">
                {agent.status === 'active' ? '活跃' : agent.status === 'inactive' ? '停用' : '维护中'}
              </Descriptions.Item>
              <Descriptions.Item label="心跳">
                {agent.lastHeartbeatAt
                  ? new Date(agent.lastHeartbeatAt).toLocaleString('zh-CN')
                  : '无'}
              </Descriptions.Item>
              <Descriptions.Item label="任务统计">
                <Text style={{ color: '#faad14' }}>{agent.taskStats.pending}</Text> 待处理 /{' '}
                <Text style={{ color: '#1677ff' }}>{agent.taskStats.processing}</Text> 进行中 /{' '}
                <Text style={{ color: '#52c41a' }}>{agent.taskStats.completed}</Text> 已完成
              </Descriptions.Item>
            </Descriptions>
          </Col>
        </Row>
      </Card>

      {/* OKR Section */}
      {goalCard ? (
        <Card
          size="small"
          title={
            <Space>
              <AimOutlined style={{ color: '#1677ff' }} />
              <span>OKR / 目标进度</span>
            </Space>
          }
          extra={
            <Space size={4}>
              <Text strong style={{ fontSize: 16, color: stats.done === stats.total ? '#52c41a' : '#1677ff' }}>
                {stats.total > 0 ? `${Math.round((stats.done / stats.total) * 100)}%` : '0%'}
              </Text>
              <Text type="secondary">({stats.done}/{stats.total})</Text>
            </Space>
          }
          style={{ marginBottom: 16 }}
        >
          {/* Progress Bar */}
          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                width: '100%',
                height: 12,
                backgroundColor: '#f0f0f0',
                borderRadius: 6,
                overflow: 'hidden',
                display: 'flex',
              }}
            >
              <div
                style={{
                  width: `${stats.total > 0 ? (stats.done / stats.total) * 100 : 0}%`,
                  height: '100%',
                  backgroundColor: '#52c41a',
                  transition: 'width 0.3s',
                }}
              />
              <div
                style={{
                  width: `${stats.total > 0 ? (stats.inProgress / stats.total) * 100 : 0}%`,
                  height: '100%',
                  backgroundColor: '#1677ff',
                  transition: 'width 0.3s',
                  opacity: 0.3,
                }}
              />
            </div>
          </div>

          {/* Monthly Goals */}
          {goalCard.monthlyGoals?.length > 0 ? (
            <Space direction="vertical" style={{ width: '100%' }} size={12}>
              {goalCard.monthlyGoals.map((group) => {
                const monthStats = {
                  total: group.goals.length,
                  done: group.goals.filter((g) => g.status === 'done').length,
                };
                return (
                  <Card
                    key={group.month}
                    type="inner"
                    size="small"
                    title={
                      <Space>
                        <CalendarOutlined />
                        <Text strong>{group.month}</Text>
                        <Text type="secondary">({monthStats.done}/{monthStats.total})</Text>
                      </Space>
                    }
                  >
                    <List
                      size="small"
                      dataSource={group.goals}
                      renderItem={(goal) => {
                        const cfg = GOAL_STATUS_MAP[goal.status] || GOAL_STATUS_MAP.not_started;
                        return (
                          <List.Item>
                            <Space>
                              <Tag
                                color={cfg.color as any}
                                style={{
                                  minWidth: 60,
                                  textAlign: 'center',
                                  fontSize: 11,
                                }}
                              >
                                {cfg.label}
                              </Tag>
                              <Text delete={goal.status === 'done'}>{goal.text}</Text>
                            </Space>
                          </List.Item>
                        );
                      }}
                    />
                  </Card>
                );
              })}
            </Space>
          ) : (
            <Empty description="暂无月度目标" />
          )}

          {/* Long term direction */}
          <Divider style={{ margin: '12px 0' }} />
          <Space direction="vertical" size={4} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              <AimOutlined /> 长期方向
            </Text>
            <Paragraph style={{ margin: 0, fontSize: 13 }}>
              {goalCard.longTermDirection || '未设置'}
            </Paragraph>
          </Space>
        </Card>
      ) : (
        <Card size="small" style={{ marginBottom: 16 }}>
          <Empty description="该 Agent 暂未设定 OKR 目标" />
        </Card>
      )}

      {/* Action buttons */}
      <Row gutter={12} style={{ marginBottom: 16 }}>
        <Col>
          <Button icon={<FileTextOutlined />} type="primary" onClick={() => setWeeklyModalOpen(true)}>
            提交周报
          </Button>
        </Col>
      </Row>

      {/* Description */}
      {agent.description && (
        <Card size="small" title="描述" style={{ marginBottom: 16 }}>
          <Paragraph>{agent.description}</Paragraph>
        </Card>
      )}

      {/* Revision History */}
      {goalCard?.revisions && goalCard.revisions.length > 0 && (
        <Card
          size="small"
          title={
            <Space>
              <HistoryOutlined />
              <span>变更历史</span>
            </Space>
          }
        >
          <Timeline
            items={goalCard.revisions.map((rev) => ({
              children: (
                <div>
                  <Text type="secondary">
                    {new Date(rev.createdAt).toLocaleString('zh-CN')}
                  </Text>
                  <br />
                  <Text>{rev.changeNote}</Text>
                  <Text type="secondary"> — {rev.changedBy}</Text>
                </div>
              ),
            }))}
          />
        </Card>
      )}

      {/* Weekly Report Modal */}
      <Modal
        title={
          <Space>
            <FileTextOutlined />
            <span>提交周报 — {agent.displayName}</span>
          </Space>
        }
        open={weeklyModalOpen}
        onOk={handleWeeklySubmit}
        onCancel={() => {
          setWeeklyModalOpen(false);
          weeklyForm.resetFields();
        }}
        confirmLoading={submitting}
        width={600}
        okText="提交"
        cancelText="取消"
      >
        <Form form={weeklyForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            name="week"
            label="周报周期"
            rules={[{ required: true, message: '请选择周报周期' }]}
          >
            <DatePicker picker="week" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="summary"
            label="本周摘要"
            rules={[{ required: true, message: '请填写本周摘要' }]}
          >
            <Input.TextArea rows={2} placeholder="简要总结本周工作" />
          </Form.Item>
          <Form.Item
            name="content"
            label="工作详情"
            rules={[{ required: true, message: '请填写工作详情' }]}
          >
            <Input.TextArea rows={4} placeholder="详细描述本周完成的工作内容" />
          </Form.Item>
          <Form.Item name="nextWeekPlan" label="下周计划">
            <Input.TextArea rows={3} placeholder="下周的工作计划" />
          </Form.Item>
          <Form.Item name="blockers" label="风险/阻塞项">
            <Input.TextArea rows={2} placeholder="遇到的问题或需要协调的事项" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
