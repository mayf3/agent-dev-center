import type { UserRole } from '@prisma/client';

declare global {
  namespace Express {
    interface AuthUser {
      id: string;
      name: string;
      email: string;
      role: UserRole;
    }

    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

export {};
