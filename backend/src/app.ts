import express from 'express';
import { env } from './config/env.js';
import { ensureArchiveRoot } from './lib/archive.js';
import { errorHandler } from './middleware/error-handler.js';
import { applyCoreMiddleware } from './middleware/core.js';
import { gatewayGuard } from './middleware/ip-whitelist.js';
import { mustChangePasswordGuard } from './middleware/must-change-password.js';
import { HttpError } from './utils/http-error.js';
import { autoRegisterRoutes } from './utils/route-registry.js';

export const app = express();

applyCoreMiddleware(app);

if (env.NODE_ENV === 'production') {
  app.use(gatewayGuard());
}

ensureArchiveRoot();

await autoRegisterRoutes(app);

app.use('/api', mustChangePasswordGuard);

app.use((_req, _res, next) => {
  next(new HttpError(404, '接口不存在'));
});

app.use(errorHandler);
