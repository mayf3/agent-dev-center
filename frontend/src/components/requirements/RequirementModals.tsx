/**
 * 需求详情页所有 Modal 弹窗
 * 从 RequirementDetailPage 拆出 (代码结构合规)
 */
import { App as AntApp, Button, DatePicker, Form, Input, Modal, Select, Space, Card, Tag, Typography } from 'antd';
import dayjs from 'dayjs';
import type { Dayjs } from 'dayjs';
import { useCallback, useState } from 'react';
import { api } from '../../api/client';
import type { Requirement, RequirementPriority } from '../../api/types';
import { agentOptions, departmentOptions, priorityLabels } from '../../constants/options';
import { getErrorMessage } from './utils';

const { TextArea } = Input;

interface AssignmentValues { assignee: string }
interface RejectValues { rejectReason: string }
interface EditValues {
  title: string;
  description: string;
  priority: RequirementPriority;
  department: string;
  assignee?: string;
  dueDate?: Dayjs;
  attachment?: string;
}
interface CreateTaskValues { title: string; description?: string; agentType: string }

interface RequirementModalsProps {
  requirement: Requirement;
  onUpdate: (req: Requirement) => void;
}

export function RequirementModals({ requirement, onUpdate }: RequirementModalsProps) {
  const { message } = AntApp.useApp();
  const [actionLoading, setActionLoading] = useState(false);
  const [assignmentOpen, setAssignmentOpen] = useState(false);
  const [assignmentMode, setAssignmentMode] = useState<'approve' | 'assign'>('assign');
  const [rejectOpen, setRejectOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [createTaskOpen, setCreateTaskOpen] = useState(false);
  const [createTaskLoading, setCreateTaskLoading] = useState(false);
  const [decomposePreview, setDecomposePreview] = useState<Array<{ title: string; description: string; agentType: string }> | null>(null);
  const [decomposeModalOpen, setDecomposeModalOpen] = useState(false);
  const [decomposeLoading, setDecomposeLoading] = useState(false);

  const [assignmentForm] = Form.useForm<AssignmentValues>();
  const [rejectForm] = Form.useForm<RejectValues>();
  const [editForm] = Form.useForm<EditValues>();
  const [createTaskForm] = Form.useForm<CreateTaskValues>();

  const openAssignment = useCallback((mode: 'approve' | 'assign') => {
    setAssignmentMode(mode);
    assignmentForm.setFieldsValue({ assignee: requirement.assignee ?? undefined });
    setAssignmentOpen(true);
  }, [requirement.assignee, assignmentForm]);

  const handleAssignment = useCallback(async (values: AssignmentValues) => {
    setActionLoading(true);
    try {
      const shouldApprove = assignmentMode === 'approve' || ['pending', 'clarifying', 'rejected', 'approved'].includes(requirement.status);
      const { data } = await api.patch<Requirement>(`/requirements/${requirement.id}`, {
        assignee: values.assignee,
        status: shouldApprove ? 'approved' : undefined
      });
      onUpdate(data);
      setAssignmentOpen(false);
      message.success(assignmentMode === 'approve' ? '需求已通过并分配' : '开发负责人已更新');
    } catch (error) {
      message.error(getErrorMessage(error, '分配失败'));
    } finally {
      setActionLoading(false);
    }
  }, [requirement, assignmentMode, message, onUpdate]);

  const handleReject = useCallback(async (values: RejectValues) => {
    setActionLoading(true);
    try {
      const { data } = await api.patch<Requirement>(`/requirements/${requirement.id}`, {
        status: 'rejected',
        rejectReason: values.rejectReason.trim()
      });
      onUpdate(data);
      setRejectOpen(false);
      rejectForm.resetFields();
      message.success('需求已拒绝');
    } catch (error) {
      message.error(getErrorMessage(error, '拒绝失败'));
    } finally {
      setActionLoading(false);
    }
  }, [requirement, message, onUpdate, rejectForm]);

  const openEdit = useCallback(() => {
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
  }, [requirement, editForm]);

  const handleEdit = useCallback(async (values: EditValues) => {
    setActionLoading(true);
    try {
      const { data } = await api.put<Requirement>(`/requirements/${requirement.id}`, {
        title: values.title.trim(),
        description: values.description.trim(),
        priority: values.priority,
        department: values.department,
        assignee: values.assignee || undefined,
        dueDate: values.dueDate?.toISOString(),
        attachment: values.attachment?.trim() || undefined
      });
      onUpdate(data);
      setEditOpen(false);
      message.success('需求已更新');
    } catch (error) {
      message.error(getErrorMessage(error, '需求更新失败'));
    } finally {
      setActionLoading(false);
    }
  }, [requirement, message, onUpdate]);

  const handleCreateTask = useCallback(async () => {
    setCreateTaskLoading(true);
    try {
      const values = await createTaskForm.validateFields();
      await api.post('/tasks', {
        requirementId: requirement.id,
        title: values.title,
        description: values.description || '',
        agentType: values.agentType,
      });
      message.success('任务创建成功');
      setCreateTaskOpen(false);
      createTaskForm.resetFields();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      message.error(getErrorMessage(err, '任务创建失败'));
    } finally {
      setCreateTaskLoading(false);
    }
  }, [requirement.id, message, createTaskForm]);

  const agentSelectOptions = agentOptions.map(a => ({ label: a, value: a }));

  return (
    <>
      {/* Assignment Modal */}
      <Modal
        title={assignmentMode === 'approve' ? '通过并分配需求' : '分配开发 Agent'}
        open={assignmentOpen}
        okText="确认" cancelText="取消"
        confirmLoading={actionLoading}
        onOk={() => assignmentForm.submit()}
        onCancel={() => setAssignmentOpen(false)}
      >
        <Form form={assignmentForm} layout="vertical" requiredMark={false} onFinish={handleAssignment}>
          <Form.Item label="开发负责人" name="assignee" rules={[{ required: true, message: '请选择开发负责人' }]}>
            <Select showSearch placeholder="选择开发 Agent" options={agentSelectOptions} />
          </Form.Item>
        </Form>
      </Modal>

      {/* Reject Modal */}
      <Modal
        title="拒绝需求"
        open={rejectOpen}
        okText="确认拒绝" cancelText="取消"
        okButtonProps={{ danger: true }}
        confirmLoading={actionLoading}
        onOk={() => rejectForm.submit()}
        onCancel={() => setRejectOpen(false)}
      >
        <Form form={rejectForm} layout="vertical" requiredMark={false} onFinish={handleReject}>
          <Form.Item label="拒绝原因" name="rejectReason"
            rules={[{ required: true, message: '请输入拒绝原因' }, { min: 2, message: '至少 2 个字符' }]}>
            <TextArea rows={4} placeholder="说明需要补充或调整的内容" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Edit Modal */}
      <Modal
        title="编辑需求"
        open={editOpen} width={760}
        okText="保存" cancelText="取消"
        confirmLoading={actionLoading}
        onOk={() => editForm.submit()}
        onCancel={() => setEditOpen(false)}
      >
        <Form form={editForm} layout="vertical" requiredMark={false} onFinish={handleEdit}>
          <Form.Item label="需求标题" name="title" rules={[{ required: true, message: '请输入需求标题' }, { min: 2, max: 120, message: '标题长度需为 2-120 个字符' }]}>
            <Input showCount maxLength={120} />
          </Form.Item>
          <Form.Item label="需求描述" name="description" rules={[{ required: true, message: '请输入需求描述' }, { min: 5, message: '描述至少 5 个字符' }]}>
            <TextArea rows={7} showCount />
          </Form.Item>
          <Form.Item label="优先级" name="priority" rules={[{ required: true, message: '请选择优先级' }]}>
            <Select options={(Object.keys(priorityLabels) as RequirementPriority[]).map(p => ({ label: priorityLabels[p], value: p }))} />
          </Form.Item>
          <Form.Item label="业务部门" name="department" rules={[{ required: true, message: '请选择业务部门' }]}>
            <Select showSearch options={departmentOptions.map(d => ({ label: d, value: d }))} />
          </Form.Item>
          <Form.Item label="开发负责人" name="assignee">
            <Select allowClear showSearch options={agentSelectOptions} />
          </Form.Item>
          <Form.Item label="期望截止时间" name="dueDate">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="附件链接" name="attachment" rules={[{ type: 'url', message: '请输入有效 URL' }]}>
            <Input placeholder="https://example.com/spec.pdf" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Create Task Modal */}
      <Modal
        title="创建任务"
        open={createTaskOpen}
        onCancel={() => { setCreateTaskOpen(false); createTaskForm.resetFields(); }}
        onOk={() => void handleCreateTask()}
        confirmLoading={createTaskLoading}
        okText="创建" cancelText="取消"
      >
        <Form form={createTaskForm} layout="vertical">
          <Form.Item label="任务标题" name="title" rules={[{ required: true, message: '请输入任务标题' }]}>
            <Input placeholder="简要描述任务" />
          </Form.Item>
          <Form.Item label="任务描述" name="description">
            <Input.TextArea rows={4} placeholder="详细描述任务内容（可选）" />
          </Form.Item>
          <Form.Item label="开发 Agent" name="agentType" rules={[{ required: true, message: '请选择开发 Agent' }]}>
            <Select showSearch options={agentSelectOptions} placeholder="选择负责的 Agent" />
          </Form.Item>
        </Form>
      </Modal>

      {/* Decompose Modal */}
      <Modal
        title="自动拆解预览"
        open={decomposeModalOpen}
        onCancel={() => { setDecomposeModalOpen(false); setDecomposePreview(null); }}
        onOk={async () => {
          setDecomposeLoading(true);
          try {
            await api.post(`/api/requirements/${requirement.id}/decompose`, { confirm: true });
            message.success('拆解完成，子任务已创建');
            setDecomposeModalOpen(false);
            setDecomposePreview(null);
            const res = await api.get(`/api/requirements/${requirement.id}`);
            onUpdate(res.data);
          } catch (err: any) {
            message.error(err?.response?.data?.message || '拆解失败');
          } finally {
            setDecomposeLoading(false);
          }
        }}
        confirmLoading={decomposeLoading}
        okText="确认创建" cancelText="取消" width={700}
      >
        {decomposePreview && (
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Typography.Text type="secondary">
              系统根据需求描述自动拆解为 {decomposePreview.length} 个子任务，请确认后创建：
            </Typography.Text>
            {decomposePreview.map((task, idx) => (
              <Card key={idx} size="small" style={{ borderLeft: '3px solid #1677ff' }}>
                <Space direction="vertical" size={4} style={{ width: '100%' }}>
                  <Space>
                    <Tag color="blue">#{idx + 1}</Tag>
                    <Typography.Text strong>{task.title}</Typography.Text>
                    <Tag>{task.agentType}</Tag>
                  </Space>
                  <Typography.Paragraph ellipsis={{ rows: 2, expandable: true, symbol: '展开' }} style={{ marginBottom: 0, color: '#666' }}>
                    {task.description.slice(0, 300)}
                  </Typography.Paragraph>
                </Space>
              </Card>
            ))}
          </Space>
        )}
      </Modal>
    </>
  );
}

// Expose modal openers for parent
export interface ModalHandles {
  openAssignment: (mode: 'approve' | 'assign') => void;
  openReject: () => void;
  openEdit: () => void;
  openCreateTask: () => void;
  openDecompose: () => void;
}
