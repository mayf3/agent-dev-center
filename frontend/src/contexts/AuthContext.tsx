import { createContext, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from '../api/client';
import type { AuthResponse, User, UserRole } from '../api/types';

interface LoginInput {
  email: string;
  password: string;
}

interface RegisterInput extends LoginInput {
  name: string;
  role: UserRole;
}

interface AuthContextValue {
  user: User | null;
  token: string | null;
  isAuthenticated: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  loginWithToken: (token: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const tokenKey = 'agent-dev-center-token';
const userKey = 'agent-dev-center-user';

function readStoredUser() {
  const raw = localStorage.getItem(userKey);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw) as User;
  } catch {
    localStorage.removeItem(userKey);
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(tokenKey));
  const [user, setUser] = useState<User | null>(() => readStoredUser());

  const persistAuth = (response: AuthResponse) => {
    localStorage.setItem(tokenKey, response.token);
    localStorage.setItem(userKey, JSON.stringify(response.user));
    setToken(response.token);
    setUser(response.user);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      token,
      isAuthenticated: Boolean(token && user),
      login: async (input) => {
        const { data } = await api.post<AuthResponse>('/auth/login', input);
        persistAuth(data);
      },
      register: async (input) => {
        const { data } = await api.post<AuthResponse>('/auth/register', input);
        persistAuth(data);
      },
      loginWithToken: async (rawToken: string) => {
        // 用 Token 直接换取用户信息
        const { data } = await api.get<User>('/auth/me', {
          headers: { Authorization: `Bearer ${rawToken}` }
        });
        if (!data || !data.id) {
          throw new Error('Token 验证失败：服务器返回数据异常');
        }
        localStorage.setItem(tokenKey, rawToken);
        localStorage.setItem(userKey, JSON.stringify(data));
        setToken(rawToken);
        setUser(data);
      },
      logout: () => {
        localStorage.removeItem(tokenKey);
        localStorage.removeItem(userKey);
        setToken(null);
        setUser(null);
      }
    }),
    [token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }

  return context;
}
