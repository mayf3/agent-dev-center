import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { HttpError } from '../utils/http-error.js';

export const marketplaceUploadDir = path.resolve(process.cwd(), 'uploads', 'marketplace');
export const marketplaceUploadUrlPrefix = '/api/marketplace/uploads';
export const marketplaceUploadMaxFileSize = 20 * 1024 * 1024;

const allowedMimeTypesByExtension = {
  '.jpg': ['image/jpeg'],
  '.jpeg': ['image/jpeg'],
  '.png': ['image/png'],
  '.gif': ['image/gif'],
  '.webp': ['image/webp'],
  '.svg': ['image/svg+xml', 'application/xml', 'text/xml'],
  '.pdf': ['application/pdf'],
  '.docx': ['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  '.xlsx': ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  '.txt': ['text/plain'],
  '.md': ['text/markdown', 'text/plain'],
  '.zip': ['application/zip', 'application/x-zip-compressed', 'multipart/x-zip', 'application/octet-stream']
} as const;

const canonicalMimeTypeByExtension: Record<MarketplaceUploadExtension, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.zip': 'application/zip'
};

export type MarketplaceUploadExtension = keyof typeof allowedMimeTypesByExtension;

export const marketplaceUploadImageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'] as const;
export const marketplaceUploadDocumentExtensions = ['.pdf', '.docx', '.xlsx', '.txt', '.md'] as const;
export const marketplaceUploadFileExtensions = Object.keys(allowedMimeTypesByExtension) as MarketplaceUploadExtension[];

function ensureMarketplaceUploadDir() {
  mkdirSync(marketplaceUploadDir, { recursive: true });
}

export function getMarketplaceUploadExtension(filename: string): MarketplaceUploadExtension | null {
  const extension = path.extname(filename).toLowerCase();
  if (extension in allowedMimeTypesByExtension) {
    return extension as MarketplaceUploadExtension;
  }

  return null;
}

export function getMarketplaceUploadMimeType(filename: string): string | null {
  const extension = getMarketplaceUploadExtension(filename);
  return extension ? canonicalMimeTypeByExtension[extension] : null;
}

export function isAllowedMarketplaceUploadFilename(filename: string): boolean {
  const extension = getMarketplaceUploadExtension(filename);
  if (!extension) {
    return false;
  }

  const nameWithoutExtension = filename.slice(0, -extension.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    nameWithoutExtension
  );
}

export function getMarketplaceUploadUrl(filename: string): string {
  return `${marketplaceUploadUrlPrefix}/${encodeURIComponent(filename)}`;
}

export function getMarketplaceUploadPath(filename: string): string {
  return path.join(marketplaceUploadDir, filename);
}

export function getMarketplaceUploadRelativePath(filename: string): string {
  return path.posix.join('uploads', 'marketplace', filename);
}

export function getMarketplaceUploadFilenameFromReference(reference: string): string | null {
  const trimmed = reference.trim();

  if (isAllowedMarketplaceUploadFilename(trimmed)) {
    return trimmed;
  }

  try {
    const parsed = trimmed.startsWith('http://') || trimmed.startsWith('https://')
      ? new URL(trimmed)
      : new URL(trimmed, 'http://localhost');
    const pathname = decodeURIComponent(parsed.pathname);
    const expectedPrefix = `${marketplaceUploadUrlPrefix}/`;

    if (!pathname.startsWith(expectedPrefix)) {
      return null;
    }

    const filename = pathname.slice(expectedPrefix.length);
    return isAllowedMarketplaceUploadFilename(filename) ? filename : null;
  } catch {
    return null;
  }
}

ensureMarketplaceUploadDir();

export const marketplaceUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      ensureMarketplaceUploadDir();
      callback(null, marketplaceUploadDir);
    },
    filename: (_req, file, callback) => {
      const extension = getMarketplaceUploadExtension(file.originalname);
      if (!extension) {
        callback(new Error('不支持的文件类型'), '');
        return;
      }

      callback(null, `${randomUUID()}${extension}`);
    }
  }),
  fileFilter: (_req, file, callback) => {
    const extension = getMarketplaceUploadExtension(file.originalname);
    if (!extension) {
      callback(new Error('不支持的文件类型'));
      return;
    }

    const allowedMimeTypes: readonly string[] = allowedMimeTypesByExtension[extension];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      callback(new Error('文件 MIME 类型与扩展名不匹配'));
      return;
    }

    callback(null, true);
  },
  limits: {
    fileSize: marketplaceUploadMaxFileSize,
    files: 1
  }
});

export const requirementUploadDir = path.resolve(process.cwd(), 'uploads', 'requirements');
export const requirementUploadMaxFileSize = 10 * 1024 * 1024;

export type RequirementUploadExtension = MarketplaceUploadExtension;

export function ensureRequirementUploadDir() {
  mkdirSync(requirementUploadDir, { recursive: true });
}

export function getRequirementUploadExtension(filename: string): RequirementUploadExtension | null {
  const extension = path.extname(filename).toLowerCase();
  if (extension in allowedMimeTypesByExtension) {
    return extension as RequirementUploadExtension;
  }

  return null;
}

export function getRequirementUploadMimeType(filename: string): string | null {
  const extension = getRequirementUploadExtension(filename);
  return extension ? canonicalMimeTypeByExtension[extension] : null;
}

export function isAllowedRequirementUploadFilename(filename: string): boolean {
  const extension = getRequirementUploadExtension(filename);
  if (!extension) {
    return false;
  }

  const nameWithoutExtension = filename.slice(0, -extension.length);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
    nameWithoutExtension
  );
}

export function getRequirementUploadPath(filename: string): string {
  return path.join(requirementUploadDir, filename);
}

export function getRequirementUploadUrl(filename: string): string {
  const segments = filename.split(/[\\/]+/).filter(Boolean).map(encodeURIComponent);
  if (segments.length < 2) {
    return `/api/requirements/attachments/${segments[0] ?? ''}`;
  }

  const [requirementId, attachmentFilename] = segments;
  return `/api/requirements/${requirementId}/attachments/${attachmentFilename}`;
}

ensureRequirementUploadDir();

export const requirementUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      ensureRequirementUploadDir();
      callback(null, requirementUploadDir);
    },
    filename: (_req, file, callback) => {
      const extension = getRequirementUploadExtension(file.originalname);
      if (!extension) {
        callback(new Error('不支持的文件类型'), '');
        return;
      }

      callback(null, `${randomUUID()}${extension}`);
    }
  }),
  fileFilter: (_req, file, callback) => {
    const extension = getRequirementUploadExtension(file.originalname);
    if (!extension) {
      callback(new Error('不支持的文件类型'));
      return;
    }

    const allowedMimeTypes: readonly string[] = allowedMimeTypesByExtension[extension];
    if (!allowedMimeTypes.includes(file.mimetype)) {
      callback(new Error('文件 MIME 类型与扩展名不匹配'));
      return;
    }

    callback(null, true);
  },
  limits: {
    fileSize: requirementUploadMaxFileSize,
    files: 10
  }
});
