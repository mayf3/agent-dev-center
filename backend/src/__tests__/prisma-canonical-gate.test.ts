/**
 * Canonical Prisma schema gate.
 * Prevents re-introduction of a root-level prisma/ directory
 * that would cause dual-source drift.
 */
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const ROOT_PRISMA_DIR = path.resolve(import.meta.dirname, '../../../prisma');

describe('Canonical Prisma schema gate', () => {
  it('root prisma/ directory must NOT exist', () => {
    const exists = fs.existsSync(ROOT_PRISMA_DIR);
    expect(exists).toBe(false);
  });

  it('canonical schema must exist at backend/prisma/schema.prisma', () => {
    const canonical = path.resolve(import.meta.dirname, '../../prisma/schema.prisma');
    expect(fs.existsSync(canonical)).toBe(true);
  });
});
