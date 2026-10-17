# TypeScript Skill & Best Practices

This document outlines the strict rules and guidelines for writing TypeScript code in this project, particularly when dealing with Prisma models. All future tasks must adhere to these standards to ensure type safety, readability, and maintainability.

## 1. Avoid `any` at All Costs
Never use `any` or `as any` to bypass the TypeScript compiler. If a type is complex or seemingly incorrect, investigate the underlying cause (e.g., outdated generated types) instead of opting for an easy escape hatch. 

## 2. Explicit Interfaces for Prisma Relations
When querying Prisma with `include` statements, Prisma generates long, unreadable inline types (like `{ skills: { ... }[]; resources: { ... }[]; } & { ... }`). 

**Rule:** Do not rely on or hover these messy inline types. Instead, explicitly define and export clean TypeScript interfaces that extend the base Prisma models.

**Example:**
```typescript
import { Agent, Skill, MCPResource } from '@prisma/client';

// ❌ BAD: Letting TypeScript infer a massive inline intersection type
const agent = await prisma.agent.findUnique({ include: { skills: true } });

// ✅ GOOD: Define an explicit interface and cast the result
export interface AgentWithRelations extends Agent {
  skills: Skill[];
  resources: MCPResource[];
}

const agent = await prisma.agent.findUnique({
  include: { skills: true, resources: true }
}) as AgentWithRelations | null;
```

## 3. Strongly Type `Prisma.JsonValue`
Prisma treats JSON columns as a generic `Prisma.JsonValue`. Do not leave them as generic objects or cast them to `any`. Always define an interface for the expected JSON structure and cast it appropriately.

**Example:**
```typescript
interface AgentConfig {
  apiKey?: string;
  [key: string]: unknown;
}

// ✅ GOOD: Cast to the specific interface
const config = agent.config as AgentConfig | null;
```

## 4. Catch Block Typing
In `try...catch` blocks, always use `unknown` for errors instead of `any`, and check if the error is an instance of `Error` before accessing its properties.

**Example:**
```typescript
try {
  // ...
} catch (error: unknown) {
  const err = error instanceof Error ? error : new Error(String(error));
  console.error(err.message);
}
```

## 5. Keep Prisma Types Synced
If a property clearly exists in `schema.prisma` but TypeScript complains that it "does not exist on type", it usually means the generated client is outdated. Do not resort to `any`. 
Regenerate the types using the correct environment variables:
```powershell
npx dotenv -e .env.local -- npx prisma generate
```
