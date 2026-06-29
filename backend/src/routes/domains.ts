/**
 * Domain API Routes
 *
 * GET /api/domains          — list accessible active domains (with role info)
 * GET /api/domains/:key     — single domain detail
 *
 * Both endpoints respect the user's domain scope (resolved at request time
 * from DomainRoleBinding, NOT from JWT).
 */
import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { authRequired } from '../middleware/auth.js';
import { domainScope } from '../middleware/domain-scope.js';

export const router = Router();

// All domain routes require authentication + domain scope
router.use(authRequired);
router.use(domainScope);

/**
 * GET /api/domains
 * Return the current user's accessible active domains.
 *
 * For cross-domain admins, returns ALL active domains.
 * For domain-scoped users, returns only their bound domains.
 * Each entry includes the user's effective role (member/admin).
 */
router.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = req.user!;

    let whereDomains: { key?: { in: string[] } } = {};

    if (user.crossDomainAccess) {
      // cross-domain admin: access all active domains
    } else if (user.allowedDomainKeys && user.allowedDomainKeys.length > 0) {
      whereDomains = { key: { in: user.allowedDomainKeys } };
    } else {
      return res.json({ data: [] });
    }

    const domains = await prisma.businessDomain.findMany({
      where: { ...whereDomains, isActive: true },
      orderBy: { key: 'asc' },
      select: {
        key: true,
        name: true,
        description: true,
        isActive: true,
        isSystem: true,
      },
    });

    // Compute effective role for each domain
    const adminSet = new Set(user.adminDomainKeys ?? []);
    const data = domains.map((d: { key: string; name: string; description: string; isActive: boolean; isSystem: boolean }) => ({
      ...d,
      role: user.crossDomainAccess
        ? 'admin'
        : adminSet.has(d.key)
          ? 'admin'
          : 'member',
    }));

    res.json({ data });
  }),
);

/**
 * GET /api/domains/:key
 * Return a single domain if the user has access.
 */
router.get(
  '/:key',
  asyncHandler(async (req, res) => {
    const user = req.user!;
    const key = req.params.key as string;

    if (!user.crossDomainAccess) {
      if (!user.allowedDomainKeys || !user.allowedDomainKeys.includes(key)) {
        throw new HttpError(403, 'forbidden');
      }
    }

    const domain = await prisma.businessDomain.findUnique({
      where: { key },
      select: {
        key: true,
        name: true,
        description: true,
        isActive: true,
        isSystem: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!domain) throw new HttpError(404, 'domain not found');
    if (!domain.isActive) throw new HttpError(404, 'domain not found');

    const adminSet = new Set(user.adminDomainKeys ?? []);
    res.json({
      data: {
        ...domain,
        role: user.crossDomainAccess
          ? 'admin'
          : adminSet.has(domain.key)
            ? 'admin'
            : 'member',
      },
    });
  }),
);

export const mountPath = '/api/domains';
