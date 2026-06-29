/**
 * Domain Scope Resolver
 *
 * Resolves a user's effective domain access from the database at request time.
 * This is the AUTHORITATIVE source of domain permissions — NOT the JWT.
 * Domain binding changes take effect immediately without waiting for token expiry.
 *
 * Privilege model:
 *   - isGlobal === true   → cross-domain access (all domains)
 *   - isDomainAdmin === true → full visibility within the bound domain
 *   - isDomainAdmin === false → visibility subject to role-based sub-filtering
 */
import { prisma } from './prisma.js';
import { getPlatformRoles } from './platform-roles.js';

export interface DomainScope {
  /** Cross-domain access — bypasses all domain filtering */
  crossDomainAccess: boolean;
  /** Domains where the user has admin-level visibility */
  adminDomainKeys: string[];
  /** Domains where the user has member-level visibility */
  memberDomainKeys: string[];
  /** Union of all accessible domain keys (admin + member) */
  allowedDomainKeys: string[];
}

/**
 * Resolve domain scope for a user from the database.
 * Returns a minimal-scope object if no bindings exist (fail-closed).
 */
export async function resolveDomainScope(user: {
  id: string;
  role: string;
  internalRole?: string | null;
  roles?: string[];
}): Promise<DomainScope> {
  const platformRoles = getPlatformRoles(user);

  if (platformRoles.length === 0) {
    return emptyScope();
  }

  const bindings = await prisma.domainRoleBinding.findMany({
    where: { role: { in: platformRoles } },
    select: { domainKey: true, isDomainAdmin: true, isGlobal: true },
  });

  let crossDomainAccess = false;
  const adminDomains = new Set<string>();
  const memberDomains = new Set<string>();

  for (const b of bindings) {
    if (b.isGlobal) {
      crossDomainAccess = true;
    }
    if (b.isDomainAdmin) {
      adminDomains.add(b.domainKey);
    }
    memberDomains.add(b.domainKey);
  }

  return {
    crossDomainAccess,
    adminDomainKeys: [...adminDomains],
    memberDomainKeys: [...memberDomains],
    allowedDomainKeys: [...new Set([...adminDomains, ...memberDomains])],
  };
}

export function emptyScope(): DomainScope {
  return {
    crossDomainAccess: false,
    adminDomainKeys: [],
    memberDomainKeys: [],
    allowedDomainKeys: [],
  };
}
