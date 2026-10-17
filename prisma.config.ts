import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Client generation must work in build environments without database secrets.
    // Runtime and migration commands still receive DATABASE_URL from their environment.
    url: process.env.DATABASE_URL ?? "postgresql://unused:unused@localhost:5432/unused",
  },
});
