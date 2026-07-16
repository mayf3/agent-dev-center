import { Prisma } from '@prisma/client';
import type { ErrorRequestHandler } from 'express';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { HttpError } from '../utils/http-error.js';

/**
 * Flatten nested Zod field errors into dot-notation keys.
 * e.g. { body: { title: ["Required"] } } → { "body.title": ["Required"] }
 */
function flattenZodErrors(error: ZodError): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.');
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(issue.message);
  }
  return result;
}

export const errorHandler: ErrorRequestHandler = (error, req, res, _next) => {
  if (error instanceof ZodError) {
    return res.status(400).json({
      message: '请求参数校验失败',
      errors: error.flatten(),
      fieldErrors: flattenZodErrors(error),
      requestId: req.requestId
    });
  }

  if (error instanceof HttpError) {
    return res.status(error.statusCode).json({
      message: error.message,
      details: error.details,
      requestId: req.requestId
    });
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return res.status(409).json({
        message: '资源已存在',
        target: error.meta?.target,
        requestId: req.requestId
      });
    }

    if (error.code === 'P2025') {
      return res.status(404).json({
        message: '资源不存在',
        requestId: req.requestId
      });
    }
  }

  console.error(`[${req.requestId}] Unhandled error`, error);

  return res.status(500).json({
    message: '服务器内部错误',
    requestId: req.requestId,
    stack: env.NODE_ENV === 'development' ? (error as Error).stack : undefined
  });
};
