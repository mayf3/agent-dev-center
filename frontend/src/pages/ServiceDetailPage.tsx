import {
  ArrowLeftOutlined,
  InfoCircleOutlined,
  CodeOutlined,
  RocketOutlined,
  LinkOutlined,
  GlobalOutlined,
  HomeOutlined,
  UserOutlined,
  DatabaseOutlined,
  ToolOutlined,
  CalendarOutlined,
  TagOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ExclamationCircleOutlined,
  ClockCircleOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { App as AntApp, Button, Card, Col, Descriptions, Empty, Row, Space, Spin, Statistic, Table, Tabs, Tag, Timeline, Typography } from 'antd';
import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import type { RegisteredService, GitCommit, ServiceRequirementRelation, Requirement, RequirementStatus } from '../api/types';

// ─── Status helpers ─────────────────────────────────────────────────────

const statusDot = (status: string) => {
  switch (status) {
    case 'online': return <Tag color="success" icon={<CheckCircleOutlined />}>在线</Tag>;
    case 'offline': return <Tag color="error" icon={<CloseCircleOutlined />}>离线</Tag>;
    case 'maintenance': return <Tag color="warning" icon={<ExclamationCircleOutlined />}>维护中</Tag>;
    default: return <Tag icon={<ClockCircleOutlined />}>未知</Tag>;
  }
};

const reqStatusColor = (status: RequirementStatus): string => {
  const map: Record<string, string> = {
    pending: 'default',
    approved: 'blue',
    rejected: 'red',
    'in-progress': 'processing',
    testing: 'cyan',
    review: 'purple',
    deploying: 'orange',
    done: 'success',
  };
  return map[status] ?? 'default';
};

// ─── Main page ──────────────────────────────────────────────────────────

export function ServiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [service, setService] = useState<RegisteredService | null>(null);
  const [commits, setCommits] = useState<GitCommit[]>([]);
  const [requirements, setRequirements] = useState<ServiceRequirementRelation[]>([]);
  const [groupedReqs, setGroupedReqs] = useState<Record<string, ServiceRequirementRelation[]>>({});
  const [loading, setLoading] = useState(true);
  const [commitsLoading, setCommitsLoading] = useState(false);
  const [reqsLoading, setReqsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('overview');
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 768);
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);

  // Fetch service detail
  const fetchService = useCallback(async () => {
    if (!id) return;
    try {
      const { data: res } = await api.get<{ data: RegisteredService }>(`/services/${id}`);
      setService(res.data);
    } catch {
      message.error('服务详情加载失败');
    } finally {
      setLoading(false);
    }
  }, [id, message]);

  // Fetch commits
  const fetchCommits = useCallback(async () => {
    if (!id) return;
    setCommitsLoading(true);
    try {
      const { data: res } = await api.get<{ data: GitCommit[]; total: number }>(`/services/${id}/commits`, {
        params: { limit: 30 },
      });
      setCommits(res.data ?? []);
    } catch {
      message.error('Git 记录加载失败');
    } finally {
      setCommitsLoading(false);
    }
  }, [id, message]);

  // Fetch requirements
  const fetchRequirements = useCallback(async () => {
    if (!id) return;
    setReqsLoading(true);
    try {
      const { data: res } = await api.get<{ data: ServiceRequirementRelation[]; grouped: Record<string, ServiceRequirementRelation[]> }>(`/services/${id}/requirements`);
      setRequirements(res.data ?? []);
      setGroupedReqs(res.grouped ?? {});
    } catch {
      message.error('关联需求加载失败');
    } finally {
      setReqsLoading(false);
    }
  }, [id, message]);

  useEffect(() => {
    void fetchService();
  }, [fetchService]);

  // Lazy-load tabs
  useEffect(() => {
    if (activeTab === 'commits' && commits.length === 0) void fetchCommits();
    if (activeTab === 'requirements' && requirements.length === 0) void fetchRequirements();
  }, [activeTab, commits.length, requirements.length, fetchCommits, fetchRequirements]);

  if (loading) return <Spin className="page-spin" />;

  if (!service) {
    return (
      <Space direction="vertical" style={{ width: '100%', padding: 40 }} align="center">
        <Empty description="服务不存在" />
        <Button onClick={() => navigate('/services')}>返回服务列表</Button>
      </Space>
    );
  }

  // ─── Tab 1: Overview ──────────────────────────────────────────
  const OverviewTab = () => (
    <Row gutter={[24, 24]}>
      <Col xs={24} lg={16}>
        <Card title={<Space><InfoCircleOutlined /> 基本信息</Space>} size="small">
          <Descriptions column={isMobile ? 1 : 2} size="small" bordered>
            <Descriptions.Item label="服务名">{service.name}</Descriptions.Item>
            <Descriptions.Item label="显示名">{service.displayName}</Descriptions.Item>
            <Descriptions.Item label="状态">{statusDot(service.status)}</Descriptions.Item>
            <Descriptions.Item label="版本">{service.version ? `v${service.version}` : '-'}</Descriptions.Item>
            <Descriptions.Item label="端口">
              {service.port ? (
                <Tag icon={<GlobalOutlined />}>{service.port}</Tag>
              ) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="负责 Agent">
              {service.owner ? (
                <Tag icon={<UserOutlined />} color="blue">{service.owner}</Tag>
              ) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="本地地址">
              {service.localUrl ? (
                <a href={service.localUrl} target="_blank" rel="noreferrer">
                  <HomeOutlined /> {service.localUrl}
                </a>
              ) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="远程地址">
              {service.remoteUrl ? (
                <a href={service.remoteUrl} target="_blank" rel="noreferrer">
                  <GlobalOutlined /> {service.remoteUrl}
                </a>
              ) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="技术栈" span={2}>
              <Space size={[4, 4]} wrap>
                {service.techStack.map(t => (
                  <Tag key={t} icon={<ToolOutlined />} color="geekblue">{t}</Tag>
                ))}
              </Space>
            </Descriptions.Item>
            <Descriptions.Item label="Git 仓库" span={2}>
              {service.gitRepo ? (
                <Typography.Text code style={{ fontSize: 12 }}>{service.gitRepo}</Typography.Text>
              ) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="数据库">
              {service.database ? (
                <Tag icon={<DatabaseOutlined />}>{service.database}</Tag>
              ) : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="最后部署">
              {service.lastDeployedAt
                ? new Date(service.lastDeployedAt).toLocaleString('zh-CN')
                : '-'}
            </Descriptions.Item>
            <Descriptions.Item label="创建时间">
              {new Date(service.createdAt).toLocaleString('zh-CN')}
            </Descriptions.Item>
            <Descriptions.Item label="更新时间">
              {new Date(service.updatedAt).toLocaleString('zh-CN')}
            </Descriptions.Item>
          </Descriptions>
        </Card>
      </Col>
      <Col xs={24} lg={8}>
        <Card title="服务描述" size="small">
          <Typography.Paragraph style={{ lineHeight: 1.8 }}>
            {service.description}
          </Typography.Paragraph>
        </Card>
        <Card title="快速操作" size="small" style={{ marginTop: 16 }}>
          <Space direction="vertical" style={{ width: '100%' }}>
            {service.localUrl && (
              <Button block icon={<HomeOutlined />} href={service.localUrl} target="_blank">
                打开本地服务
              </Button>
            )}
            {service.remoteUrl && (
              <Button block icon={<GlobalOutlined />} href={service.remoteUrl} target="_blank">
                打开远程服务
              </Button>
            )}
            {service.gitRepo && (
              <Button block icon={<CodeOutlined />} onClick={() => setActiveTab('commits')}>
                查看 Git 记录
              </Button>
            )}
          </Space>
        </Card>
      </Col>
    </Row>
  );

  // ─── Tab 2: Git Commits ───────────────────────────────────────
  const CommitsTab = () => {
    if (commitsLoading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;
    if (!service.gitRepo) {
      return <Empty description="未配置 Git 仓库路径" />;
    }
    if (commits.length === 0) {
      return <Empty description="暂无提交记录" />;
    }

    return (
      <Card
        title={<Space><CodeOutlined /> 最近提交</Space>}
        extra={
          <Button size="small" icon={<ReloadOutlined />} loading={commitsLoading} onClick={() => void fetchCommits()}>
            刷新
          </Button>
        }
        size="small"
      >
        <Timeline
          items={commits.map(c => ({
            color: 'blue' as const,
            children: (
              <div key={c.hash}>
                <div style={{ marginBottom: 4 }}>
                  <Typography.Text strong>{c.message}</Typography.Text>
                </div>
                <Space size={8} wrap style={{ fontSize: 12, color: '#8c8c8c' }}>
                  <span>
                    <Tag style={{ fontSize: 10 }}>{c.shortHash}</Tag>
                  </span>
                  <span><UserOutlined /> {c.author}</span>
                  <span><CalendarOutlined /> {new Date(c.date).toLocaleString('zh-CN')}</span>
                </Space>
              </div>
            ),
          }))}
        />
      </Card>
    );
  };

  // ─── Tab 3: Deploy History (placeholder) ──────────────────────
  const DeployTab = () => (
    <Card title={<Space><RocketOutlined /> 部署历史</Space>} size="small">
      <Empty
        description="部署历史功能开发中"
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      >
        <Typography.Text type="secondary">
          部署记录将在服务部署流水线接入后自动生成
        </Typography.Text>
      </Empty>
    </Card>
  );

  // ─── Tab 4: Related Requirements ──────────────────────────────
  const RequirementsTab = () => {
    if (reqsLoading) return <Spin style={{ display: 'block', margin: '40px auto' }} />;
    if (requirements.length === 0) {
      return <Empty description="暂无关联需求" />;
    }

    const statusLabels: Record<string, string> = {
      pending: '待审核',
      approved: '已审批',
      rejected: '已拒绝',
      'in-progress': '开发中',
      testing: '测试中',
      review: '审核中',
      deploying: '部署中',
      done: '已完成',
    };

    const statusOrder: string[] = ['in-progress', 'approved', 'review', 'testing', 'pending', 'done', 'rejected', 'deploying'];

    return (
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Card size="small">
          <Statistic title="关联需求总数" value={requirements.length} />
        </Card>
        {statusOrder
          .filter(s => groupedReqs[s] && groupedReqs[s].length > 0)
          .map(status => (
            <Card
              key={status}
              title={
                <Space>
                  <Tag color={reqStatusColor(status as RequirementStatus)}>{statusLabels[status] ?? status}</Tag>
                  <span>{groupedReqs[status].length} 个需求</span>
                </Space>
              }
              size="small"
            >
              <Table
                dataSource={groupedReqs[status]}
                rowKey="id"
                size="small"
                pagination={false}
                columns={[
                  {
                    title: '需求标题',
                    dataIndex: ['requirement', 'title'],
                    render: (title: string, record: ServiceRequirementRelation) => (
                      <a onClick={() => navigate(`/requirements/${record.requirementId}`)}>{title}</a>
                    ),
                  },
                  {
                    title: '关联类型',
                    dataIndex: 'relationType',
                    width: 100,
                    render: (type: string) => (
                      <Tag color={type === 'primary' ? 'blue' : 'default'}>{type}</Tag>
                    ),
                  },
                  {
                    title: '优先级',
                    dataIndex: ['requirement', 'priority'],
                    width: 80,
                    render: (p: string) => <Tag>{p}</Tag>,
                  },
                  {
                    title: '关联时间',
                    dataIndex: 'createdAt',
                    width: 160,
                    render: (d: string) => new Date(d).toLocaleString('zh-CN'),
                  },
                ]}
              />
            </Card>
          ))}
      </Space>
    );
  };

  // ─── Render ──────────────────────────────────────────────────
  return (
    <Space direction="vertical" size="middle" className="page-stack" style={{ width: '100%' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
        <Space>
          <Button
            icon={<ArrowLeftOutlined />}
            onClick={() => navigate('/services')}
          >
            返回
          </Button>
          <Typography.Title level={isMobile ? 4 : 3} style={{ margin: 0 }}>
            {service.displayName}
          </Typography.Title>
          {statusDot(service.status)}
        </Space>
        <Space>
          {service.version && <Tag color="blue">v{service.version}</Tag>}
          {service.owner && <Tag icon={<UserOutlined />}>{service.owner}</Tag>}
        </Space>
      </div>

      {/* Tabs */}
      <Card bodyStyle={{ padding: '8px 16px' }}>
        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'overview',
              label: <Space><InfoCircleOutlined /> 概览</Space>,
              children: <OverviewTab />,
            },
            {
              key: 'commits',
              label: <Space><CodeOutlined /> 开发记录</Space>,
              children: <CommitsTab />,
            },
            {
              key: 'deploy',
              label: <Space><RocketOutlined /> 部署历史</Space>,
              children: <DeployTab />,
            },
            {
              key: 'requirements',
              label: <Space><LinkOutlined /> 关联需求</Space>,
              children: <RequirementsTab />,
            },
          ]}
        />
      </Card>
    </Space>
  );
}
