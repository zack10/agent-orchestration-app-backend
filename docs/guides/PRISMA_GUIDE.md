# Prisma Usage Guide - Agent Orchestration Backend

This guide explains how to use Prisma to manage the database for your Agent Orchestration application.

---

## 🚀 Quick Start: Management
For this project, we use **Prisma Postgres** with **Accelerate** for high performance.

### Essential Scripts
| Command | Environment | Action |
| :--- | :--- | :--- |
| `npm run dev:local` | 🏠 Local | Starts the server using your local database. |
| `npm run dev:cloud` | ☁️ Cloud | Starts the server using Prisma Postgres Cloud. |
| `npm run prisma:push:local` | 🏠 Local | Syncs schema to your local database. |
| `npm run prisma:push:cloud` | ☁️ Cloud | Syncs schema to your cloud database. |

---

## 📂 Project Structure
- [**`prisma/schema.prisma`**](file:///prisma/schema.prisma): The "Source of Truth" for your data models.
- [**`.env.local`**](file:///../.env.local): Connection strings for local development.
- [**`.env.cloud`**](file:///../.env.cloud): Connection strings for cloud development.
- [**`src/db.ts`**](file:///../src/db.ts): The smart Prisma Client that detects the protocol.

---

## 🛠 How to Modify the Database
If you want to add a new field:

1.  Open [**`prisma/schema.prisma`**](file:///prisma/schema.prisma) and add the field.
2.  Update both environments:
    ```powershell
    npm run prisma:push:local
    npm run prisma:push:cloud
    ```

---

## 💻 Coding Examples
You can find real examples in [**`agentController.ts`**](file:///../src/controllers/agentController.ts).

### 1. Fetching Data (Read)
```typescript
import prisma from '../db';

// Get an agent by ID and include their skills
const agent = await prisma.agent.findUnique({
  where: { id: "some-id" },
  include: { skills: true }
});
```

---

## 🛡 Security & Best Practices
- **Security**: `.env.*` files are ignored in [**.gitignore**](file:///../.gitignore).
- **Type Safety**: Your client is re-generated automatically by the `push` scripts.

---

## 🏠 Environment Management
You no longer need to manually edit `.env` to switch. Just use the scripts!

### Running Locally
1. Ensure Docker is running.
2. `docker-compose up -d`
3. `npm run dev:local`

### Running on Cloud
1. `npm run dev:cloud`

---

## 🔍 Viewing your Data
To see your data in a web UI:
1. **Local**: `npm run prisma:push:local` (if not done) then `npx prisma studio`.
2. **Cloud**: `npm run prisma:push:cloud` (if not done) then `npx prisma studio`.
