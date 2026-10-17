# Environment Management (Local vs. Cloud)

This plan moves from a single manually-swapped `.env` file to a professional script-based system. You will be able to run `npm run dev:local` or `npm run dev:cloud` to switch environments instantly.

## User Review Required

> [!IMPORTANT]
> **Environment Files**: Once this is implemented, your original `.env` file will no longer be the primary way to switch. We will use `.env.local` and `.env.cloud`.
> **Prisma Commands**: You will need to use new scripts for Prisma commands (like `npm run prisma:push:cloud`) to ensure they use the correct database.

## Proposed Changes

### Environment Files

#### [NEW] [.env.local](file:///f:/code/agent-orchestration-app-backend/.env.local)
Dedicated file for your local database and RabbitMQ setup.

#### [NEW] [.env.cloud](file:///f:/code/agent-orchestration-app-backend/.env.cloud)
Dedicated file for your Prisma Postgres and Accelerate cloud setup.

### Integration

#### [MODIFY] [package.json](file:///f:/code/agent-orchestration-app-backend/package.json)
Add environment-aware scripts using `dotenv-cli`:
- `dev`: Alias for `dev:local`.
- `dev:local`: Runs the app with `.env.local`.
- `dev:cloud`: Runs the app with `.env.cloud`.
- `prisma:push:local`: Syncs schema to your local DB.
- `prisma:push:cloud`: Syncs schema to your cloud DB.

#### [MODIFY] [.gitignore](file:///f:/code/agent-orchestration-app-backend/.gitignore)
Ensure `.env.local` and `.env.cloud` are ignored so they aren't accidentally committed to Git.

### Documentation

#### [MODIFY] [PRISMA_GUIDE.md](file:///f:/code/agent-orchestration-app-backend/PRISMA_GUIDE.md)
Update the guide to reflect the new "Script-based" environment switching method.

---

## Verification Plan

### Manual Verification
- I will ask you to run `npm run dev:local` and monitor the console to see which database it connects to.
- I will verify that `package.json` scripts correctly use the `dotenv -e` flag.
