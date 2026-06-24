import { PrismaClient } from '@prisma/client';
import { env } from '../config/env.js';
import { requirementGuardExtension } from './requirement-guard.js';

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

// Base client (no extensions)
const basePrisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error']
  });

if (env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = basePrisma;
}

/**
 * Extended Prisma client with requirement guard.
 * When currentStep changes on a requirement with a workflow,
 * assigneeId/assignee are auto-resolved to match the target step's role.
 */
export const prisma = basePrisma.$extends(requirementGuardExtension());
