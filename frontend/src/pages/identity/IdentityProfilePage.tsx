import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Avatar,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Progress,
  Row,
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
  CheckCircleOutlined,
  ClockCircleOutlined,
  MinusCircleOutlined,
  RobotOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { identitiesApi, type Identity, type MonthlyGoalGroup } from '../../api/identities';

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
  business: { label: '业务', color: 'red' },
  cross_cutting: { label: '跨层职能', color: 'lime' },
};

const LAYER_CONFIG: Record<string, { label: string; color: string }> = {
  mainline: { label: '核心管线', color: 'blue' },
  explore: { label: '探索管线', color: 'purple' },
  life: { label: '生活管线', color: 'green' },
  infra: { label: '基础设施', color: 'orange' },
  'cross-cutting': { label: '跨层职能', color: 'cyan' },
};

function KRStatusIcon({ status }: { status: string }) {
  if (status === 'done') return <CheckCircleOutlined style={{ color: '#52c41a' }} />;
  if (status === 'doing') return <ClockCircleOutlined style={{ color: '#1677ff' }} />;
  return <MinusCircleOutlined style={{ color: '#d9d9d9' }} />;
}

export default function IdentityProfilePage() {
  const { type, id } = useParams<{ type: string; id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [updating, setUpdating] = useState(false);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    identitiesApi.get(id)
      .then(res => setIdentity(res.data.data))
      .catch(() => message.error('加载失败'))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <Spin className="page-spin" />;
  if (!identity) return <Empty description="实体不存在" />;

  const isAgent = identity.type === 'agent';
  const pipeline = PIPELINE_CONFIG[identity.pipeline || ''] || { label: identity.pipeline || '未知', color: 'default' };
  const layer = LAYER_CONFIG[identity.layer || ''] || { label: identity.layer || '', color: 'default' };

  // Calculate KR stats
  let totalKR = 0;
  let doneKR = 0;
  for (const g of identity.monthlyGoals || []) {
    for (const kr of g.krs || []) {
      totalKR++;
      if (kr.status === 'done' || kr.progress >= 100) doneKR++;
    }
  }
  const progressPct = totalKR > 0 ? Math.round((doneKR / totalKR) * 100) : 0;

  return (
    <div style={{ padding: 24, maxWidth: 1000, margin: '0 auto' }}>
      {/* Back button */}
      <Button
        type="text"
        icon={<ArrowLeftOutlined />}
        onClick={() => navigate('/identity')}
        style={{ marginBottom: 16 }}
      >
        返回列表
      </Button>

      {/* Profile Header */}
      <Card style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <Avatar
            size={72}
            icon={isAgent ? <RobotOutlined /> : <UserOutlined />}
            src={identity.avatar}
            style={{ backgroundColor: isAgent ? '#1677ff' : '#52c41a' }}
          />
          <div style={{ flex: 1 }}>
            <Title level={4} style={{ margin: 0 }}>{identity.displayName}</Title>
            <Space style={{ marginTop: 8 }}>
              <Tag color={isAgent ? 'blue' : 'green'}>{isAgent ? 'Agent' : 'Human'}</Tag>
              <Tag color={pipeline.color}>{pipeline.label}</Tag>
              <Tag color={layer.color}>{layer.label}</Tag>
              {isAgent && identity.agentType && <Tag>{identity.agentType}</Tag>}
            </Space>
          </div>
          {/* KR 总进度 */}
          {totalKR > 0 && (
            <div style={{ textAlign: 'center', minWidth: 120 }}>
              <Progress
                type="circle"
                percent={progressPct}
                size={70}
                strokeColor="#52c41a"
              />
              <div style={{ marginTop: 4 }}>
                <Text type="secondary" style={{ fontSize: 12 }}>
                  KR {doneKR}/{totalKR}
                </Text>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* Long Term Direction */}
      {identity.longTermDirection && (
        <Card title={<><AimOutlined /> 长期方向</>} style={{ marginBottom: 24 }}>
          <Paragraph style={{ fontSize: 15, lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
            {identity.longTermDirection}
          </Paragraph>
        </Card>
      )}

      {/* OKR Card */}
      <Card title="🎯 月度 OKR" style={{ marginBottom: 24 }}>
        {(!identity.monthlyGoals || identity.monthlyGoals.length === 0) ? (
          <Text type="secondary">暂无月度 OKR</Text>
        ) : (
          <Timeline
            items={identity.monthlyGoals.map((group: MonthlyGoalGroup) => ({
              color: group.status === 'completed' ? 'green' : group.status === 'active' ? 'blue' : 'gray',
              children: (
                <div key={group.month}>
                  <Space style={{ marginBottom: 8 }}>
                    <Text strong>{group.month}</Text>
                    <Tag color={group.status === 'completed' ? 'green' : group.status === 'active' ? 'blue' : 'default'}>
                      {group.status === 'completed' ? '已完成' : group.status === 'active' ? '进行中' : '已取消'}
                    </Tag>
                  </Space>
                  <Paragraph style={{ margin: '0 0 8px' }}>{group.goal}</Paragraph>
                  {group.krs?.map((kr, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0', paddingLeft: 16 }}>
                      <KRStatusIcon status={kr.status} />
                      <Text style={{ flex: 1 }}>{kr.text}</Text>
                      <Progress
                        percent={kr.progress}
                        size="small"
                        style={{ width: 120, margin: 0 }}
                        strokeColor={kr.status === 'done' ? '#52c41a' : '#1677ff'}
                      />
                      <Tag color={kr.status === 'done' ? 'green' : kr.status === 'doing' ? 'processing' : 'default'}>
                        {kr.status === 'done' ? '完成' : kr.status === 'doing' ? '进行中' : '待开始'}
                      </Tag>
                    </div>
                  ))}
                </div>
              ),
            }))}
          />
        )}
      </Card>

      {/* Capabilities */}
      {identity.capabilities && identity.capabilities.length > 0 && (
        <Card title="🛠️ 能力图谱" style={{ marginBottom: 24 }}>
          <Space wrap>
            {identity.capabilities.map((cap: string, idx: number) => (
              <Tag key={idx} color="blue" style={{ padding: '4px 12px', fontSize: 13 }}>
                {cap}
              </Tag>
            ))}
          </Space>
        </Card>
      )}

      {/* Details */}
      <Card title="📋 详细信息" style={{ marginBottom: 24 }}>
        <Descriptions column={2} size="small">
          <Descriptions.Item label="ID">{identity.id.slice(0, 12)}...</Descriptions.Item>
          <Descriptions.Item label="类型">{isAgent ? 'Agent' : 'Human'}</Descriptions.Item>
          {isAgent && identity.agentType && (
            <Descriptions.Item label="Agent 类型">{identity.agentType}</Descriptions.Item>
          )}
          <Descriptions.Item label="管线">{pipeline.label}</Descriptions.Item>
          <Descriptions.Item label="层级">{layer.label}</Descriptions.Item>
          <Descriptions.Item label="状态">
            <Tag color={identity.status === 'active' ? 'green' : 'default'}>{identity.status}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">{new Date(identity.createdAt).toLocaleDateString('zh-CN')}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{new Date(identity.updatedAt).toLocaleDateString('zh-CN')}</Descriptions.Item>
        </Descriptions>
      </Card>
    </div>
  );
}
