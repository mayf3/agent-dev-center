/**
 * 任务详情 Drawer — 侧滑面板（移动端友好）
 * 显示任务信息、状态操作、交付物列表
 */
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  PlusOutlined,
  RobotOutlined,
  UserOutlined
} from '@ant-design/icons';
import {
  Alert,
  App as AntApp,
  Avatar,
  Button,
  Descriptions,
  Divider,
  Drawer,
  Empty,
  Form,
  Input,
  Select,
  Space,
  Tag,
  Timeline,
  Typography
} from 'antd';
import dayjs from 'dayjs';
import { useCallback, useEffect, useState } from 'react';
import {
  listDeliverables,
  createDeliverable,
  deleteDeliverable,
  updateTask
} from '../../api/marketplace';
import type {
  MarketplaceTask,
  MarketplaceDeliverable,
  MarketplaceTaskStatus
} from '../../api/marketplace-types';
import { MarketplaceStatusTag } from '../../components/MarketplaceStatusTag';
import { MarketplacePriorityTag } from '../../components/MarketplacePriorityTag';
import { useAuth } from '../../contexts/AuthContext';

const { TextArea } = Input;

interface TaskDetailDrawerProps {
  task: MarketplaceTask | null;
  open: boolean;
  onClose: () => void;
  onRefresh: () => void;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const resp = (error as { response?: { data?: { message?: string } } }).response;
    return resp?.data?.message ?? fallback;
  }
  return fallback;
}

export function TaskDetailDrawer({ task, open, onClose, onRefresh }: TaskDetailDrawerProps) {
  const { message } = AntApp.useApp();
  const { isAuthenticated } = useAuth();
  const [deliverables, setDeliverables] = useState<MarketplaceDeliverable[]>([]);
  const [addOpen, setAddOpen] = useState(false);
  const [addLoading, setAddLoading] = useState(false);
  const [form] = Form.useForm();

  const loadDeliverables = useCallback(async () => {
    if (!task) return;
    try {
      const data = await listDeliverables(task.id);
      setDeliverables(data);
    } catch {
      // silently ignore
    }
  }, [task]);

  useEffect(() => {
    if (open && task) {
      void loadDeliverables();
    }
  }, [open, task, loadDeliverables]);

  if (!task) return null;

  const handleAddDeliverable = async () => {
    try {
      const values = await form.validateFields();
      setAddLoading(true);
      await createDeliverable(task.id, values);
      message.success('交付物已添加');
      setAddOpen(false);
      form.resetFields();
      await loadDeliverables();
      onRefresh();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(getErrorMessage(err, '添加交付物失败'));
    } finally {
      setAddLoading(false);
    }
  };

  const handleDeleteDeliverable = async (id: string) => {
    try {
      await deleteDeliverable(id);
      message.success('交付物已删除');
      await loadDeliverables();
    } catch (err) {
      message.error(getErrorMessage(err, '删除失败'));
    }
  };

  const handleStatusChange = async (newStatus: MarketplaceTaskStatus) => {
    try {
      await updateTask(task.id, { status: newStatus });
      message.success('状态已更新');
      onRefresh();
    } catch (err) {
      message.error(getErrorMessage(err, '状态更新失败'));
    }
  };

  /** 状态操作按钮 — 只有合法的状态转换 */
  const statusActions: React.ReactNode = (() => {
    if (!isAuthenticated || task.status === 'completed') return null;
    switch (task.status) {
      case 'pending':
        return <Button type="primary" icon={<RobotOutlined />} onClick={() => void handleStatusChange('processing')}>开始处理</Button>;
      case 'processing':
        return (
          <Space>
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => void handleStatusChange('completed')}>标记完成</Button>
            <Button danger icon={<ExclamationCircleOutlined />} onClick={() => void handleStatusChange('failed')}>标记失败</Button>
          </Space>
        );
      case 'failed':
        return <Button icon={<ClockCircleOutlined />} onClick={() => void handleStatusChange('pending')}>重新排队</Button>;
      case 'cancelled':
        return <Button icon={<ClockCircleOutlined />} onClick={() => void handleStatusChange('pending')}>重新激活</Button>;
      default:
        return null;
    }
  })();

  return (
    <Drawer
      title={task.title}
      open={open}
      onClose={onClose}
      width={640}
      destroyOnClose
    >
      <Descriptions column={{ xs: 1, sm: 2 }} size="small" bordered>
        <Descriptions.Item label="Agent">
          <Space>
            <Avatar size="small">{task.agent?.avatar || task.agent?.displayName?.[0] || '?'}</Avatar>
            {task.agent?.displayName ?? '未知'}
          </Space>
        </Descriptions.Item>
        <Descriptions.Item label="提交者">
          <Space><UserOutlined /> {task.requesterName}</Space>
        </Descriptions.Item>
        <Descriptions.Item label="状态">
          <MarketplaceStatusTag status={task.status} />
        </Descriptions.Item>
        <Descriptions.Item label="优先级">
          <MarketplacePriorityTag priority={task.priority} />
        </Descriptions.Item>
        <Descriptions.Item label="截止日期">
          {task.deadline ? dayjs(task.deadline).format('YYYY-MM-DD HH:mm') : '无'}
        </Descriptions.Item>
        <Descriptions.Item label="创建时间">
          {dayjs(task.createdAt).format('YYYY-MM-DD HH:mm')}
        </Descriptions.Item>
        <Descriptions.Item label="描述" span={2}>
          <Typography.Paragraph style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {task.description}
          </Typography.Paragraph>
        </Descriptions.Item>
      </Descriptions>

      {task.errorMsg && (
        <Alert message="错误信息" description={task.errorMsg} type="error" style={{ marginTop: 12 }} showIcon />
      )}

      {/* 状态操作按钮 */}
      {statusActions && (
        <div style={{ marginTop: 12 }}>{statusActions}</div>
      )}

      <Divider orientation="left">交付物 ({deliverables.length})</Divider>

      {isAuthenticated && task.status !== 'completed' && (
        <Button
          type="dashed"
          icon={<PlusOutlined />}
          size="small"
          onClick={() => setAddOpen(true)}
          style={{ marginBottom: 12 }}
        >
          添加交付物
        </Button>
      )}

      {deliverables.length > 0 ? (
        <Timeline
          items={deliverables.map((d) => ({
            color: d.type === 'text' ? 'blue' : d.type === 'image' ? 'green' : d.type === 'url' ? 'cyan' : 'gray',
            children: (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Space>
                    <Tag>{d.type}</Tag>
                    <Typography.Text strong>{d.title || d.type}</Typography.Text>
                  </Space>
                  {isAuthenticated && task.status !== 'completed' && (
                    <Button type="text" danger size="small" onClick={() => void handleDeleteDeliverable(d.id)}>
                      删除
                    </Button>
                  )}
                </div>
                {d.type === 'url' ? (
                  <Typography.Link href={d.content} target="_blank" style={{ fontSize: 13 }}>
                    {d.content}
                  </Typography.Link>
                ) : (
                  <Typography.Paragraph
                    ellipsis={{ rows: 3, expandable: true, symbol: '展开' }}
                    style={{ margin: '4px 0 0', fontSize: 13, color: '#666' }}
                  >
                    {d.content}
                  </Typography.Paragraph>
                )}
                <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                  {dayjs(d.createdAt).format('MM-DD HH:mm')}
                </Typography.Text>
              </div>
            )
          }))}
        />
      ) : (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无交付物" />
      )}

      {/* 添加交付物 Modal */}
      <div style={{ display: addOpen ? 'block' : 'none' }}>
        {/* Using div toggle to preserve form state */}
      </div>
      {addOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 1001
        }}>
          <div style={{ background: '#fff', borderRadius: 8, padding: 24, width: 480, maxWidth: '90vw' }}>
            <Typography.Title level={5}>添加交付物</Typography.Title>
            <Form form={form} layout="vertical">
              <Form.Item name="type" label="类型" rules={[{ required: true, message: '请选择类型' }]}>
                <Select
                  options={[
                    { label: '文本', value: 'text' },
                    { label: 'URL', value: 'url' },
                    { label: '图片', value: 'image' },
                    { label: '文档', value: 'document' },
                    { label: '文件', value: 'file' }
                  ]}
                />
              </Form.Item>
              <Form.Item name="title" label="标题">
                <Input placeholder="可选标题" />
              </Form.Item>
              <Form.Item name="content" label="内容" rules={[{ required: true, message: '请输入内容' }]}>
                <TextArea rows={4} placeholder="交付物内容或 URL" />
              </Form.Item>
            </Form>
            <div style={{ textAlign: 'right' }}>
              <Space>
                <Button onClick={() => { setAddOpen(false); form.resetFields(); }}>取消</Button>
                <Button type="primary" loading={addLoading} onClick={() => void handleAddDeliverable()}>添加</Button>
              </Space>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
