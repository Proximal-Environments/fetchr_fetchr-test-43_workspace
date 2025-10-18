/* eslint-disable */
import Prisma from "@prisma/client";

const prismaClient = new Prisma.PrismaClient();

// Create a proxy to alias 'users' to 'public_users'
export const supabaseDb = new Proxy(prismaClient, {
  get(target, prop) {
    if (prop === "users") {
      return target.public_users;
    }
    return target[prop as keyof typeof target];
  },
}) as Prisma.PrismaClient & { users: typeof prismaClient.public_users };
