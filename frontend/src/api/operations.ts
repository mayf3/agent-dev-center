import { apiClient } from './client';

export type CustomerStatus = 'active' | 'inactive' | 'lead' | 'churned';
export type OrderStatus = 'pending' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
export type RevenueType = 'one_time' | 'recurring' | 'refund';
export type MoneyValue = string | number;

export interface PaginationMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: string | null;
  status: CustomerStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  orders?: Order[];
  _count?: { orders: number };
}

export interface Order {
  id: string;
  customerId: string;
  customer?: Customer;
  agentId: string | null;
  serviceType: string;
  amount: MoneyValue;
  status: OrderStatus;
  description: string | null;
  createdAt: string;
  updatedAt: string;
  revenues?: RevenueRecord[];
}

export interface RevenueRecord {
  id: string;
  orderId: string;
  order?: Order;
  agentId: string | null;
  amount: MoneyValue;
  type: RevenueType;
  month: string | null;
  createdAt: string;
}

export interface CustomerPayload {
  name: string;
  email?: string | null;
  phone?: string | null;
  source?: string | null;
  status?: CustomerStatus;
  notes?: string | null;
}

export interface OrderPayload {
  customerId: string;
  agentId?: string | null;
  serviceType: string;
  amount: number;
  status?: OrderStatus;
  description?: string | null;
}

export interface RevenueRecordPayload {
  agentId?: string | null;
  amount: number;
  type?: RevenueType;
  month?: string | null;
}

export interface CustomerListParams {
  search?: string;
  status?: CustomerStatus;
  source?: string;
  page?: number;
  limit?: number;
}

export interface OrderListParams {
  search?: string;
  customerId?: string;
  agentId?: string;
  serviceType?: string;
  status?: OrderStatus;
  page?: number;
  limit?: number;
}

export interface ListResponse<T> {
  data: T[];
  pagination: PaginationMeta;
}

export interface EntityResponse<T> {
  data: T;
}

export interface AgentRef {
  id: string | null;
  name: string;
  displayName: string;
  avatar: string | null;
  status: string;
}

export interface RevenueSummary {
  summary: {
    grossRevenue: number;
    refundAmount: number;
    netRevenue: number;
    recurringRevenue: number;
    oneTimeRevenue: number;
    recordCount: number;
  };
  monthly: Array<{
    month: string;
    grossRevenue: number;
    refundAmount: number;
    netRevenue: number;
    recordCount: number;
  }>;
  byAgent: Array<{
    agentId: string | null;
    agent: AgentRef;
    grossRevenue: number;
    refundAmount: number;
    netRevenue: number;
    recordCount: number;
  }>;
  recentRecords: RevenueRecord[];
}

export interface AgentPerformance {
  summary: {
    totalAgents: number;
    totalOrders: number;
    completedOrders: number;
    netRevenue: number;
  };
  performance: Array<{
    rank: number;
    agentId: string | null;
    agent: AgentRef;
    totalOrders: number;
    completedOrders: number;
    cancelledOrders: number;
    totalOrderAmount: number;
    averageOrderValue: number;
    completionRate: number;
    grossRevenue: number;
    refundAmount: number;
    netRevenue: number;
    revenueRecords: number;
  }>;
}

export interface OperationsMetricsParams {
  agentId?: string;
  type?: RevenueType;
  monthFrom?: string;
  monthTo?: string;
}

const base = '/api/operations';

export const operationsApi = {
  listCustomers: (params?: CustomerListParams) =>
    apiClient.get<ListResponse<Customer>>(`${base}/customers`, { params }),
  getCustomer: (id: string) =>
    apiClient.get<EntityResponse<Customer>>(`${base}/customers/${id}`),
  createCustomer: (data: CustomerPayload) =>
    apiClient.post<EntityResponse<Customer>>(`${base}/customers`, data),
  updateCustomer: (id: string, data: Partial<CustomerPayload>) =>
    apiClient.patch<EntityResponse<Customer>>(`${base}/customers/${id}`, data),
  deleteCustomer: (id: string) =>
    apiClient.delete<void>(`${base}/customers/${id}`),

  listOrders: (params?: OrderListParams) =>
    apiClient.get<ListResponse<Order>>(`${base}/orders`, { params }),
  getOrder: (id: string) =>
    apiClient.get<EntityResponse<Order>>(`${base}/orders/${id}`),
  createOrder: (data: OrderPayload) =>
    apiClient.post<EntityResponse<Order>>(`${base}/orders`, data),
  updateOrder: (id: string, data: Partial<OrderPayload>) =>
    apiClient.patch<EntityResponse<Order>>(`${base}/orders/${id}`, data),
  deleteOrder: (id: string) =>
    apiClient.delete<void>(`${base}/orders/${id}`),

  createRevenueRecord: (orderId: string, data: RevenueRecordPayload) =>
    apiClient.post<EntityResponse<RevenueRecord>>(`${base}/orders/${orderId}/revenue-records`, data),
  updateRevenueRecord: (id: string, data: Partial<RevenueRecordPayload>) =>
    apiClient.patch<EntityResponse<RevenueRecord>>(`${base}/revenue-records/${id}`, data),
  deleteRevenueRecord: (id: string) =>
    apiClient.delete<void>(`${base}/revenue-records/${id}`),

  getRevenueSummary: (params?: OperationsMetricsParams) =>
    apiClient.get<EntityResponse<RevenueSummary>>(`${base}/revenue/summary`, { params }),
  getAgentPerformance: (params?: Omit<OperationsMetricsParams, 'type'>) =>
    apiClient.get<EntityResponse<AgentPerformance>>(`${base}/agent-performance`, { params }),
};
