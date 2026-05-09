import { Router } from 'express';
import bcrypt from 'bcrypt';
import { prisma } from '../lib/prisma.js';
import { asyncHandler } from '../utils/async-handler.js';
import { HttpError } from '../utils/http-error.js';
import { signAuthToken } from '../middleware/auth.js';
import { loginSchema, registerSchema } from '../schemas/auth.js';
import { ipWhitelist } from '../middleware/ip-whitelist.js';

export const authRouter = Router();

function toSafeUser(user: {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'requester' | 'developer';
}) {
  return user;
}

authRouter.post(
  '/register',
  ipWhitelist,
  asyncHandler(async (req, res) => {
    const { body } = registerSchema.parse({ body: req.body });
    const password = await bcrypt.hash(body.password, 10);

    const user = await prisma.user.create({
      data: {
        name: body.name,
        email: body.email,
        password,
        role: body.role
      },
      select: { id: true, name: true, email: true, role: true }
    });

    const token = signAuthToken(user);

    res.status(201).json({
      token,
      user: toSafeUser(user)
    });
  })
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { body } = loginSchema.parse({ body: req.body });
    const user = await prisma.user.findUnique({
      where: { email: body.email }
    });

    if (!user) {
      throw new HttpError(401, '邮箱或密码不正确');
    }

    const passwordMatches = await bcrypt.compare(body.password, user.password);
    if (!passwordMatches) {
      throw new HttpError(401, '邮箱或密码不正确');
    }

    const safeUser = toSafeUser({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role
    });

    const token = signAuthToken(safeUser);

    res.json({
      token,
      user: safeUser
    });
  })
);
