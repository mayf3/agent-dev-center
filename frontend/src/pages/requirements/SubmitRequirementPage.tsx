import { PaperClipOutlined, SaveOutlined } from '@ant-design/icons';
import {
  App as AntApp,
  Button,
  Card,
  DatePicker,
  Form,
  Input,
  Select,
  Space,
  Typography,
  Upload
} from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import type { Dayjs } from 'dayjs';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../api/client';
import type { Requirement, RequirementPriority } from '../../api/types';
import {
  ACCEPTED_FILE_TYPES,
  MAX_FILE_COUNT,
  MAX_FILE_SIZE,
  formatFileSize,
  isAllowedFile
} from '../../components/requirements/fileUtils';
import { agentOptions, departmentOptions, priorityLabels } from '../../constants/options';

const { TextArea } = Input;

interface RequirementFormValues {
  title: string;
  description: string;
  priority: RequirementPriority;
  department: string;
  dueDate?: Dayjs;
  attachment?: string;
}

function toPayload(values: RequirementFormValues) {
  return {
    title: values.title.trim(),
    description: values.description.trim(),
    priority: values.priority,
    department: values.department,
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
  const [attachmentFiles, setAttachmentFiles] = useState<UploadFile[]>([]);

  const beforeAttachmentUpload: UploadProps['beforeUpload'] = (file, fileList) => {
    const incomingIndex = fileList.findIndex((item) => item.uid === file.uid);
    if (attachmentFiles.length + incomingIndex >= MAX_FILE_COUNT) {
      message.warning(`最多上传 ${MAX_FILE_COUNT} 个附件`);
      return Upload.LIST_IGNORE;
    }
    if (file.size > MAX_FILE_SIZE) {
      message.error(`${file.name} 超过 ${formatFileSize(MAX_FILE_SIZE)}，无法上传`);
      return Upload.LIST_IGNORE;
    }
    if (!isAllowedFile(file)) {
      message.error(`${file.name} 文件类型不支持`);
      return Upload.LIST_IGNORE;
    }
    return false;
  };

  const handleAttachmentChange: UploadProps['onChange'] = ({ fileList }) => {
    setAttachmentFiles(fileList.slice(0, MAX_FILE_COUNT));
  };

  const handleSubmit = async (values: RequirementFormValues) => {
    setSubmitting(true);
    try {
      const { data } = await api.post<Requirement>('/requirements', toPayload(values));
      const files = attachmentFiles
        .map((file) => file.originFileObj)
        .filter((file): file is NonNullable<UploadFile['originFileObj']> => Boolean(file));
      let attachmentUploadFailed = false;

      if (files.length > 0) {
        const formData = new FormData();
        files.forEach((file) => formData.append('files', file));
        try {
          await api.post(`/requirements/${data.id}/attachments`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' }
          });
        } catch (uploadError) {
          attachmentUploadFailed = true;
          message.warning(errorMessage(uploadError, '需求已提交，但附件上传失败，可在详情页补传'));
        }
      }

      if (!attachmentUploadFailed) {
        message.success(files.length > 0 ? '需求已提交，附件已上传' : '需求已提交');
      }
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
            <Input
              showCount
              maxLength={120}
              placeholder="用一句话说明业务结果，例如：自动汇总需求评审结论"
            />
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
              placeholder={`建议包含：
1. 背景或当前痛点
2. 期望达成的业务结果
3. 验收标准或成功指标
4. 相关系统、数据范围和限制条件`}
            />
          </Form.Item>

          <Form.Item
            label="优先级"
            name="priority"
            rules={[{ required: true, message: '请选择优先级' }]}
          >
            <Select
              placeholder="选择影响程度和紧急程度"
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
              placeholder="选择提出需求的业务部门"
              options={departmentOptions.map((department) => ({
                label: department,
                value: department
              }))}
            />
          </Form.Item>

          <Form.Item label="期望截止时间" name="dueDate">
            <DatePicker placeholder="选择期望完成日期（可选）" style={{ width: '100%' }} />
          </Form.Item>

          <Form.Item label="附件（支持上传文件或粘贴链接）">
            <Space direction="vertical" size="small" className="requirement-attachment-field">
              <Form.Item name="attachment" noStyle rules={[{ type: 'url', message: '请输入有效 URL' }]}>
                <Input placeholder="粘贴 PRD、原型、数据样例或网盘链接，例如 https://example.com/spec.pdf" />
              </Form.Item>
              <Upload
                accept={ACCEPTED_FILE_TYPES}
                beforeUpload={beforeAttachmentUpload}
                fileList={attachmentFiles}
                multiple
                onChange={handleAttachmentChange}
              >
                <Button icon={<PaperClipOutlined />}>选择文件</Button>
              </Upload>
              <Typography.Text type="secondary">
                支持图片、PDF、Office、压缩包和文本文件，单个文件不超过 {formatFileSize(MAX_FILE_SIZE)}
              </Typography.Text>
            </Space>
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
