import { z } from 'zod';

export const listRevisionsSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).transform(v => Math.min(v, 100)).default(20),
  }),
});
