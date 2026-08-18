import { PrismaClient } from "@/generated/prisma";

// Next.js dev reloads modules per request; caching on `globalThis` keeps one
// PrismaClient (one SQLite connection) alive across those reloads instead of
// exhausting the file's writer lock.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
