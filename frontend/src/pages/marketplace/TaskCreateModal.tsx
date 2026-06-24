/**
 * 创建任务 Modal — 选 Agent → 填描述 → 提交（3步内完成 §3）
 */
import { App as AntApp, Button, Col, DatePicker, Form, Input, Modal, Row, Select } from 'antd';
import { useState } from 'react';
import { createTask } from '../../api/marketplace';
import type { MarketplaceAgent } from '../../api/marketplace-types';

const { TextArea } = Input;

interface TaskCreateModalProps {
  open: boolean;
  agents: MarketplaceAgent[];
  onClose: () => void;
  onSuccess: () => void;
}

export function TaskCreateModal({ open, agents, onClose, onSuccess }: TaskCreateModalProps) {
  const { message } = AntApp.useApp();
  const [loading, setLoading] = useState(false);
  const [form] = Form.useForm();

  const handleOk = async () => {
    try {
      const values = await form.validateFields();
      setLoading(true);
      await createTask({
        ...values,
        deadline: values.deadline ? values.deadline.toISOString() : undefined
      });
      message.success('任务已创建');
      form.resetFields();
      onSuccess();
    } catch (err) {
      if (err && typeof err === 'object' && 'errorFields' in err) return;
      const msg = typeof err === 'object' && err && 'response' in err
        ? (err as { response?: { data?: { message?: string } } }).response?.data?.message ?? '创建失败'
        : '创建失败';
      message.error(msg);
    } finally {
      setLoading(false);
    }
  };

  const handleCancel = () => {
    form.resetFields();
    onClose();
  };

  return (
    <Modal
      title="提交任务"
      open={open}
      onCancel={handleCancel}
      onOk={handleOk}
      confirmLoading={loading}
      width={560}
      destroyOnClose
    >
      <Form form={form} layout="vertical">
        <Form.Item name="agentName" label="选择 Agent" rules={[{ required: true, message: '请选择 Agent' }]}>
          <Select
            placeholder="选择要分配的 Agent"
            showSearch
            optionFilterProp="label"
            options={agents
              .filter((a) => a.status === 'active')
              .map((a) => ({
                label: `${a.displayName} (${a.name})`,
                value: a.name
              }))}
          />
        </Form.Item>
        <Form.Item name="title" label="任务标题" rules={[{ required: true, message: '请输入标题' }]}>
          <Input placeholder="简短描述任务" maxLength={160} showCount />
        </Form.Item>
        <Form.Item name="description" label="任务描述" rules={[{ required: true, message: '请输入描述' }]}>
          <TextArea rows={4} placeholder="详细描述任务需求" />
        </Form.Item>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Item name="priority" label="优先级" initialValue="normal">
              <Select
                options={[
                  { label: '低', value: 'low' },
                  { label: '普通', value: 'normal' },
                  { label: '高', value: 'high' },
                  { label: '紧急', value: 'urgent' }
                ]}
              />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="deadline" label="截止日期">
              <DatePicker showTime style={{ width: '100%' }} />
            </Form.Item>
          </Col>
        </Row>
      </Form>
    </Modal>
  );
}
