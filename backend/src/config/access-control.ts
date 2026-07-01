/**
 * Access Control Configuration
 * 
 * Defines which roles can access which API endpoints.
 * Modify this file to change access policies without touching route code.
 */

/** Roles that can access the global GET /api/requirements list */
export const GLOBAL_LIST_ACCESS: string[] = [
  'admin',
  'cto_agent',
];

/** Internal roles alias map (internalRole → role equivalence) */
export const GLOBAL_LIST_ACCESS_ALIAS: Record<string, string> = {
  cto: 'cto_agent',
  // Add more aliases here as needed
};

/**
 * Check if a user can access the global requirements list.
 * @param role - req.user.role (platform role)
 * @param internalRole - req.user.internalRole (internal role)
 */
export function canAccessGlobalList(role: string, internalRole: string | null | undefined): boolean {
  if (GLOBAL_LIST_ACCESS.includes(role)) return true;
  if (internalRole && GLOBAL_LIST_ACCESS_ALIAS[internalRole]) {
    return GLOBAL_LIST_ACCESS.includes(GLOBAL_LIST_ACCESS_ALIAS[internalRole]);
  }
  return false;
}
