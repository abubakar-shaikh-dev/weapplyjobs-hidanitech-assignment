import fp from "fastify-plugin";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../generated/prisma/client.js";
import { env } from "../config/env.js";

declare module "fastify" {
  interface FastifyInstance {
    db: PrismaClient;
  }
}

export default fp(
  async function dbPlugin(fastify) {
    const adapter = new PrismaBetterSqlite3({
      url: env.DATABASE_URL,
    });

    const prisma = new PrismaClient({ adapter });

    fastify.decorate("db", prisma);

    fastify.addHook("onClose", async () => {
      await prisma.$disconnect();
    });
  },
  {
    name: "db-plugin",
  },
);
