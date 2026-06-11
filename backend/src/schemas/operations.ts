import { z } from 'zod';

const optionalTrimmedString = z.preprocess((value) => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  return String(value).trim();
}, z.string().optional());

const nullableTrimmedString = z.preprocess((value) => {
  if (value === undefined) return undefined;
  if (value === null || value === '') return null;
  return String(value).trim();
}, z.string().nullable().optional());

const amountSchema = z.preprocess((value) => {
  if (typeof value === 'string') return Number(value);
  return value;
}, z.number().finite().min(0));

const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, '月份格式必须为 YYYY-MM');

export const customerStatusSchema = z.enum(['active', 'inactive', 'lead', 'churned']);
export const orderStatusSchema = z.enum(['pending', 'confirmed', 'in_progress', 'completed', 'cancelled']);
export const revenueTypeSchema = z.enum(['one_time', 'recurring', 'refund']);

const customerBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: nullableTrimmedString.pipe(z.string().email().nullable().optional()),
  phone: nullableTrimmedString,
  source: nullableTrimmedString,
  status: customerStatusSchema.default('lead'),
  notes: nullableTrimmedString,
});

export const createCustomerSchema = z.object({
  body: customerBodySchema,
});

export const updateCustomerSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: customerBodySchema.partial().refine((body) => Object.keys(body).length > 0, {
    message: '至少提供一个要更新的字段',
  }),
});

export const customerIdSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

export const listCustomersSchema = z.object({
  query: z.object({
    search: optionalTrimmedString,
    status: customerStatusSchema.optional(),
    source: optionalTrimmedString,
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

const orderBodySchema = z.object({
  customerId: z.string().uuid(),
  agentId: nullableTrimmedString.pipe(z.string().uuid().nullable().optional()),
  serviceType: z.string().trim().min(1).max(120),
  amount: amountSchema,
  status: orderStatusSchema.default('pending'),
  description: nullableTrimmedString,
});

export const createOrderSchema = z.object({
  body: orderBodySchema,
});

export const updateOrderSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: orderBodySchema.partial().refine((body) => Object.keys(body).length > 0, {
    message: '至少提供一个要更新的字段',
  }),
});

export const orderIdSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

export const listOrdersSchema = z.object({
  query: z.object({
    search: optionalTrimmedString,
    customerId: z.string().uuid().optional(),
    agentId: z.string().uuid().optional(),
    serviceType: optionalTrimmedString,
    status: orderStatusSchema.optional(),
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }),
});

const revenueRecordBodySchema = z.object({
  orderId: z.string().uuid().optional(),
  agentId: nullableTrimmedString.pipe(z.string().uuid().nullable().optional()),
  amount: amountSchema,
  type: revenueTypeSchema.default('one_time'),
  month: nullableTrimmedString.pipe(monthSchema.nullable().optional()),
});

export const createRevenueRecordSchema = z.object({
  params: z.object({ orderId: z.string().uuid() }).optional(),
  body: revenueRecordBodySchema,
});

export const updateRevenueRecordSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: revenueRecordBodySchema.omit({ orderId: true }).partial().refine((body) => Object.keys(body).length > 0, {
    message: '至少提供一个要更新的字段',
  }),
});

export const revenueRecordIdSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
});

export const revenueSummarySchema = z.object({
  query: z.object({
    agentId: z.string().uuid().optional(),
    type: revenueTypeSchema.optional(),
    monthFrom: monthSchema.optional(),
    monthTo: monthSchema.optional(),
  }),
});

export const agentPerformanceSchema = z.object({
  query: z.object({
    agentId: z.string().uuid().optional(),
    monthFrom: monthSchema.optional(),
    monthTo: monthSchema.optional(),
  }),
});
