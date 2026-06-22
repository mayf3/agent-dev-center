/**
 * Short UUID prefix matching middleware.
 *
 * If req.params.id is not a valid full UUID but matches a unique requirement
 * by prefix, replaces req.params.id with the full UUID.
 *
 * Behavior:
 * - Full UUID: pass through unchanged
 * - Short prefix matching exactly 1 requirement: rewrite to full UUID
 * - Short prefix matching 0: 400 Invalid uuid (let Zod handle)
 * - Short prefix matching >1: 409 Conflict
 */

import { NextFunction, Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHORT_ID_RE = /^[0-9a-f]{4,35}$/i;

export async function resolveShortUuid(req: Request, res: Response, next: NextFunction) {
  const rawId = req.params.id;
  if (!rawId || Array.isArray(rawId)) return next();

  // Full UUID — pass through
  if (UUID_RE.test(rawId)) return next();

  // Not hex-ish — let downstream Zod validation produce the error
  if (!SHORT_ID_RE.test(rawId)) return next();

  try {
    // Prisma UUID 字段不支持 startsWith，使用原始 SQL 查询
    const rows = await prisma.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT id FROM "Requirement" WHERE id::text LIKE ${rawId + '%'} LIMIT 2`
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: `未找到 ID 以 "${rawId}" 开头的需求` });
    }

    if (rows.length > 1) {
      return res.status(409).json({
        message: `短 ID "${rawId}" 匹配到多个需求，请使用更长的前缀`,
        matchedIds: rows.map(r => r.id),
      });
    }

    // Unique match — rewrite req.params.id
    req.params.id = rows[0].id;
    next();
  } catch (err) {
    next(err);
  }
}
