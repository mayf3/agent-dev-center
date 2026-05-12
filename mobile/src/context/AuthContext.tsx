import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { User, AuthResponse } from '../types';
import { STORAGE_KEYS } from '../constants';
import * as authApi from '../api/auth';

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// 在 Web 平台降级使用内存存储（SecureStore 仅原生支持）
const safeStore = {
  getItem: async (key: string) => {
    if (Platform.OS === 'web') return null;
    try { return await SecureStore.getItemAsync(key); } catch { return null; }
  },
  setItem: async (key: string, value: string) => {
    if (Platform.OS === 'web') return;
    try { await SecureStore.setItemAsync(key, value); } catch {}
  },
  deleteItem: async (key: string) => {
    if (Platform.OS === 'web') return;
    try { await SecureStore.deleteItemAsync(key); } catch {}
  },
};

export const AuthProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    restoreAuth();
  }, []);

  const restoreAuth = async () => {
    try {
      const savedToken = await safeStore.getItem(STORAGE_KEYS.AUTH_TOKEN);
      const savedUser = await safeStore.getItem(STORAGE_KEYS.USER_DATA);
      if (savedToken && savedUser) {
        setToken(savedToken);
        setUser(JSON.parse(savedUser));
      }
    } catch {
      // 恢复失败，用户需要重新登录
    } finally {
      setIsLoading(false);
    }
  };

  const persistAuth = async (auth: AuthResponse) => {
    await safeStore.setItem(STORAGE_KEYS.AUTH_TOKEN, auth.token);
    await safeStore.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(auth.user));
    setToken(auth.token);
    setUser(auth.user);
  };

  const login = async (email: string, password: string) => {
    const auth = await authApi.login({ email, password });
    await persistAuth(auth);
    // 刷新 LLM Todo API 客户端（读取新版 Token）
    try {
      const { refreshToken: refreshLLM } = await import('../api/llmtodo');
      await refreshLLM();
    } catch {}
  };

  const register = async (name: string, email: string, password: string) => {
    const auth = await authApi.register({ name, email, password, role: 'developer' });
    await persistAuth(auth);
  };

  const logout = async () => {
    await safeStore.deleteItem(STORAGE_KEYS.AUTH_TOKEN);
    await safeStore.deleteItem(STORAGE_KEYS.USER_DATA);
    setToken(null);
    setUser(null);
  };

  const updateUser = (updatedUser: User) => {
    setUser(updatedUser);
    safeStore.setItem(STORAGE_KEYS.USER_DATA, JSON.stringify(updatedUser));
  };

  return (
    <AuthContext.Provider value={{
      user, token, isLoading,
      isAuthenticated: !!token && !!user,
      login, register, logout, updateUser,
    }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
};
