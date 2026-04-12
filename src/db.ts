import { PrismaClient } from '@prisma/client';
import { withAccelerate } from '@prisma/extension-accelerate';

const url = process.env.DATABASE_URL || '';
const isAccelerate = url.startsWith('prisma');

const prisma = isAccelerate 
  ? new PrismaClient().$extends(withAccelerate()) 
  : new PrismaClient();

export default prisma;
