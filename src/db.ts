import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { Pool } from "pg";

const url = process.env.DATABASE_URL || "";
const isAccelerate = url.startsWith("prisma");

const prisma = isAccelerate
  ? new PrismaClient({ accelerateUrl: url })
  : new PrismaClient({
      adapter: new PrismaPg(new Pool({ connectionString: url })),
    });

export default prisma;
