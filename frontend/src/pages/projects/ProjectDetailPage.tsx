import { LeftOutlined } from '@ant-design/icons';
import {
  App as AntApp,
  Button,
  Card,
  Descriptions,
  Empty,
  Space,
  Spin,
  Tag,
  Typography
} from 'antd';
import { useCallback, useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../../api/client';
import { fetchProject, type Project } from '../../api/projects';
import type { PaginatedResponse, Requirement } from '../../api/types';
import { PriorityTag } from '../../components/PriorityTag';
import { StatusTag } from '../../components/StatusTag';
import { TypeTag } from '../../components/TypeTag';

const statusMeta: Record<string, { label: string; color: string }> = {
  active: { label: '运行中', color: 'green' },
  maintaining: { label: '维护中', color: 'gold' },
  deprecated: { label: '已废弃', color: 'default' },
};

function ProjectStatusTag({ status }: { status: string }) {
  const meta = statusMeta[status] ?? { label: status, color: 'blue' };
  return <Tag color={meta.color}>{meta.label}</Tag>;
}

function MarkdownSection({ content, emptyText }: { content: string | null; emptyText: string }) {
  if (!content?.trim()) {
    return <Typography.Text type="secondary">{emptyText}</Typography.Text>;
  }

  return (
    <div className="markdown-body">
      <ReactMarkdown>{content}</ReactMarkdown>
    </div>
  );
}

function RequirementRow({ requirement }: { requirement: Requirement }) {
  return (
    <div
      style={{
        border: '1px solid #f0f0f0',
        borderRadius: 8,
        padding: 12,
        background: '#fff',
      }}
    >
      <Space direction="vertical" size={8} style={{ width: '100%' }}>
        <Space wrap style={{ justifyContent: 'space-between', width: '100%' }}>
          <Link to={`/requirements/${requirement.id}`}>
            <Typography.Text strong>{requirement.title}</Typography.Text>
          </Link>
          <StatusTag status={requirement.status} />
        </Space>
        <Space size="small" wrap>
          <PriorityTag priority={requirement.priority} />
          <TypeTag type={requirement.type} />
          <Tag>{requirement.department}</Tag>
          {requirement.assignee ? <Tag color="blue">{requirement.assignee}</Tag> : <Tag>未分配</Tag>}
        </Space>
      </Space>
    </div>
  );
}

export function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { message } = AntApp.useApp();
  const [project, setProject] = useState<Project | null>(null);
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);

  const loadProject = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    try {
      const [projectData, requirementResponse] = await Promise.all([
        fetchProject(id),
        api.get<PaginatedResponse<Requirement>>('/requirements', {
          params: { page: 1, pageSize: 20, projectId: id },
        }),
      ]);
      setProject(projectData);
      setRequirements(requirementResponse.data.data);
    } catch {
      message.error('项目详情加载失败');
    } finally {
      setLoading(false);
    }
  }, [id, message]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  if (loading) return <Spin className="page-spin" />;

  if (!project) {
    return (
      <Card>
        <Space direction="vertical">
          <Typography.Title level={4}>项目不存在或无权访问</Typography.Title>
          <Button onClick={() => navigate('/projects')}>返回项目列表</Button>
        </Space>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-heading">
        <div>
          <Space size={8} wrap>
            <Button type="text" icon={<LeftOutlined />} onClick={() => navigate('/projects')}>返回</Button>
            <ProjectStatusTag status={project.status} />
          </Space>
          <Typography.Title level={3}>{project.name}</Typography.Title>
          <Typography.Text type="secondary" className="page-heading-subtitle">
            {project.description || '暂无项目描述'}
          </Typography.Text>
        </div>
      </div>

      <Card title="基本信息">
        <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="项目 ID">
            <Typography.Text copyable code>{project.id}</Typography.Text>
          </Descriptions.Item>
          <Descriptions.Item label="项目名称">{project.name}</Descriptions.Item>
          <Descriptions.Item label="描述">{project.description || '暂无'}</Descriptions.Item>
          <Descriptions.Item label="状态"><ProjectStatusTag status={project.status} /></Descriptions.Item>
          <Descriptions.Item label="Owner">{project.owner?.name || '未指定'}</Descriptions.Item>
          <Descriptions.Item label="创建时间">{new Date(project.createdAt).toLocaleString()}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{new Date(project.updatedAt).toLocaleString()}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="✅ Core Features">
        <MarkdownSection content={project.featureList} emptyText="暂无核心功能" />
      </Card>

      <Card title="🚫 Boundaries">
        <MarkdownSection content={project.boundaries} emptyText="暂无边界说明" />
      </Card>

      <Card title="📊 Related Requirements">
        {requirements.length === 0 ? (
          <Empty description="暂无关联需求" />
        ) : (
          <Space direction="vertical" size="small" style={{ width: '100%' }}>
            {requirements.map((requirement) => (
              <RequirementRow key={requirement.id} requirement={requirement} />
            ))}
          </Space>
        )}
      </Card>
    </Space>
  );
}
