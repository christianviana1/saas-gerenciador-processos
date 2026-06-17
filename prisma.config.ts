// prisma.config.ts — Prisma ORM v7 configuration
// Reference: https://www.prisma.io/docs/orm/reference/prisma-config-reference
//
// USAGE BEFORE npm install:
//   npx prisma validate --config=prisma.config.ts
//
// USAGE AFTER npm install (recommended):
//   Replace the export below with the typed version:
//   import "dotenv/config";
//   import { defineConfig, env } from "prisma/config";
//   export default defineConfig({ ... datasource: { url: env("DATABASE_URL") } });

export default {
  schema: "src/infrastructure/database/prisma/schema.prisma",
  migrations: {
    path: "src/infrastructure/database/prisma/migrations",
    seed: "tsx src/infrastructure/database/prisma/seed.ts",
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
};
