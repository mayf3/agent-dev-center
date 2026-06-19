import type { UserRole, InternalRole } from '@prisma/client';

declare global {
  namespace Express {
    interface AuthUser {
      id: string;
      name: string;
      email: string;
      role: UserRole;
      agentId?: string | null | undefined;
      internalRole?: InternalRole | null | undefined;
      roles?: string[] | null | undefined;
      okrRole?: string | null | undefined;
      mustChangePassword?: boolean | null | undefined;
      enabled?: boolean | null | undefined;
      bio?: string | null;
      phone?: string | null;
      avatar?: string | null;
      department?: string | null;
      title?: string | null;
      employeeNo?: string | null;
      onboardingDate?: Date | null;
      managerId?: string | null;
    }

    interface Request {
      user?: AuthUser;
      requestId?: string;
    }
  }
}

export {};
