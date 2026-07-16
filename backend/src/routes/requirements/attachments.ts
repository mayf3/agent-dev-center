import { createReadStream, mkdirSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import path from 'node:path';
import { requirementIdSchema } from '../../schemas/requirements.js';
import { asyncHandler } from '../../utils/async-handler.js';
import { HttpError } from '../../utils/http-error.js';
import {
  getRequirementUploadMimeType,
  getRequirementUploadPath,
  getRequirementUploadUrl,
  isAllowedRequirementUploadFilename,
  requirementUpload
} from '../../lib/multer.js';
import { archiveFile } from '../../lib/archive.js';
import {
  ensureReadableRequirement,
  getRequirementAttachmentPath,
  serializeRequirementAttachment,
  removeTemporaryRequirementUploads
} from './utils.js';

export function registerAttachmentRoutes(router: import('express').Router): void {

// POST /:id/attachments - 上传附件
router.post(
  '/:id/attachments',
  requirementUpload.array('files', 10),
  asyncHandler(async (req, res) => {
    const { params } = requirementIdSchema.parse({ params: req.params });
    const files = Array.isArray(req.files) ? req.files : [];
    const movedFilePaths: string[] = [];

    try {
      await ensureReadableRequirement(params.id, req.user!);
      if (files.length === 0) throw new HttpError(400, '请选择要上传的文件');

      const requirementUploadPath = getRequirementUploadPath(params.id);
      mkdirSync(requirementUploadPath, { recursive: true });

      const attachments = files.map((file) => {
        const filename = file.filename as string;
        if (!isAllowedRequirementUploadFilename(filename)) throw new HttpError(400, '无效的文件名');

        const targetPath = getRequirementAttachmentPath(params.id, filename);
        renameSync(file.path, targetPath);
        movedFilePaths.push(targetPath);

        return {
          filename,
          originalName: file.originalname,
          url: getRequirementUploadUrl(path.join(params.id, filename)),
          size: Number(file.size),
          mimeType: getRequirementUploadMimeType(filename) || file.mimetype
        };
      });

      res.status(201).json({ data: attachments });
    } catch (err) {
      removeTemporaryRequirementUploads(files);
      for (const movedFilePath of movedFilePaths) {
        try { unlinkSync(movedFilePath); } catch { /* ignore */ }
      }
      throw err;
    }
  })
);

// GET /:id/attachments - 列出附件
router.get(
  '/:id/attachments',
  asyncHandler(async (req, res) => {
    const { params } = requirementIdSchema.parse({ params: req.params });
    await ensureReadableRequirement(params.id, req.user!);

    let filenames: string[];
    try {
      filenames = readdirSync(getRequirementUploadPath(params.id));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        res.json({ data: [] });
        return;
      }
      throw err;
    }

    const attachments: Array<NonNullable<ReturnType<typeof serializeRequirementAttachment>>> = [];
    for (const filename of filenames) {
      if (!isAllowedRequirementUploadFilename(filename)) continue;
      try {
        const attachment = serializeRequirementAttachment(params.id, filename);
        if (attachment) attachments.push(attachment);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue;
        throw err;
      }
    }

    res.json({ data: attachments });
  })
);

// GET /:id/attachments/:filename - 下载附件
router.get(
  '/:id/attachments/:filename',
  asyncHandler(async (req, res) => {
    const { params } = requirementIdSchema.parse({ params: req.params });
    await ensureReadableRequirement(params.id, req.user!);

    const filenameStr = req.params.filename as string;
    if (!isAllowedRequirementUploadFilename(filenameStr)) throw new HttpError(400, '无效的文件名');

    const filePath = getRequirementAttachmentPath(params.id, filenameStr);
    const mimeType = getRequirementUploadMimeType(filenameStr);

    try {
      const stat = statSync(filePath);
      if (!stat.isFile()) throw new HttpError(404, '文件不存在');
      res.setHeader('Content-Type', mimeType || 'application/octet-stream');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filenameStr)}"`);
      const fileStream = createReadStream(filePath);
      fileStream.pipe(res);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, '文件不存在');
      throw err;
    }
  })
);

// DELETE /:id/attachments/:filename - 归档删除附件
router.delete(
  '/:id/attachments/:filename',
  asyncHandler(async (req, res) => {
    const { params } = requirementIdSchema.parse({ params: req.params });
    await ensureReadableRequirement(params.id, req.user!);

    const filenameStr = req.params.filename as string;
    if (!isAllowedRequirementUploadFilename(filenameStr)) throw new HttpError(400, '无效的文件名');

    const filePath = getRequirementAttachmentPath(params.id, filenameStr);

    try {
      archiveFile(filePath, `requirements/attachments/${params.id}`, {
        itemName: filenameStr,
        itemId: `${params.id}/${filenameStr}`,
        reason: '用户归档删除附件',
        archivedBy: req.user!.name || req.user!.email,
        extra: `requirementId=${params.id}`
      });
      res.json({ success: true, filename: filenameStr, archived: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, '文件不存在');
      throw err;
    }
  })
);

}
