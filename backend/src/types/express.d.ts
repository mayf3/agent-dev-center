import type { UserRole, InternalRole } from '@prisma/client';

declare global {
  namespace Express {
    interface AuthUser {
      id: string;
      name: string;
      email: string;
      role: UserRole;
      internalRole?: InternalRole | null | undefined;
      okrRole?: string | null | undefined;
    }

    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

export {};
