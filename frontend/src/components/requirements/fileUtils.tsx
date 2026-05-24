/**
 * 文件附件工具函数和常量
 * 从 RequirementAttachments 拆出 (代码结构合规)
 */
import type { ReactNode } from 'react';
import {
  FileExcelOutlined, FileImageOutlined, FileOutlined,
  FilePdfOutlined, FileTextOutlined, FileWordOutlined,
  FileZipOutlined
} from '@ant-design/icons';
import type { Attachment } from '../../api/types';

export const MAX_FILE_SIZE = 20 * 1024 * 1024;
export const MAX_FILE_COUNT = 10;

export const ACCEPTED_FILE_TYPES = [
  'image/*', '.pdf', '.doc', '.docx', '.xls', '.xlsx',
  '.csv', '.zip', '.txt', '.md', '.json', '.log', '.xml', '.ppt', '.pptx'
].join(',');

export const ALLOWED_EXTENSIONS = [
  '.bmp', '.csv', '.doc', '.docx', '.gif', '.jpeg', '.jpg', '.json',
  '.log', '.md', '.pdf', '.png', '.ppt', '.pptx', '.svg', '.txt',
  '.webp', '.xls', '.xlsx', '.xml', '.zip'
];

export const ALLOWED_MIME_TYPES = new Set([
  'application/json', 'application/msword', 'application/pdf',
  'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/x-zip-compressed', 'application/xml', 'application/zip',
  'text/csv', 'text/markdown', 'text/plain', 'text/xml'
]);

export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function isAllowedFile(file: File): boolean {
  const lowerName = file.name.toLowerCase();
  const lowerType = file.type.toLowerCase();
  const hasAllowedExtension = ALLOWED_EXTENSIONS.some(ext => lowerName.endsWith(ext));
  const hasAllowedMimeType = lowerType.startsWith('image/') || lowerType.startsWith('text/') || ALLOWED_MIME_TYPES.has(lowerType);
  return hasAllowedExtension || hasAllowedMimeType;
}

export function fileIcon(attachment: Attachment): ReactNode {
  const lowerName = attachment.originalName.toLowerCase();
  const lowerType = attachment.mimeType.toLowerCase();
  const style = { fontSize: 20 };

  if (lowerType.startsWith('image/')) return <FileImageOutlined style={{ ...style, color: '#1677ff' }} />;
  if (lowerType.includes('pdf') || lowerName.endsWith('.pdf')) return <FilePdfOutlined style={{ ...style, color: '#ff4d4f' }} />;
  if (lowerType.includes('word') || /\.(doc|docx)$/.test(lowerName)) return <FileWordOutlined style={{ ...style, color: '#1677ff' }} />;
  if (lowerType.includes('excel') || lowerType.includes('spreadsheet') || /\.(csv|xls|xlsx)$/.test(lowerName)) return <FileExcelOutlined style={{ ...style, color: '#52c41a' }} />;
  if (lowerType.includes('zip') || lowerName.endsWith('.zip')) return <FileZipOutlined style={{ ...style, color: '#faad14' }} />;
  if (lowerType.startsWith('text/') || /\.(md|txt|log|csv|json|xml)$/.test(lowerName)) return <FileTextOutlined style={{ ...style, color: '#8c8c8c' }} />;
  return <FileOutlined style={style} />;
}
