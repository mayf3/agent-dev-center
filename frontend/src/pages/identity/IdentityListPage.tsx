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
} from 'antd';
import {
  AimOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  ReloadOutlined,
  RobotOutlined,
  SearchOutlined,
  TeamOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { identitiesApi, type Identity } from '../../api/identities';

const { Title, Text } = Typography;

const LAYER_CONFIG: Record<string, { label: string; color: string }> = {
  mainline: { label: '核心管线', color: 'blue' },
  explore: { label: '探索管线', color: 'purple' },
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
  business: { label: '业务', color: 'red' },
  cross_cutting: { label: '跨层职能', color: 'lime' },
};

function getKRProgress(goals: Identity['monthlyGoals']): { done: number; total: number } {
  let total = 0;
  let done = 0;
  for (const g of goals || []) {
    for (const kr of g.krs || []) {
      total++;
      if (kr.status === 'done' || kr.progress >= 100) done++;
    }
  }
  return { total, done };
}

export default function IdentityListPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [pipelineFilter, setPipelineFilter] = useState<string>('');
  const [searchText, setSearchText] = useState('');

  const fetchList = async () => {
    setLoading(true);
    try {
      const params: Record<string, unknown> = {};
      if (typeFilter) params.type = typeFilter;
      if (pipelineFilter) params.pipeline = pipelineFilter;
      if (searchText) params.search = searchText;

      const res = await identitiesApi.list(params as any);
      setIdentities(res.data.data);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchList(); }, []);

  useEffect(() => {
    const timer = setTimeout(() => fetchList(), 300);
    return () => clearTimeout(timer);
  }, [typeFilter, pipelineFilter, searchText]);

  const typeOptions = [
    { value: '', label: '全部实体' },
    { value: 'human', label: '人' },
    { value: 'agent', label: 'Agent' },
  ];

  const pipelineOptions = [
    { value: '', label: '全部管线' },
    ...Object.entries(PIPELINE_CONFIG).map(([k, v]) => ({ value: k, label: v.label })),
  ];

  return (
    <div style={{ padding: 24 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Space>
          <TeamOutlined style={{ fontSize: 28, color: '#1677ff' }} />
          <Title level={4} style={{ margin: 0 }}>统一身份与规划平台</Title>
        </Space>
        <Button icon={<ReloadOutlined />} onClick={fetchList} loading={loading}>刷新</Button>
      </div>

      {/* Filters */}
      <Card size="small" style={{ marginBottom: 16 }}>
        <Space wrap size="middle">
          <Input
            prefix={<SearchOutlined />}
            placeholder="搜索名称..."
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            style={{ width: 220 }}
            allowClear
          />
          <Select
            options={typeOptions}
            value={typeFilter}
            onChange={setTypeFilter}
            style={{ width: 140 }}
          />
          <Select
            options={pipelineOptions}
            value={pipelineFilter}
            onChange={setPipelineFilter}
            style={{ width: 160 }}
          />
        </Space>
      </Card>

      {/* List */}
      <Spin spinning={loading}>
        {identities.length === 0 ? (
          <Empty description="暂无实体数据，请先运行数据同步" />
        ) : (
          <Row gutter={[16, 16]}>
            {identities.map((entity) => {
              const isAgent = entity.type === 'agent';
              const pipeline = PIPELINE_CONFIG[entity.pipeline || ''] || { label: entity.pipeline || '未知', color: 'default' };
              const layer = LAYER_CONFIG[entity.layer || ''] || { label: entity.layer || '', color: 'default' };
              const progress = getKRProgress(entity.monthlyGoals);
              const progressPct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

              return (
                <Col key={entity.id} xs={24} sm={12} md={8} lg={6}>
                  <Card
                    hoverable
                    style={{ height: '100%' }}
                    onClick={() => navigate(`/identity/${entity.type}/${entity.id}`)}
                  >
                    <Space direction="vertical" style={{ width: '100%' }} size={8}>
                      {/* Avatar + Name */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <Avatar
                          size={44}
                          icon={isAgent ? <RobotOutlined /> : <UserOutlined />}
                          src={entity.avatar}
                          style={{ backgroundColor: isAgent ? '#1677ff' : '#52c41a' }}
                        />
                        <div>
                          <Text strong style={{ fontSize: 15 }}>{entity.displayName}</Text>
                          <div>
                            <Tag color={isAgent ? 'blue' : 'green'} style={{ marginRight: 4 }}>
                              {isAgent ? 'Agent' : 'Human'}
                            </Tag>
                            <Tag color={layer.color}>{layer.label}</Tag>
                          </div>
                        </div>
                      </div>

                      {/* Pipeline + Status */}
                      <Space>
                        <Tag color={pipeline.color}>{pipeline.label}</Tag>
                        {isAgent && entity.agentType && (
                          <Tag>{entity.agentType}</Tag>
                        )}
                      </Space>

                      {/* KR Progress */}
                      {progress.total > 0 && (
                        <div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                            <Text type="secondary">KR 进度</Text>
                            <Text type="secondary">{progress.done}/{progress.total}</Text>
                          </div>
                          <div style={{ height: 6, backgroundColor: '#f0f0f0', borderRadius: 3, overflow: 'hidden', display: 'flex' }}>
                            <div style={{ width: `${Math.min(progressPct, 100)}%`, height: '100%', backgroundColor: '#52c41a', transition: 'width 0.3s' }} />
                            <div style={{ width: `${Math.min(100 - progressPct, 100)}%`, height: '100%', backgroundColor: '#1677ff', opacity: 0.15 }} />
                          </div>
                        </div>
                      )}

                      {/* Long term direction preview */}
                      {entity.longTermDirection && (
                        <Text type="secondary" ellipsis style={{ fontSize: 12 }}>
                          <AimOutlined style={{ marginRight: 4 }} />
                          {entity.longTermDirection.slice(0, 60)}
                        </Text>
                      )}
                    </Space>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </Spin>
    </div>
  );
}
