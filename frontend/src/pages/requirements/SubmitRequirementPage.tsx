import { SaveOutlined } from '@ant-design/icons';
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Select,
  Space,
  Typography
} from 'antd';
import type { Dayjs } from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { Requirement, RequirementPriority } from '../../api/types';
import { agentOptions, departmentOptions, priorityLabels } from '../../constants/options';

const { TextArea } = Input;

interface RequirementFormValues {
  title: string;
  description: string;
  priority: RequirementPriority;
  department: string;
  assignee?: string;
  dueDate?: Dayjs;
  attachment?: string;
}

function toPayload(values: RequirementFormValues) {
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

function errorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? fallback;
  }

  return fallback;
}

export function SubmitRequirementPage() {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const [form] = Form.useForm<RequirementFormValues>();
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (values: RequirementFormValues) => {
    setSubmitting(true);
    try {
      const { data } = await api.post<Requirement>('/requirements', toPayload(values));
      message.success('需求已提交');
      navigate(`/requirements/${data.id}`, { replace: true });
    } catch (error) {
      message.error(errorMessage(error, '需求提交失败'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Space direction="vertical" size="large" className="page-stack">
      <div className="page-heading">
        <div>
          <Typography.Title level={3}>提交需求</Typography.Title>
          <Typography.Text type="secondary">描述清楚业务目标、交付边界和期望时间</Typography.Text>
        </div>
      </div>

      <Card className="form-card">
        <Form
          form={form}
          layout="vertical"
          requiredMark={false}
          initialValues={{ priority: 'P2', department: departmentOptions[0] }}
          onFinish={handleSubmit}
        >
          <Form.Item
            label="需求标题"
            name="title"
            rules={[
              { required: true, message: '请输入需求标题' },
              { min: 2, max: 120, message: '标题长度需为 2-120 个字符' }
            ]}
          >
            <Input showCount maxLength={120} placeholder="例如：搭建需求评审自动化流程" />
          </Form.Item>

          <Form.Item
            label="需求描述"
            name="description"
            rules={[
              { required: true, message: '请输入需求描述' },
              { min: 5, message: '描述至少 5 个字符' }
            ]}
          >
            <TextArea
              rows={8}
              showCount
              placeholder="支持 Markdown。请写明背景、目标、验收标准和约束。"
            />
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
              placeholder="可选，CTO 后续也可分配"
              options={agentOptions.map((agent) => ({ label: agent, value: agent }))}
            />
          </Form.Item>

          <Form.Item label="期望截止时间" name="dueDate">
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item label="附件链接" name="attachment" rules={[{ type: 'url', message: '请输入有效 URL' }]}>
            <Input placeholder="https://example.com/spec.pdf" />
          </Form.Item>

          <Form.Item>
            <Space>
              <Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={submitting}>
                提交需求
              </Button>
              <Button onClick={() => navigate('/requirements')}>取消</Button>
            </Space>
          </Form.Item>
        </Form>
      </Card>
    </Space>
  );
}
