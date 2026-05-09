import { CheckCircleOutlined, ClockCircleOutlined, CodeOutlined, InboxOutlined } from '@ant-design/icons';
import { App as AntApp, Card, Col, Row, Space, Spin, Statistic, Table, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import type { PaginatedResponse, Requirement } from '../api/types';
import { PriorityTag } from '../components/PriorityTag';
import { StatusTag } from '../components/StatusTag';

export function DashboardPage() {
  const { message } = AntApp.useApp();
  const [requirements, setRequirements] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get<PaginatedResponse<Requirement>>('/requirements', {
          params: { page: 1, pageSize: 100 }
        });
        setRequirements(data.data);
      } catch {
        message.error('仪表盘数据加载失败');
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [message]);

  const stats = useMemo(() => {
    const count = (predicate: (item: Requirement) => boolean) =>
      requirements.filter(predicate).length;

    return {
      total: requirements.length,
      pending: count((item) => item.status === 'pending'),
      active: count((item) => ['approved', 'in-progress'].includes(item.status)),
      testing: count((item) => ['testing', 'review'].includes(item.status)),
      done: count((item) => item.status === 'done')
    };
  }, [requirements]);

  const columns: ColumnsType<Requirement> = [
    {
      title: '需求',
      dataIndex: 'title',
      render: (_, record) => <Link to={`/requirements/${record.id}`}>{record.title}</Link>
    },
    {
      title: '优先级',
      dataIndex: 'priority',
      width: 110,
      render: (priority) => <PriorityTag priority={priority} />
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (status) => <StatusTag status={status} />
    },
    {
      title: '负责人',
      dataIndex: 'assignee',
      width: 160,
      render: (assignee) => assignee || '未分配'
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 160,
      render: (value) => dayjs(value).format('MM-DD HH:mm')
    }
  ];

  if (loading) {
    return <Spin className="page-spin" />;
  }

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div>
        <Typography.Title level={3}>仪表盘</Typography.Title>
        <Typography.Text type="secondary">从需求提交、审核、开发到交付的实时概览</Typography.Text>
      </div>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic title="总需求" value={stats.total} prefix={<InboxOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic title="待审核" value={stats.pending} prefix={<ClockCircleOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic title="开发中" value={stats.active} prefix={<CodeOutlined />} />
          </Card>
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <Card>
            <Statistic title="已完成" value={stats.done} prefix={<CheckCircleOutlined />} />
          </Card>
        </Col>
      </Row>

      <Card title="最近更新">
        <Table
          rowKey="id"
          columns={columns}
          dataSource={requirements.slice(0, 8)}
          pagination={false}
          scroll={{ x: 760 }}
        />
      </Card>
    </Space>
  );
}
