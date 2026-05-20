import {
  DeleteOutlined,
  DownloadOutlined,
  FileExcelOutlined,
  FileImageOutlined,
  FileOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileWordOutlined,
  FileZipOutlined,
  InboxOutlined
} from '@ant-design/icons';
import {
  App as AntApp,
  Button,
  Popconfirm,
  Progress,
  Space,
  Table,
  Tag,
  Typography,
  Upload
} from 'antd';
import type { UploadProps } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/client';
import type { Attachment } from '../api/types';

const { Dragger } = Upload;

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const MAX_FILE_COUNT = 10;

const ACCEPTED_FILE_TYPES = [
  'image/*',
  '.pdf',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.csv',
  '.zip',
  '.txt',
  '.md',
  '.json',
  '.log',
  '.xml',
  '.ppt',
  '.pptx'
].join(',');

const ALLOWED_EXTENSIONS = [
  '.bmp',
  '.csv',
  '.doc',
  '.docx',
  '.gif',
  '.jpeg',
  '.jpg',
  '.json',
  '.log',
  '.md',
  '.pdf',
  '.png',
  '.ppt',
  '.pptx',
  '.svg',
  '.txt',
  '.webp',
  '.xls',
  '.xlsx',
  '.xml',
  '.zip'
];

const ALLOWED_MIME_TYPES = new Set([
  'application/json',
  'application/msword',
  'application/pdf',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/x-zip-compressed',
  'application/xml',
  'application/zip',
  'text/csv',
  'text/markdown',
  'text/plain',
  'text/xml'
]);

interface RequirementAttachmentsProps {
  requirementId: string;
  isAdmin?: boolean;
}

interface AttachmentListResponse {
  data: Attachment[];
}

interface UploadProgressItem {
  uid: string;
  name: string;
  size: number;
  percent: number;
  status: 'uploading' | 'done' | 'error';
  error?: string;
}

type UploadRequestOption = Parameters<NonNullable<UploadProps['customRequest']>>[0];

function getErrorMessage(error: unknown, fallback: string) {
  if (typeof error === 'object' && error && 'response' in error) {
    const response = (error as { response?: { data?: { message?: string } } }).response;
    return response?.data?.message ?? fallback;
  }

  return fallback;
}

function formatFileSize(size: number) {
  if (size < 1024) {
    return `${size} B`;
  }

  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }

  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function isAllowedFile(file: File) {
  const lowerName = file.name.toLowerCase();
  const lowerType = file.type.toLowerCase();
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some((extension) =>
    lowerName.endsWith(extension)
  );
  const hasAllowedMimeType =
    lowerType.startsWith('image/') ||
    lowerType.startsWith('text/') ||
    ALLOWED_MIME_TYPES.has(lowerType);

  return hasAllowedExtension || hasAllowedMimeType;
}

function fileIcon(attachment: Attachment) {
  const lowerName = attachment.originalName.toLowerCase();
  const lowerType = attachment.mimeType.toLowerCase();
  const style = { fontSize: 20 };

  if (lowerType.startsWith('image/')) {
    return <FileImageOutlined style={{ ...style, color: '#1677ff' }} />;
  }

  if (lowerType.includes('pdf') || lowerName.endsWith('.pdf')) {
    return <FilePdfOutlined style={{ ...style, color: '#ff4d4f' }} />;
  }

  if (lowerType.includes('word') || /\.(doc|docx)$/.test(lowerName)) {
    return <FileWordOutlined style={{ ...style, color: '#1677ff' }} />;
  }

  if (
    lowerType.includes('excel') ||
    lowerType.includes('spreadsheet') ||
    /\.(csv|xls|xlsx)$/.test(lowerName)
  ) {
    return <FileExcelOutlined style={{ ...style, color: '#52c41a' }} />;
  }

  if (lowerType.includes('zip') || lowerName.endsWith('.zip')) {
    return <FileZipOutlined style={{ ...style, color: '#faad14' }} />;
  }

  if (lowerType.startsWith('text/') || /\.(txt|md|json|log|xml)$/.test(lowerName)) {
    return <FileTextOutlined style={{ ...style, color: '#13c2c2' }} />;
  }

  return <FileOutlined style={{ ...style, color: '#8c8c8c' }} />;
}

function fileTypeTag(attachment: Attachment) {
  const lowerName = attachment.originalName.toLowerCase();
  const lowerType = attachment.mimeType.toLowerCase();

  if (lowerType.startsWith('image/')) {
    return <Tag color="blue">图片</Tag>;
  }

  if (lowerType.includes('pdf') || lowerName.endsWith('.pdf')) {
    return <Tag color="red">PDF</Tag>;
  }

  if (lowerType.includes('word') || /\.(doc|docx)$/.test(lowerName)) {
    return <Tag color="geekblue">文档</Tag>;
  }

  if (
    lowerType.includes('excel') ||
    lowerType.includes('spreadsheet') ||
    /\.(csv|xls|xlsx)$/.test(lowerName)
  ) {
    return <Tag color="green">表格</Tag>;
  }

  if (lowerType.includes('zip') || lowerName.endsWith('.zip')) {
    return <Tag color="gold">压缩包</Tag>;
  }

  if (lowerType.startsWith('text/') || /\.(txt|md|json|log|xml)$/.test(lowerName)) {
    return <Tag color="cyan">文本</Tag>;
  }

  return <Tag>文件</Tag>;
}

function parseAttachments(response: AttachmentListResponse | Attachment[]) {
  return Array.isArray(response) ? response : response.data ?? [];
}

export function RequirementAttachments({ requirementId, isAdmin = false }: RequirementAttachmentsProps) {
  const { message } = AntApp.useApp();
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploadItems, setUploadItems] = useState<UploadProgressItem[]>([]);
  const [downloadingFilename, setDownloadingFilename] = useState<string | null>(null);
  const [deletingFilename, setDeletingFilename] = useState<string | null>(null);
  const maxWarningAtRef = useRef(0);

  const uploadingCount = useMemo(
    () => uploadItems.filter((item) => item.status === 'uploading').length,
    [uploadItems]
  );

  const loadAttachments = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await api.get<AttachmentListResponse | Attachment[]>(
        `/requirements/${requirementId}/attachments`
      );
      setAttachments(parseAttachments(data));
    } catch (error) {
      message.error(getErrorMessage(error, '附件列表加载失败'));
    } finally {
      setLoading(false);
    }
  }, [requirementId, message]);

  useEffect(() => {
    void loadAttachments();
  }, [loadAttachments]);

  const updateUploadItem = useCallback((uid: string, values: Partial<UploadProgressItem>) => {
    setUploadItems((current) =>
      current.map((item) => (item.uid === uid ? { ...item, ...values } : item))
    );
  }, []);

  const removeUploadItemLater = useCallback((uid: string) => {
    window.setTimeout(() => {
      setUploadItems((current) => current.filter((item) => item.uid !== uid));
    }, 1600);
  }, []);

  const warnFileCountLimit = useCallback(() => {
    const now = Date.now();
    if (now - maxWarningAtRef.current > 800) {
      message.warning(`最多上传 ${MAX_FILE_COUNT} 个附件`);
      maxWarningAtRef.current = now;
    }
  }, [message]);

  const handleUpload = useCallback(
    async (options: UploadRequestOption) => {
      const file = options.file as File & { uid?: string };
      const uid = file.uid ?? `${file.name}-${file.lastModified}-${Date.now()}`;

      setUploadItems((current) => [
        {
          uid,
          name: file.name,
          size: file.size,
          percent: 0,
          status: 'uploading'
        },
        ...current.filter((item) => item.uid !== uid)
      ]);

      const formData = new FormData();
      formData.append('files', file);

      try {
        const { data } = await api.post<AttachmentListResponse>(
          `/requirements/${requirementId}/attachments`,
          formData,
          {
            headers: { 'Content-Type': 'multipart/form-data' },
            onUploadProgress: (event) => {
              if (!event.total) {
                return;
              }

              const percent = Math.round((event.loaded * 100) / event.total);
              updateUploadItem(uid, { percent: Math.min(percent, 99) });
            }
          }
        );

        updateUploadItem(uid, { percent: 100, status: 'done' });
        options.onSuccess?.(data);
        message.success(`${file.name} 上传成功`);
        await loadAttachments();
        removeUploadItemLater(uid);
      } catch (error) {
        const errorMessage = getErrorMessage(error, `${file.name} 上传失败`);
        updateUploadItem(uid, { percent: 100, status: 'error', error: errorMessage });
        options.onError?.(error instanceof Error ? error : new Error(errorMessage));
        message.error(errorMessage);
      }
    },
    [loadAttachments, message, removeUploadItemLater, requirementId, updateUploadItem]
  );

  const handleDownload = useCallback(
    async (attachment: Attachment) => {
      setDownloadingFilename(attachment.filename);
      try {
        const { data } = await api.get<Blob>(
          `/requirements/${requirementId}/attachments/${encodeURIComponent(attachment.filename)}`,
          { responseType: 'blob' }
        );
        const blobUrl = window.URL.createObjectURL(data);
        const link = document.createElement('a');
        link.href = blobUrl;
        link.download = attachment.originalName || attachment.filename;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.URL.revokeObjectURL(blobUrl);
      } catch (error) {
        message.error(getErrorMessage(error, '附件下载失败'));
      } finally {
        setDownloadingFilename(null);
      }
    },
    [requirementId, message]
  );

  const handleDelete = useCallback(
    async (attachment: Attachment) => {
      setDeletingFilename(attachment.filename);
      try {
        await api.delete(
          `/requirements/${requirementId}/attachments/${encodeURIComponent(attachment.filename)}`
        );
        message.success('附件已归档');
        await loadAttachments();
      } catch (error) {
        message.error(getErrorMessage(error, '附件归档失败'));
      } finally {
        setDeletingFilename(null);
      }
    },
    [loadAttachments, message, requirementId]
  );

  const uploadProps: UploadProps = {
    accept: ACCEPTED_FILE_TYPES,
    multiple: true,
    maxCount: MAX_FILE_COUNT,
    showUploadList: false,
    beforeUpload: (file, fileList) => {
      const selectedIndex = fileList.findIndex((item) => item.uid === file.uid);

      if (attachments.length + uploadingCount + selectedIndex >= MAX_FILE_COUNT) {
        warnFileCountLimit();
        return Upload.LIST_IGNORE;
      }

      if (file.size > MAX_FILE_SIZE) {
        message.error(`${file.name} 超过 20MB，无法上传`);
        return Upload.LIST_IGNORE;
      }

      if (!isAllowedFile(file)) {
        message.error(`${file.name} 文件类型不支持`);
        return Upload.LIST_IGNORE;
      }

      return true;
    },
    customRequest: (options) => {
      void handleUpload(options);
    }
  };

  const columns: ColumnsType<Attachment> = [
    {
      title: '文件',
      dataIndex: 'originalName',
      key: 'originalName',
      render: (_value, attachment) => (
        <Space size={10}>
          {fileIcon(attachment)}
          <Space direction="vertical" size={0}>
            <Typography.Text
              strong
              ellipsis={{ tooltip: attachment.originalName }}
              style={{ maxWidth: 320 }}
            >
              {attachment.originalName}
            </Typography.Text>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {attachment.mimeType || '未知类型'}
            </Typography.Text>
          </Space>
        </Space>
      )
    },
    {
      title: '类型',
      dataIndex: 'mimeType',
      key: 'mimeType',
      width: 100,
      responsive: ['md'],
      render: (_value, attachment) => fileTypeTag(attachment)
    },
    {
      title: '大小',
      dataIndex: 'size',
      key: 'size',
      width: 120,
      render: (size: number) => formatFileSize(size)
    },
    {
      title: '上传时间',
      dataIndex: 'uploadedAt',
      key: 'uploadedAt',
      width: 170,
      responsive: ['sm'],
      render: (value?: string) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '未知')
    },
    {
      title: '操作',
      key: 'action',
      width: isAdmin ? 180 : 100,
      fixed: 'right',
      render: (_value, attachment) => (
        <Space>
          <Button
            size="small"
            icon={<DownloadOutlined />}
            loading={downloadingFilename === attachment.filename}
            onClick={() => void handleDownload(attachment)}
          >
            下载
          </Button>
          {isAdmin ? (
            <Popconfirm
              title="归档附件"
              description={`确认归档「${attachment.originalName}」吗？文件将移至归档目录，可以恢复。`}
              okText="确认归档"
              cancelText="取消"
              okButtonProps={{ danger: true }}
              onConfirm={() => handleDelete(attachment)}
            >
              <Button
                danger
                size="small"
                icon={<DeleteOutlined />}
                loading={deletingFilename === attachment.filename}
              >
                归档
              </Button>
            </Popconfirm>
          ) : null}
        </Space>
      )
    }
  ];

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Dragger {...uploadProps} disabled={attachments.length + uploadingCount >= MAX_FILE_COUNT}>
        <p className="ant-upload-drag-icon">
          <InboxOutlined />
        </p>
        <p className="ant-upload-text">拖拽文件到此处，或点击上传</p>
        <p className="ant-upload-hint">
          单个文件不超过 20MB，最多 10 个，支持图片、PDF、文档、表格、压缩包和文本文件
        </p>
      </Dragger>

      {uploadItems.length > 0 ? (
        <Space direction="vertical" size={8} style={{ width: '100%' }}>
          <Typography.Text strong>上传进度</Typography.Text>
          {uploadItems.map((item) => (
            <div key={item.uid}>
              <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
                <Typography.Text ellipsis={{ tooltip: item.name }} style={{ maxWidth: 360 }}>
                  {item.name}
                </Typography.Text>
                <Space size={8}>
                  <Typography.Text type="secondary">{formatFileSize(item.size)}</Typography.Text>
                  <Tag color={item.status === 'error' ? 'red' : item.status === 'done' ? 'green' : 'blue'}>
                    {item.status === 'error' ? '失败' : item.status === 'done' ? '完成' : '上传中'}
                  </Tag>
                </Space>
              </Space>
              <Progress
                percent={item.percent}
                size="small"
                status={
                  item.status === 'error'
                    ? 'exception'
                    : item.status === 'done'
                      ? 'success'
                      : 'active'
                }
                strokeColor="#1677ff"
              />
              {item.error ? (
                <Typography.Text type="danger" style={{ fontSize: 12 }}>
                  {item.error}
                </Typography.Text>
              ) : null}
            </div>
          ))}
        </Space>
      ) : null}

      <Table
        rowKey="filename"
        columns={columns}
        dataSource={attachments}
        loading={loading}
        pagination={false}
        scroll={{ x: 760 }}
        title={() => (
          <Space>
            <Typography.Text strong>附件列表</Typography.Text>
            <Tag color="blue">{attachments.length}/10</Tag>
          </Space>
        )}
        locale={{ emptyText: '暂无附件' }}
      />
    </Space>
  );
}
