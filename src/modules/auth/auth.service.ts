import bcrypt from 'bcrypt';
import { prisma } from '../../config/database';
import { createError } from '../../utils/errors';

const SALT_ROUNDS = 10;

export interface RegisterInput {
  email: string;
  password: string;
  displayName: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

export const authService = {
  async register(input: RegisterInput) {
    const existing = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (existing) {
      throw createError(409, 'Email already in use');
    }

    const password = await bcrypt.hash(input.password, SALT_ROUNDS);
    const user = await prisma.user.create({
      data: { email: input.email, password, displayName: input.displayName },
      select: { id: true, email: true, displayName: true, createdAt: true },
    });
    return user;
  },

  async login(input: LoginInput) {
    const user = await prisma.user.findUnique({
      where: { email: input.email },
    });
    if (!user) {
      throw createError(401, 'Invalid credentials');
    }

    const valid = await bcrypt.compare(input.password, user.password);
    if (!valid) {
      throw createError(401, 'Invalid credentials');
    }

    return { id: user.id, email: user.email, displayName: user.displayName };
  },

  async me(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        avatarUrl: true,
        createdAt: true,
      },
    });
    if (!user) throw createError(404, 'User not found');
    return user;
  },
};
