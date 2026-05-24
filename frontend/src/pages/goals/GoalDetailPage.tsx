import { useEffect, useState } from 'react';
import {
  Card,
  Typography,
  Space,
  Tag,
  Button,
  Descriptions,
  Timeline,
  Spin,
  message,
  Modal,
  Form,
  Input,
  Select,
  List,
  Badge,
  Divider,
  Popconfirm,
  Empty,
} from 'antd';
import {
  ArrowLeftOutlined,
  EditOutlined,
  RocketOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  MinusCircleOutlined,
  AimOutlined,
  HistoryOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import { goalsApi, type GoalCard, type GoalRevision, type MonthlyGoalGroup } from '../../api/goals';

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

const GOAL_STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  not_started: { label: '未开始', color: 'default', icon: <MinusCircleOutlined /> },
  in_progress: { label: '进行中', color: 'processing', icon: <ClockCircleOutlined /> },
  done: { label: '已完成', color: 'success', icon: <CheckCircleOutlined /> },
};

export function GoalDetailPage() {
  const { agentId } = useParams<{ agentId: string }>();
  const navigate = useNavigate();
  const [goalCard, setGoalCard] = useState<GoalCard | null>(null);
  const [loading, setLoading] = useState(true);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState<string | null>(null);

  const fetchData = async () => {
    if (!agentId) return;
    setLoading(true);
    try {
      const res = await goalsApi.get(agentId);
      setGoalCard(res.data.goalCard);
    } catch {
      message.error('加载目标卡失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [agentId]);

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!goalCard) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Empty description="目标卡不存在" />
        <Button type="link" onClick={() => navigate('/goals')}>返回看板</Button>
      </div>
    );
  }

  const pipeline = PIPELINE_CONFIG[goalCard.pipeline] || { label: goalCard.pipeline, color: 'default' };

  const handleEdit = () => {
    form.setFieldsValue({
      pipeline: goalCard.pipeline,
      longTermDirection: goalCard.longTermDirection,
      selfCheckCriteria: goalCard.selfCheckCriteria,
      changeNote: '',
    });
    setEditModalOpen(true);
  };

  const handleSave = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await goalsApi.update(agentId!, values);
      message.success('更新成功');
      setEditModalOpen(false);
      fetchData();
    } catch (err) {
      // validation error
    } finally {
      setSaving(false);
    }
  };

  const handlePushTodos = async (month: string) => {
    setPushing(month);
    try {
      const res = await goalsApi.pushTodos(agentId!, month);
      message.success(`成功推送 ${res.data.created}/${res.data.total} 个任务到 LLM Todo`);
      fetchData();
    } catch (err: any) {
      if (err.response?.status === 409) {
        message.warning('该月份已推送过');
      } else {
        message.error('推送失败');
      }
    } finally {
      setPushing(null);
    }
  };

  const handleGoalStatusChange = async (month: string, goalIndex: number, status: string) => {
    try {
      await goalsApi.updateGoalStatus(agentId!, month, goalIndex, status as any);
      fetchData();
    } catch {
      message.error('更新状态失败');
    }
  };

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/goals')}>返回</Button>
          <Title level={4} style={{ margin: 0 }}>
            {goalCard.agent?.displayName || goalCard.agent?.name} 目标卡
          </Title>
        </Space>
        <Space>
          <Button icon={<EditOutlined />} onClick={handleEdit}>编辑</Button>
        </Space>
      </div>

      {/* Basic Info */}
      <Card style={{ marginBottom: 16 }}>
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
          <Descriptions.Item label="管线">
            <Tag color={pipeline.color}>{pipeline.label}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={goalCard.status === 'active' ? 'green' : goalCard.status === 'paused' ? 'orange' : 'default'}>
              {goalCard.status === 'active' ? '活跃' : goalCard.status === 'paused' ? '暂停' : '已归档'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="上次审核">
            {goalCard.lastReviewedAt
              ? new Date(goalCard.lastReviewedAt).toLocaleDateString('zh-CN')
              : '未审核'}
          </Descriptions.Item>
          <Descriptions.Item label="上游 Agent">
            {goalCard.upstreamAgentIds.length > 0
              ? goalCard.upstreamAgentIds.map((id) => <Tag key={id}>{id.slice(0, 8)}...</Tag>)
              : <Text type="secondary">无</Text>}
          </Descriptions.Item>
          <Descriptions.Item label="下游 Agent">
            {goalCard.downstreamAgentIds.length > 0
              ? goalCard.downstreamAgentIds.map((id) => <Tag key={id}>{id.slice(0, 8)}...</Tag>)
              : <Text type="secondary">无</Text>}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      {/* Long Term Direction */}
      <Card
        title={<Space><AimOutlined />长期方向</Space>}
        style={{ marginBottom: 16 }}
      >
        <Paragraph>{goalCard.longTermDirection || '未设置'}</Paragraph>
      </Card>

      {/* Monthly Goals */}
      <Card
        title={<Space><ClockCircleOutlined />月度目标</Space>}
        style={{ marginBottom: 16 }}
      >
        {goalCard.monthlyGoals?.length > 0 ? (
          <Space direction="vertical" style={{ width: '100%' }} size={16}>
            {goalCard.monthlyGoals.map((group: MonthlyGoalGroup) => {
              const isPushed = goalCard.pushedMonths.includes(group.month);
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
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <Space>
                        <Text strong>{group.month}</Text>
                        <Text type="secondary">({monthStats.done}/{monthStats.total})</Text>
                      </Space>
                      <Popconfirm
                        title={`确认推送 ${group.month} 的目标到 LLM Todo？`}
                        onConfirm={() => handlePushTodos(group.month)}
                        okText="推送"
                        cancelText="取消"
                      >
                        <Button
                          size="small"
                          type={isPushed ? 'default' : 'primary'}
                          icon={<RocketOutlined />}
                          loading={pushing === group.month}
                          disabled={isPushed}
                        >
                          {isPushed ? '已推送' : '推送 Todo'}
                        </Button>
                      </Popconfirm>
                    </div>
                  }
                >
                  <List
                    size="small"
                    dataSource={group.goals}
                    renderItem={(goal, index) => {
                      const statusCfg = GOAL_STATUS_CONFIG[goal.status] || GOAL_STATUS_CONFIG.not_started;
                      return (
                        <List.Item
                          actions={[
                            <Select
                              key="status"
                              size="small"
                              value={goal.status}
                              style={{ width: 90 }}
                              onChange={(val) => handleGoalStatusChange(group.month, index, val)}
                              options={[
                                { label: '未开始', value: 'not_started' },
                                { label: '进行中', value: 'in_progress' },
                                { label: '已完成', value: 'done' },
                              ]}
                            />,
                          ]}
                        >
                          <Space>
                            <Badge status={statusCfg.color as any} />
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
      </Card>

      {/* Self Check Criteria */}
      <Card
        title={<Space><CheckCircleOutlined />自检标准</Space>}
        style={{ marginBottom: 16 }}
      >
        <Paragraph style={{ whiteSpace: 'pre-wrap' }}>
          {goalCard.selfCheckCriteria || '未设置'}
        </Paragraph>
      </Card>

      {/* Revision History */}
      {goalCard.revisions && goalCard.revisions.length > 0 && (
        <Card
          title={<Space><HistoryOutlined />变更历史</Space>}
        >
          <Timeline
            items={goalCard.revisions.map((rev: GoalRevision) => ({
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

      {/* Edit Modal */}
      <Modal
        title="编辑目标卡"
        open={editModalOpen}
        onOk={handleSave}
        onCancel={() => setEditModalOpen(false)}
        confirmLoading={saving}
        width={600}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="pipeline" label="管线" rules={[{ required: true }]}>
            <Select
              options={Object.entries(PIPELINE_CONFIG).map(([key, val]) => ({
                label: val.label,
                value: key,
              }))}
            />
          </Form.Item>
          <Form.Item name="longTermDirection" label="长期方向" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="selfCheckCriteria" label="自检标准">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="changeNote" label="变更说明">
            <Input placeholder="简述此次变更内容" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
