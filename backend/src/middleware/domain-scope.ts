/**
 * Domain Scope Middleware
 *
 * Resolves domain permissions from the database and attaches them to
 * req.user after authentication.  Runs on every requirement-related
 * request so that domain binding changes take effect IMMEDIATELY
 * (never cached in JWT).
 *
 * Usage: apply after `authRequired` to any router that needs domain isolation.
 *
 *   requirementsRouter.use(authRequired);
 *   requirementsRouter.use(domainScope);
 */
import type { NextFunction, Request, Response } from 'express';
import { resolveDomainScope } from '../lib/domain-scope.js';

export async function domainScope(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
    next();
    return;
  }

  const scope = await resolveDomainScope(req.user);

  req.user.allowedDomainKeys = scope.allowedDomainKeys;
  req.user.adminDomainKeys = scope.adminDomainKeys;
  req.user.crossDomainAccess = scope.crossDomainAccess;

  next();
}
