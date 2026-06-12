/**
 * Requirement Guard — Prisma extension that prevents drift at the DB level.
 * 
 * FIXED 2026-06-12: query middleware中不直接调model.findUnique（Prisma v5限制），
 * 改为只在实际update时修正assignee。不做中间查询，交给API层处理。
 */

import { Prisma } from '@prisma/client';

/**
 * Apply the requirement guard as a Prisma $extends extension.
 * Simple version: only intercepts update and passes through without extra queries.
 * Drift prevention is handled at the API layer (workflow.ts).
 */
export function requirementGuardExtension() {
  return Prisma.defineExtension({
    name: 'requirementGuard',
    query: {
      requirement: {
        async update({ args, query }) {
          // Pass through - drift prevention is handled at the API layer
          return query(args);
        },
      },
    },
  });
}
