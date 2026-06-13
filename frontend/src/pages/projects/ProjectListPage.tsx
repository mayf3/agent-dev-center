import {
  App as AntApp,
  Card,
  Col,
  Empty,
  Input,
  Row,
  Segmented,
  Select,
  Space,
  Spin,
  Tag,
  Typography
} from 'antd';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { fetchProjects, type Project } from '../../api/projects';

const statusOptions = [
  { value: 'active', label: '运行中' },
  { value: 'maintaining', label: '维护中' },
  { value: 'deprecated', label: '已废弃' },
];

const statusMeta: Record<string, { label: string; color: string }> = {
  active: { label: '运行中', color: 'green' },
  maintaining: { label: '维护中', color: 'gold' },
  deprecated: { label: '已废弃', color: 'default' },
};

type ViewMode = 'card' | 'list';

function getTagline(description: string | null) {
  return description?.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() || '暂无项目描述';
}

function getFeatureCount(featureList: string | null) {
  if (!featureList) return 0;
  const lines = featureList.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const markedItems = lines.filter((line) => /^[-*+]\s+/.test(line) || /^\d+[.)]\s+/.test(line));
  return markedItems.length > 0 ? markedItems.length : lines.length;
}

function ProjectStatusTag({ status }: { status: string }) {
  const meta = statusMeta[status] ?? { label: status, color: 'blue' };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function ProjectCard({ project, mode }: { project: Project; mode: ViewMode }) {
  const navigate = useNavigate();
  const featureCount = getFeatureCount(project.featureList);
  const isList = mode === 'list';

  return (
    <Card
      hoverable
      onClick={() => navigate(`/projects/${project.id}`)}
      style={{ height: '100%' }}
      styles={{ body: { minHeight: isList ? 120 : 180 } }}
    >
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        <Space align="start" style={{ justifyContent: 'space-between', width: '100%' }}>
          <div style={{ minWidth: 0 }}>
            <Typography.Title level={isList ? 4 : 5} style={{ margin: 0 }} ellipsis={{ rows: 1 }}>
              {project.name}
            </Typography.Title>
            <Typography.Text type="secondary" ellipsis style={{ display: 'block', marginTop: 8 }}>
              {getTagline(project.description)}
            </Typography.Text>
          </div>
          <ProjectStatusTag status={project.status} />
        </Space>

        <Space size="small" wrap>
          <Tag>{featureCount} 个核心功能</Tag>
          {project.owner ? <Tag color="blue">Owner: {project.owner.name}</Tag> : <Tag>未指定 Owner</Tag>}
        </Space>

        {isList && project.boundaries && (
          <Typography.Paragraph type="secondary" ellipsis={{ rows: 2 }} style={{ marginBottom: 0 }}>
            {project.boundaries.replace(/[#*`>-]/g, '').trim()}
          </Typography.Paragraph>
        )}
      </Space>
    </Card>
  );
}

export function ProjectListPage() {
  const { message } = AntApp.useApp();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<string | undefined>();
  const [viewMode, setViewMode] = useState<ViewMode>('card');

  const params = useMemo(() => ({
    page: 1,
    pageSize: 100,
    search: search.trim() || undefined,
    status,
  }), [search, status]);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetchProjects(params);
      setProjects(response.data);
    } catch {
      message.error('项目列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [message, params]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>项目</Typography.Title>
          <Typography.Text type="secondary" style={{ marginTop: 4, display: 'block' }}>
            管理平台项目边界、核心能力和关联需求
          </Typography.Text>
        </div>
      </div>

      <Card>
        <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
          <Space wrap>
            <Input.Search
              allowClear
              placeholder="搜索项目名称"
              style={{ width: 260 }}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onSearch={(value) => setSearch(value)}
            />
            <Select
              allowClear
              placeholder="项目状态"
              style={{ width: 160 }}
              value={status}
              options={statusOptions}
              onChange={setStatus}
            />
          </Space>
          <Segmented
            value={viewMode}
            options={[
              { label: '卡片', value: 'card' },
              { label: '列表', value: 'list' },
            ]}
            onChange={(value) => setViewMode(value as ViewMode)}
          />
        </Space>
      </Card>

      <Spin spinning={loading}>
        {projects.length === 0 ? (
          <Card>
            <Empty description="暂无项目" />
          </Card>
        ) : viewMode === 'card' ? (
          <Row gutter={[16, 16]}>
            {projects.map((project) => (
              <Col key={project.id} xs={24} sm={12} xl={8} xxl={6}>
                <ProjectCard project={project} mode="card" />
              </Col>
            ))}
          </Row>
        ) : (
          <Space direction="vertical" size="middle" style={{ width: '100%' }}>
            {projects.map((project) => (
              <ProjectCard key={project.id} project={project} mode="list" />
            ))}
          </Space>
        )}
      </Spin>
    </Space>
  );
}
