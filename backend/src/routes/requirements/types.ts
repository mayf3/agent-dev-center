/**
 * Shared types for requirement routes.
 */
import type { Prisma } from '@prisma/client';

/**
 * The Prisma transaction client type as received by $transaction callbacks.
 */
export type PrismaTransactionClient = Prisma.TransactionClient;
