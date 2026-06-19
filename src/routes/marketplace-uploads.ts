import { createReadStream, statSync, unlinkSync } from 'node:fs';
import { authRequired } from '../middleware/auth.js';
import {
  getMarketplaceUploadExtension,
  getMarketplaceUploadMimeType,
  getMarketplaceUploadPath,
  getMarketplaceUploadUrl,
  isAllowedMarketplaceUploadFilename,
  marketplaceUpload
} from '../lib/multer.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { Router } from 'express';

export const marketplaceUploadsRouter = Router();

// POST /api/marketplace/uploads - Upload a single file
marketplaceUploadsRouter.post(
  '/',
  authRequired,
  marketplaceUpload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new HttpError(400, '请选择要上传的文件');
    }

    const file = req.file;
    if (!file) {
      throw new HttpError(400, '请选择要上传的文件');
    }

    const filename = file.filename as string;
    const originalname = file.originalname as string;
    const size = Number(file.size);
    const mimetype = file.mimetype as string;
    const extension = getMarketplaceUploadExtension(originalname);

    res.status(201).json({
      data: {
        filename,
        originalName: originalname,
        url: getMarketplaceUploadUrl(filename),
        size,
        mimeType: extension ? getMarketplaceUploadMimeType(originalname) : mimetype,
        extension
      }
    });
  })
);

// GET /api/marketplace/uploads/:filename - Download a file
marketplaceUploadsRouter.get(
  '/:filename',
  asyncHandler(async (req, res) => {
    const { filename } = req.params;
    const filenameStr = filename as string;

    if (!isAllowedMarketplaceUploadFilename(filenameStr)) {
      throw new HttpError(400, '无效的文件名');
    }

    const filePath = getMarketplaceUploadPath(filenameStr);
    const mimeType = getMarketplaceUploadMimeType(filenameStr);

    try {
      const stat = statSync(filePath);
      res.setHeader('Content-Type', mimeType || 'application/octet-stream');
      res.setHeader('Content-Length', stat.size);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filenameStr)}"`);

      const fileStream = createReadStream(filePath);
      fileStream.pipe(res);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new HttpError(404, '文件不存在');
      }
      throw err;
    }
  })
);

// DELETE /api/marketplace/uploads/:filename - Delete a file
marketplaceUploadsRouter.delete(
  '/:filename',
  authRequired,
  asyncHandler(async (req, res) => {
    const { filename } = req.params;
    const filenameStr = filename as string;

    if (!isAllowedMarketplaceUploadFilename(filenameStr)) {
      throw new HttpError(400, '无效的文件名');
    }

    const filePath = getMarketplaceUploadPath(filenameStr);

    try {
      unlinkSync(filePath);
      res.json({ success: true, filename: filenameStr });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new HttpError(404, '文件不存在');
      }
      throw err;
    }
  })
);
