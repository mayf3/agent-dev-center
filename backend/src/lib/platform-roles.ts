import type { InternalRole, UserRole } from '@prisma/client';

const ADC_PLATFORM = 'adc';

export interface LegacyRoleUser {
  roles?: readonly string[] | null;
  role?: UserRole | string | null;
  internalRole?: InternalRole | string | null;
}

export interface LegacyRolePair {
  role: UserRole;
  internalRole: InternalRole | null;
}

const LEGACY_INTERNAL_TO_ADC: Partial<Record<string, string>> = {
  cto: 'adc:admin',
  pm: 'adc:pm',
  developer: 'adc:developer',
  tester: 'adc:tester',
  security: 'adc:security',
  ops: 'adc:ops',
  qa: 'adc:qa',
};

const LEGACY_USER_ROLE_TO_ADC: Partial<Record<string, string>> = {
  admin: 'adc:admin',
  cto_agent: 'adc:admin',
  requester: 'adc:viewer',
  developer: 'adc:developer',
};

const ADC_TO_LEGACY: Partial<Record<string, LegacyRolePair>> = {
  'adc:admin': { role: 'admin', internalRole: 'cto' },
  'adc:pm': { role: 'developer', internalRole: 'pm' },
  'adc:developer': { role: 'developer', internalRole: 'developer' },
  'adc:tester': { role: 'developer', internalRole: 'tester' },
  'adc:security': { role: 'developer', internalRole: 'security' },
  'adc:ops': { role: 'developer', internalRole: 'ops' },
  'adc:qa': { role: 'developer', internalRole: 'qa' },
  'adc:viewer': { role: 'requester', internalRole: null },
};

function platformPrefix(platform: string): string {
  return `${platform}:`;
}

function platformRoles(user: Pick<LegacyRoleUser, 'roles'>, platform: string): string[] {
  const prefix = platformPrefix(platform);
  return (user.roles ?? []).filter((role): role is string => typeof role === 'string' && role.startsWith(prefix));
}

function normalizeRequestedPlatformRole(role: string, platform: string): string {
  if (role.includes(':')) return role;
  if (platform === ADC_PLATFORM) {
    return LEGACY_INTERNAL_TO_ADC[role] ?? LEGACY_USER_ROLE_TO_ADC[role] ?? `${platform}:${role}`;
  }
  return `${platform}:${role}`;
}

export function legacyToPlatformRole(user: LegacyRoleUser, platform = ADC_PLATFORM): string | null {
  if (platform !== ADC_PLATFORM) return null;
  if (user.internalRole) {
    const mapped = LEGACY_INTERNAL_TO_ADC[user.internalRole];
    if (mapped) return mapped;
  }
  if (user.role) {
    return LEGACY_USER_ROLE_TO_ADC[user.role] ?? null;
  }
  return null;
}

export function getPlatformRole(user: LegacyRoleUser, platform = ADC_PLATFORM): string | null {
  const roles = platformRoles(user, platform);
  if (roles.length > 0) return roles[0] ?? null;
  return legacyToPlatformRole(user, platform);
}

export function getPlatformRoles(user: LegacyRoleUser, platform = ADC_PLATFORM): string[] {
  const roles = platformRoles(user, platform);
  if (roles.length > 0) return roles;
  const legacyRole = legacyToPlatformRole(user, platform);
  return legacyRole ? [legacyRole] : [];
}

export function hasPlatformRole(user: LegacyRoleUser, role: string, platform = ADC_PLATFORM): boolean {
  const target = normalizeRequestedPlatformRole(role, platform);
  const roles = platformRoles(user, platform);
  if (roles.length > 0) return roles.includes(target);
  return legacyToPlatformRole(user, platform) === target;
}

export function isPlatformAdmin(user: LegacyRoleUser, platform = ADC_PLATFORM): boolean {
  return hasPlatformRole(user, 'admin', platform);
}

export function platformToLegacyRole(platformRole: string | null | undefined): LegacyRolePair | null {
  if (!platformRole) return null;
  return ADC_TO_LEGACY[platformRole] ?? null;
}

export function replacePlatformRole(
  roles: readonly string[] | null | undefined,
  platformRole: string | null,
  platform = ADC_PLATFORM,
): string[] {
  const prefix = platformPrefix(platform);
  const otherRoles = (roles ?? []).filter(role => typeof role === 'string' && !role.startsWith(prefix));
  return platformRole ? [...otherRoles, platformRole] : otherRoles;
}

export function normalizePlatformRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) {
    throw new TypeError('roles must be an array');
  }

  const normalized = roles.map((role) => {
    if (typeof role !== 'string') throw new TypeError('roles must contain only strings');
    const trimmed = role.trim();
    if (!/^[a-z][a-z0-9_-]*:[a-z][a-z0-9_-]*$/.test(trimmed)) {
      throw new TypeError(`Invalid platform role: ${role}`);
    }
    return trimmed;
  });

  return Array.from(new Set(normalized));
}
