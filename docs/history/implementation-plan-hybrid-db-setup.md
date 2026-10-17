# Enabling Hybrid Database Setup (Local & Cloud)

This plan enables you to switch between your local database (for offline/faster development) and your cloud database (for production-like testing).

## User Review Required

> [!IMPORTANT]
> **Docker Desktop**: You must have Docker Desktop installed and running on your Windows machine to use the local database option.

## Proposed Changes

### Configuration

#### [MODIFY] [.env](file:///f:/code/agent-orchestration-app-backend/.env)
Add a "Local Development" section with connection strings for the Docker container. I will comment these out by default so they don't break your current cloud connection.

### Database Client Initialization

#### [MODIFY] [db.ts](file:///f:/code/agent-orchestration-app-backend/src/db.ts)
Update the client to be **environment-aware**. It will:
1.  Check if the `DATABASE_URL` starts with `prisma`.
2.  If yes, it applies the `withAccelerate()` extension.
3.  If no (standard local PostgreSQL), it uses the standard Prisma client. 

### Documentation

#### [MODIFY] [PRISMA_GUIDE.md](file:///f:/code/agent-orchestration-app-backend/PRISMA_GUIDE.md)
Add a new section titled **"🏠 Local Development"** with instructions on starting Docker and swapping connection strings.

---

## Verification Plan

### Automated Tests
- Build verification (`npm run build`) to ensure the conditional logic is type-safe.

### Manual Verification
- I will ask you to start Docker and run a quick connectivity test once the changes are applied.
