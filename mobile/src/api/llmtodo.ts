import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

export const LLM_TODO_BASE_URL = 'http://8.163.44.127/todo/api';
export const LLM_TODO_TOKEN_KEY = 'llm-todo-token';

// 默认 token（用户未输入时的兜底）
const DEFAULT_TOKEN = '7b76319d4e31b94468b1f67f1b344fb323770f9c3bc9ad6c';

async function getToken(): Promise<string> {
  if (Platform.OS === 'web') return DEFAULT_TOKEN;
  try {
    const t = await SecureStore.getItemAsync(LLM_TODO_TOKEN_KEY);
    return t || DEFAULT_TOKEN;
  } catch {
    return DEFAULT_TOKEN;
  }
}

import type { AxiosInstance } from 'axios';

let _llmApi: Promise<AxiosInstance> | null = null;

async function createApi(): Promise<AxiosInstance> {
  const axios = (await import('axios')).default;
  const token = await getToken();
  return axios.create({
    baseURL: LLM_TODO_BASE_URL,
    timeout: 30000,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });
}

function getApi(): Promise<AxiosInstance> {
  if (!_llmApi) _llmApi = createApi();
  return _llmApi;
}

// 强制刷新 token（用户登录后调用）
export async function refreshToken() {
  _llmApi = createApi();
  return _llmApi;
}

// ── Types ──
export interface TodoTask {
  id: string;
  title: string;
  status: 'active' | 'waiting' | 'done' | 'dropped';
  horizon: string;
  area: string;
  priority: 'high' | 'medium' | 'low';
  tags: string[];
  due: string;
  nextAction: string;
  notes: string;
  repeat: string;
  created: string;
  updated: string;
}

export interface TodoStats {
  total: number;
  current: number;
  active: number;
  done: number;
  dropped: number;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ── API ──
export const getState = async () => {
  const api = await getApi();
  const res = await api.get('/state');
  return res.data as {
    stats: TodoStats;
    tasks: TodoTask[];
    history: TodoTask[];
  };
};

export const getTasks = async () => {
  const api = await getApi();
  const res = await api.get('/tasks');
  return res.data.tasks as TodoTask[];
};

export const getHistory = async () => {
  const api = await getApi();
  const res = await api.get('/history');
  return res.data.tasks as TodoTask[];
};

export const createTask = async (payload: Partial<TodoTask>) => {
  const api = await getApi();
  const res = await api.post('/tasks/create', payload);
  return res.data;
};

export const updateTask = async (payload: Partial<TodoTask> & { id: string }) => {
  const api = await getApi();
  const res = await api.post('/tasks/update', payload);
  return res.data;
};

export const batchUpdateStatus = async (ids: string[], status: string) => {
  const api = await getApi();
  const res = await api.post('/tasks/batch', { ids, status });
  return res.data;
};

export const searchTasks = async (query: string) => {
  const api = await getApi();
  const res = await api.post('/tasks/search', { query });
  return res.data;
};

export const sendChat = async (messages: ChatMessage[], provider: string = 'local-planner') => {
  const api = await getApi();
  const res = await api.post('/chat', { messages, provider });
  return res.data as {
    text: string;
    provider: string;
    model: string;
    operations: any[];
    latencyMs: number;
    state: any;
  };
};
