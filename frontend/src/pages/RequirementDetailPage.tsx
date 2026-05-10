import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  EditOutlined,
  LeftOutlined,
  PlusOutlined,
  UserAddOutlined
} from '@ant-design/icons';
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Descriptions,
  Form,
  Input,
  Modal,
  Progress,
  Select,
  Space,
  Spin,
  Table,
  Tabs,
  Tag,
  Typography
} from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useCallback, useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import type { Requirement, RequirementPriority, Task, TaskStatus } from '../api/types';
import { PriorityTag } from '../components/PriorityTag';
import { ReportsTimeline } from '../components/ReportsTimeline';
import { StatusTag, TaskStatusTag } from '../components/StatusTag';
import {
  agentOptions,
  departmentOptions,
  priorityLabels,
  taskStatusLabels
} from '../constants/options';
import { useAuth } from '../contexts/AuthContext';

const { TextArea } = Input;

interface AssignmentValues {
  assignee: string;
}

interface RejectValues {
  rejectReason: string;
}

interface EditRequirementValues {
  title: string;
  description: string;
  priority: RequirementPriority;
  department: string;
  assignee?: string;
  dueDate?: Dayjs;
  attachment?: string;
}

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? fallback;
  }

  return fallback;
}

function formatDateTime(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '未设置';
}

function formatDate(value?: string | null) {
  return value ? dayjs(value).format('YYYY-MM-DD') : '未设置';
}

function editPayload(values: EditRequirementValues) {
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    priority: values.priority,
    department: values.department,
    assignee: values.assignee || undefined,
    dueDate: values.dueDate?.toISOString(),
    attachment: values.attachment?.trim() || undefined
  };
}

export function RequirementDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const { message } = AntApp.useApp();
  const [assignmentForm] = Form.useForm<AssignmentValues>();
  const [rejectForm] = Form.useForm<RejectValues>();
  const [editForm] = Form.useForm<EditRequirementValues>();
  const [requirement, setRequirement] = useState<Requirement | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [taskUpdating, setTaskUpdating] = useState<string | null>(null);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignmentMode, setAssignmentMode] = useState<'approve' | 'assign'>('assign');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [createTaskForm] = Form.useForm();
  const [createTaskLoading, setCreateTaskLoading] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = searchParams.get('tab') || 'description';

  const loadRequirement = useCallback(async () => {
    if (!id) {
      return;
    }

    setLoading(true);
    try {
      const { data } = await api.get<Requirement>(`/requirements/${id}`);
      setRequirement(data);
    } catch (error) {
      message.error(getErrorMessage(error, '需求详情加载失败'));
    } finally {
      setLoading(false);
    }
  }, [id, message]);

  useEffect(() => {
    void loadRequirement();
  }, [loadRequirement]);

  const isAdmin = user?.role === 'admin';
  const isDeveloper = user?.role === 'developer';
  const canRequesterEdit = Boolean(
    user?.role === 'requester' &&
      requirement &&
      ['pending', 'rejected'].includes(requirement.status)
  );

  const taskOptions = useMemo(
    () =>
      (Object.keys(taskStatusLabels) as TaskStatus[]).map((status) => ({
        value: status,
        label: taskStatusLabels[status]
      })),
    []
  );

  const openAssignment = (mode: 'approve' | 'assign') => {
    if (!requirement) {
      return;
    }

    setAssignmentMode(mode);
    assignmentForm.setFieldsValue({ assignee: requirement.assignee ?? undefined });
    setAssignmentOpen(true);
  };

  const handleAssignment = async (values: AssignmentValues) => {
    if (!requirement) {
      return;
    }

    setActionLoading(true);
    try {
      const shouldApprove =
        assignmentMode === 'approve' ||
        ['pending', 'rejected', 'approved'].includes(requirement.status);
      const { data } = await api.patch<Requirement>(`/requirements/${requirement.id}`, {
        assignee: values.assignee,
        status: shouldApprove ? 'approved' : undefined
      });
      setRequirement(data);
      setAssignmentOpen(false);
      message.success(assignmentMode === 'approve' ? '需求已通过并分配' : '开发负责人已更新');
    } catch (error) {
      message.error(getErrorMessage(error, '分配失败'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async (values: RejectValues) => {
    if (!requirement) {
      return;
    }

    setActionLoading(true);
    try {
      const { data } = await api.patch<Requirement>(`/requirements/${requirement.id}`, {
        status: 'rejected',
        rejectReason: values.rejectReason.trim()
      });
      setRequirement(data);
      setRejectOpen(false);
      rejectForm.resetFields();
      message.success('需求已拒绝');
    } catch (error) {
      message.error(getErrorMessage(error, '拒绝失败'));
    } finally {
      setActionLoading(false);
    }
  };

  const openEdit = () => {
    if (!requirement) {
      return;
    }

    editForm.setFieldsValue({
      title: requirement.title,
      description: requirement.description,
      priority: requirement.priority,
      department: requirement.department,
      assignee: requirement.assignee ?? undefined,
      dueDate: requirement.dueDate ? dayjs(requirement.dueDate) : undefined,
      attachment: requirement.attachment ?? undefined
    });
    setEditOpen(true);
  };

  const handleEdit = async (values: EditRequirementValues) => {
    if (!requirement) {
      return;
    }

    setActionLoading(true);
    try {
      const { data } = await api.put<Requirement>(
        `/requirements/${requirement.id}`,
        editPayload(values)
      );
      setRequirement(data);
      setEditOpen(false);
      message.success('需求已更新');
    } catch (error) {
      message.error(getErrorMessage(error, '需求更新失败'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleTaskStatusChange = async (task: Task, status: TaskStatus) => {
    setTaskUpdating(task.id);
    try {
      await api.patch<Task>(`/tasks/${task.id}`, { status });
      message.success('任务状态已更新');
      await loadRequirement();
    } catch (error) {
      message.error(getErrorMessage(error, '任务状态更新失败'));
    } finally {
      setTaskUpdating(null);
    }
  };

  const handleCreateTask = async () => {
    if (!requirement || !id) return;
    setCreateTaskLoading(true);
    try {
      const values = await createTaskForm.validateFields();
      await api.post('/tasks', {
        requirementId: id,
        title: values.title,
        description: values.description || '',
        agentType: values.agentType,
      });
      message.success('任务创建成功');
      setCreateTaskOpen(false);
      createTaskForm.resetFields();
      await loadRequirement();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return; // form validation
      message.error(getErrorMessage(err, '任务创建失败'));
    } finally {
      setCreateTaskLoading(false);
    }
  };

  const taskColumns: ColumnsType<Task> = [
    {
      title: '任务',
      dataIndex: 'title',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Typography.Text strong>{record.title}</Typography.Text>
          <Typography.Text type="secondary" ellipsis>
            {record.description}
          </Typography.Text>
        </Space>
      )
    },
    {
      title: '开发 Agent',
      dataIndex: 'agentType',
      width: 180
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 120,
      render: (status: TaskStatus) => <TaskStatusTag status={status} />
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 170,
      render: (value: string) => formatDateTime(value)
    },
    ...(isDeveloper || isAdmin
      ? [
          {
            title: '操作',
            key: 'action',
            width: 160,
            render: (_: unknown, record: Task) => (
              <Select
                value={record.status}
                options={taskOptions}
                loading={taskUpdating === record.id}
                disabled={Boolean(taskUpdating)}
                style={{ width: 130 }}
                onChange={(status: TaskStatus) => void handleTaskStatusChange(record, status)}
              />
            )
          }
        ]
      : [])
  ];

  if (loading) {
    return <Spin className="page-spin" />;
  }

  if (!requirement) {
    return (
      <Card>
        <Space direction="vertical">
          <Typography.Title level={4}>需求不存在或无权访问</Typography.Title>
          <Button onClick={() => navigate('/requirements')}>返回需求列表</Button>
        </Space>
      </Card>
    );
  }

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-heading">
        <div>
          <Space size={8} wrap>
            <Button type="text" icon={<LeftOutlined />} onClick={() => navigate('/requirements')}>
              返回
            </Button>
            <PriorityTag priority={requirement.priority} />
            <StatusTag status={requirement.status} />
          </Space>
          <Typography.Title level={3}>{requirement.title}</Typography.Title>
          <Typography.Text type="secondary">
            {requirement.department} · {requirement.requester} · 更新于{' '}
            {formatDateTime(requirement.updatedAt)}
          </Typography.Text>
        </div>
        <Space wrap>
          {isAdmin && isAuthenticated ? (
            <>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={() => openAssignment('approve')}
              >
                通过并分配
              </Button>
              <Button icon={<UserAddOutlined />} onClick={() => openAssignment('assign')}>
                分配开发 Agent
              </Button>
              <Button danger icon={<CloseCircleOutlined />} onClick={() => setRejectOpen(true)}>
                拒绝
              </Button>
            </>
          ) : null}
          {canRequesterEdit && isAuthenticated ? (
            <Button icon={<EditOutlined />} onClick={openEdit}>
              编辑需求
            </Button>
          ) : null}
        </Space>
      </div>

      <div className="detail-grid">
        <Tabs
          activeKey={activeTab}
          onChange={(key) => {
            if (key === 'description') {
              searchParams.delete('tab');
            } else {
              searchParams.set('tab', key);
            }
            setSearchParams(searchParams);
          }}
          items={[
            {
              key: 'description',
              label: '需求描述',
              children: (
                <Space direction="vertical" size="large" className="page-stack">
                  <Card title="需求描述">
                    <div className="markdown-body">
                      <ReactMarkdown>{requirement.description}</ReactMarkdown>
                    </div>
                  </Card>

                  <Card
                    title="相关任务"
                    extra={
                      (isAdmin || isDeveloper) && (
                        <Button
                          type="primary"
                          size="small"
                          icon={<PlusOutlined />}
                          onClick={() => setCreateTaskOpen(true)}
                        >
                          创建任务
                        </Button>
                      )
                    }
                  >
                    {(requirement.tasks ?? []).length > 0 && (
                      <div style={{ marginBottom: 16 }}>
                        <Space style={{ width: '100%' }} direction="vertical" size={4}>
                          <Space split={<Typography.Text type="secondary">|</Typography.Text>}>
                            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                              总计 <strong>{(requirement.tasks ?? []).length}</strong> 个任务
                            </Typography.Text>
                            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                              完成 <strong>{(requirement.tasks ?? []).filter((t) => t.status === 'done').length}</strong>
                            </Typography.Text>
                            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                              进行中 <strong>{(requirement.tasks ?? []).filter((t) => t.status === 'in-progress').length}</strong>
                            </Typography.Text>
                          </Space>
                          <Progress
                            percent={Math.round(
                              ((requirement.tasks ?? []).filter((t) => t.status === 'done').length /
                                Math.max((requirement.tasks ?? []).length, 1)) *
                                100
                            )}
                            size="small"
                            strokeColor="#1677ff"
                          />
                        </Space>
                      </div>
                    )}
                    <Table
                      rowKey="id"
                      columns={taskColumns}
                      dataSource={requirement.tasks ?? []}
                      pagination={false}
                      scroll={{ x: 760 }}
                    />
                  </Card>
                </Space>
              )
            },
            {
              key: 'reports',
              label: '验收报告',
              children: (
                <ReportsTimeline requirementId={requirement.id} isAdmin={isAdmin} />
              )
            }
          ]}
        />

        <Card title="需求信息">
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="需求 ID">
              <Typography.Text copyable code>
                {requirement.id}
              </Typography.Text>
            </Descriptions.Item>
            <Descriptions.Item label="标题">{requirement.title}</Descriptions.Item>
            <Descriptions.Item label="优先级">
              <PriorityTag priority={requirement.priority} />
            </Descriptions.Item>
            <Descriptions.Item label="状态">
              <StatusTag status={requirement.status} />
            </Descriptions.Item>
            <Descriptions.Item label="提交者">{requirement.requester}</Descriptions.Item>
            <Descriptions.Item label="业务部门">{requirement.department}</Descriptions.Item>
            <Descriptions.Item label="负责人">{requirement.assignee || '未分配'}</Descriptions.Item>
            <Descriptions.Item label="截止时间">{formatDate(requirement.dueDate)}</Descriptions.Item>
            <Descriptions.Item label="附件">
              {requirement.attachment ? (
                <a href={requirement.attachment} target="_blank" rel="noreferrer">
                  {requirement.attachment}
                </a>
              ) : (
                '无'
              )}
            </Descriptions.Item>
            <Descriptions.Item label="拒绝原因">{requirement.rejectReason || '无'}</Descriptions.Item>
            <Descriptions.Item label="创建时间">{formatDateTime(requirement.createdAt)}</Descriptions.Item>
            <Descriptions.Item label="更新时间">{formatDateTime(requirement.updatedAt)}</Descriptions.Item>
          </Descriptions>
        </Card>
      </div>

      <Modal
        title={assignmentMode === 'approve' ? '通过并分配需求' : '分配开发 Agent'}
        open={assignmentOpen}
        okText="确认"
        cancelText="取消"
        confirmLoading={actionLoading}
        onOk={() => assignmentForm.submit()}
        onCancel={() => setAssignmentOpen(false)}
      >
        <Form form={assignmentForm} layout="vertical" requiredMark={false} onFinish={handleAssignment}>
          <Form.Item
            label="开发负责人"
            name="assignee"
            rules={[{ required: true, message: '请选择开发负责人' }]}
          >
            <Select
              showSearch
              placeholder="选择开发 Agent"
              options={agentOptions.map((agent) => ({ label: agent, value: agent }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="拒绝需求"
        open={rejectOpen}
        okText="确认拒绝"
        cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={actionLoading}
        onOk={() => rejectForm.submit()}
        onCancel={() => setRejectOpen(false)}
      >
        <Form form={rejectForm} layout="vertical" requiredMark={false} onFinish={handleReject}>
          <Form.Item
            label="拒绝原因"
            name="rejectReason"
            rules={[
              { required: true, message: '请输入拒绝原因' },
              { min: 2, message: '拒绝原因至少 2 个字符' }
            ]}
          >
            <TextArea rows={4} placeholder="说明需要补充或调整的内容" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="编辑需求"
        open={editOpen}
        width={760}
        okText="保存"
        cancelText="取消"
        confirmLoading={actionLoading}
        onOk={() => editForm.submit()}
        onCancel={() => setEditOpen(false)}
      >
        <Form form={editForm} layout="vertical" requiredMark={false} onFinish={handleEdit}>
          <Form.Item
            label="需求标题"
            name="title"
            rules={[
              { required: true, message: '请输入需求标题' },
              { min: 2, max: 120, message: '标题长度需为 2-120 个字符' }
            ]}
          >
            <Input showCount maxLength={120} />
          </Form.Item>

          <Form.Item
            label="需求描述"
            name="description"
            rules={[
              { required: true, message: '请输入需求描述' },
              { min: 5, message: '描述至少 5 个字符' }
            ]}
          >
            <TextArea rows={7} showCount />
          </Form.Item>

          <Form.Item
            label="优先级"
            name="priority"
            rules={[{ required: true, message: '请选择优先级' }]}
          >
            <Select
              options={(Object.keys(priorityLabels) as RequirementPriority[]).map((priority) => ({
                label: priorityLabels[priority],
                value: priority
              }))}
            />
          </Form.Item>

          <Form.Item
            label="业务部门"
            name="department"
            rules={[{ required: true, message: '请选择业务部门' }]}
          >
            <Select
              showSearch
              options={departmentOptions.map((department) => ({
                label: department,
                value: department
              }))}
            />
          </Form.Item>

          <Form.Item label="开发负责人" name="assignee">
            <Select
              allowClear
              showSearch
              options={agentOptions.map((agent) => ({ label: agent, value: agent }))}
            />
          </Form.Item>

          <Form.Item label="期望截止时间" name="dueDate">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item label="附件链接" name="attachment" rules={[{ type: 'url', message: '请输入有效 URL' }]}>
            <Input placeholder="https://example.com/spec.pdf" />
          </Form.Item>
        </Form>
      </Modal>

      {/** 创建任务弹窗 */}
      <Modal
        title="创建任务"
        open={createTaskOpen}
        onCancel={() => {
          setCreateTaskOpen(false);
          createTaskForm.resetFields();
        }}
        onOk={() => void handleCreateTask()}
        confirmLoading={createTaskLoading}
        okText="创建"
        cancelText="取消"
      >
        <Form form={createTaskForm} layout="vertical">
          <Form.Item
            label="任务标题"
            name="title"
            rules={[{ required: true, message: '请输入任务标题' }]}
          >
            <Input placeholder="简要描述任务" />
          </Form.Item>
          <Form.Item label="任务描述" name="description">
            <Input.TextArea rows={4} placeholder="详细描述任务内容（可选）" />
          </Form.Item>
          <Form.Item
            label="开发 Agent"
            name="agentType"
            rules={[{ required: true, message: '请选择开发 Agent' }]}
          >
            <Select
              showSearch
              options={agentOptions.map((agent) => ({ label: agent, value: agent }))}
              placeholder="选择负责的 Agent"
            />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
