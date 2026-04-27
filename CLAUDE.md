# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Development Commands
```bash
# Start development server with Nodemon
npm run dev

# Run production build
npm run build

# Run backend test suite
npm test

# Run tests in watch mode
npm test -- --watchAll

# Run CI-style tests
npm run test:ci

# Generate TypeScript types for Prisma
npx prisma generator

# Apply Prisma migrations
npx prisma migrate dev

# Inspect database schema
npx prisma introspect

# Run RabbitMQ consumer worker
queue "${QUEUE_NAME}"
```

## Code Architecture Overview
The backend system follows a TypeScript-based architecture using:

### Core Components
1. **src/**: Main application structure
   - **controllers/**: Handles HTTP routing and business logic
   - **services/**: Contains core business operations
   - **routes/**: Defines API endpoints
   - **models/**: TypeScript interfaces for data

2. **prisma/**: Database schema definitions
   - `schema.prisma`: Database model and relations
   - Prisma migrations handled via CLI commands

3. **config/**: Environment configuration (not explicitly visible in current listing)

### Dependencies
- **Node.js/Express**: REST API framework
- **Prisma ORM**: Type-safe database access
- **RabbitMQ**: Message queue system
- **Jest**: Test framework

### Deployment Stack
- **Docker**: Containerized deployment (docker-compose.yml)
- **Heroku**: PaaS deployment target (implicit from environment variables)
- **Railgun**: Reverse proxy (inferred from Opencode configuration)

## Environment Setup
1. Development
   ```bash
   # Import environment variables
   cp .env.cloud .env.local

   # Install dependencies
   npm install

   # Start services
   docker-compose up --build
   ```

2. Testing
   ```bash
   # Full test suite with coverage
   npm test -- --coverage

   # Single test suite execution
   npm test -- --interface integration
   ```

## Key Configuration Files
- `.env.local`: Overrides production settings for local use
- `docker-compose.yml`: Defines service container relationships
- `.vscode/`: Contains language-specific configuration
- `opencode.json`: Application runtime configuration

## Important Notes
- All services should be configured through environment variables, never through code
- RabbitMQ message processing is managed through separate worker instances
- Prisma migrations should be version-controlled with the `prisma` CLI
- Frontend assets should be version-controlled with Dockerfile configurations