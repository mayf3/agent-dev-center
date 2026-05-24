import { useEffect, useState } from 'react';
import {
  Card,
  Typography,
  Space,
  Tag,
  Button,
  Descriptions,
  Spin,
  message,
  Select,
  Divider,
  Empty,
  Input,
  Form,
  Modal,
} from 'antd';
import {
  ArrowLeftOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  BugOutlined,
  LinkOutlined,
} from '@ant-design/icons';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  postmortemsApi,
  type Postmortem,
  type PostmortemStatus,
} from '../../api/postmortems';

const { Title, Text, Paragraph } = Typography;

const STATUS_CONFIG: Record<PostmortemStatus, { label: string; color: string }> = {
  pending: { label: '待落实', color: 'red' },
  implemented: { label: '已落实', color: 'blue' },
  verified: { label: '已验证', color: 'green' },
};

const STATUS_OPTIONS = [
  { label: '待落实', value: 'pending' },
  { label: '已落实', value: 'implemented' },
  { label: '已验证', value: 'verified' },
];

export function PostmortemDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [postmortem, setPostmortem] = useState<Postmortem | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingStatus, setSavingStatus] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [form] = Form.useForm();
  const [saving, setSaving] = useState(false);

  const fetchData = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const res = await postmortemsApi.get(id);
      setPostmortem(res.data.postmortem);
    } catch {
      message.error('加载验尸报告失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [id]);

  const handleStatusChange = async (status: PostmortemStatus) => {
    if (!id) return;
    setSavingStatus(true);
    try {
      await postmortemsApi.update(id, { status });
      message.success(`状态已更新: ${STATUS_CONFIG[status].label}`);
      fetchData();
    } catch {
      message.error('更新状态失败');
    } finally {
      setSavingStatus(false);
    }
  };

  const handleEdit = () => {
    if (!postmortem) return;
    form.setFieldsValue({
      title: postmortem.title,
      phenomenon: postmortem.phenomenon,
      rootCause: postmortem.rootCause,
      whyExistingProcess: postmortem.whyExistingProcess,
      longTermPrinciple: postmortem.longTermPrinciple,
      preventionMeasures: postmortem.preventionMeasures,
      responsiblePerson: postmortem.responsiblePerson,
    });
    setEditModalOpen(true);
  };

  const handleSaveEdit = async () => {
    try {
      const values = await form.validateFields();
      setSaving(true);
      await postmortemsApi.update(id!, values);
      message.success('更新成功');
      setEditModalOpen(false);
      fetchData();
    } catch {
      // validation error
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!postmortem) {
    return (
      <div style={{ textAlign: 'center', padding: 100 }}>
        <Empty description="验尸报告不存在" />
        <Button type="link" onClick={() => navigate('/postmortems')}>返回列表</Button>
      </div>
    );
  }

  const statusCfg = STATUS_CONFIG[postmortem.status] || { label: postmortem.status, color: 'default' };

  return (
    <div style={{ padding: 24, maxWidth: 900 }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/postmortems')}>返回</Button>
          <BugOutlined style={{ fontSize: 20, color: '#1677ff' }} />
          <Title level={4} style={{ margin: 0 }}>{postmortem.title}</Title>
        </Space>
        <Space>
          <Button onClick={handleEdit}>编辑</Button>
        </Space>
      </div>

      {/* Status & Quick Actions */}
      <Card style={{ marginBottom: 16 }} size="small">
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <Space>
            <Text strong>状态：</Text>
            <Select
              value={postmortem.status}
              onChange={handleStatusChange}
              options={STATUS_OPTIONS}
              style={{ width: 110 }}
              loading={savingStatus}
            />
          </Space>
          <Tag>{dayjs(postmortem.createdAt).format('YYYY-MM-DD HH:mm')}</Tag>
          {postmortem.requirement && (
            <Button
              type="link"
              icon={<LinkOutlined />}
              onClick={() => navigate(`/requirements/${postmortem.requirement!.id}`)}
            >
              关联需求: {postmortem.requirement.title.slice(0, 40)}
            </Button>
          )}
        </div>
      </Card>

      {/* Phenomenon */}
      <Card title="现象描述" style={{ marginBottom: 16 }}>
        <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 15 }}>{postmortem.phenomenon}</Paragraph>
      </Card>

      {/* Root Cause */}
      <Card title="根因分析" style={{ marginBottom: 16 }}>
        <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 15 }}>{postmortem.rootCause}</Paragraph>
      </Card>

      {/* Why Existing Process Failed */}
      <Card title="为什么现有流程没拦住" style={{ marginBottom: 16 }}>
        <Paragraph style={{ whiteSpace: 'pre-wrap' }}>
          {postmortem.whyExistingProcess || '未记录'}
        </Paragraph>
      </Card>

      {/* Long Term Principle */}
      <Card title="长期原则" style={{ marginBottom: 16 }}>
        <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 15, color: '#1677ff' }}>
          {postmortem.longTermPrinciple || '未提取'}
        </Paragraph>
      </Card>

      {/* Prevention Measures */}
      <Card title={<Space><CheckCircleOutlined style={{ color: '#52c41a' }} />预防措施</Space>} style={{ marginBottom: 16 }}>
        <Paragraph style={{ whiteSpace: 'pre-wrap', fontSize: 15 }}>{postmortem.preventionMeasures}</Paragraph>
      </Card>

      {/* Meta Info */}
      <Card title="基本信息" style={{ marginBottom: 16 }}>
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }} size="small">
          <Descriptions.Item label="责任人">
            <Text strong>{postmortem.responsiblePerson}</Text>
          </Descriptions.Item>
          <Descriptions.Item label="落实状态">
            <Tag color={statusCfg.color}>{statusCfg.label}</Tag>
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">
            {dayjs(postmortem.createdAt).format('YYYY-MM-DD HH:mm')}
          </Descriptions.Item>
          <Descriptions.Item label="更新时间">
            {dayjs(postmortem.updatedAt).format('YYYY-MM-DD HH:mm')}
          </Descriptions.Item>
          {postmortem.requirement && (
            <Descriptions.Item label="关联需求">
              <a onClick={() => navigate(`/requirements/${postmortem.requirement!.id}`)}>
                {postmortem.requirement.title}
              </a>
            </Descriptions.Item>
          )}
        </Descriptions>
      </Card>

      {/* Edit Modal */}
      <Modal
        title="编辑验尸报告"
        open={editModalOpen}
        onOk={handleSaveEdit}
        onCancel={() => setEditModalOpen(false)}
        confirmLoading={saving}
        width={700}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="title" label="标题" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
          <Form.Item name="phenomenon" label="现象描述" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="rootCause" label="根因分析" rules={[{ required: true }]}>
            <Input.TextArea rows={4} />
          </Form.Item>
          <Form.Item name="whyExistingProcess" label="为什么现有流程没拦住">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="longTermPrinciple" label="长期原则">
            <Input.TextArea rows={2} />
          </Form.Item>
          <Form.Item name="preventionMeasures" label="预防措施" rules={[{ required: true }]}>
            <Input.TextArea rows={3} />
          </Form.Item>
          <Form.Item name="responsiblePerson" label="责任人" rules={[{ required: true }]}>
            <Input />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
