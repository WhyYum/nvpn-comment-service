# nvpn-comment-service

Telegram automation system: admin bot (grammY) + MTProto accounts (GramJS) for parsing posts and sending comments.

## Setup

```powershell
npm install
Copy-Item .env.example .env
# заполните .env
```

## Development

```powershell
# PostgreSQL + Redis
docker compose up postgres redis -d

# Бот с hot reload (tsx watch)
npm run dev

# Workers с hot reload (в отдельных терминалах или одной командой)
npm run dev:workers
```

Схема БД создаётся автоматически при старте (`bootstrap-schema`, как в nvpn-bot-service). Prisma не используется.

## Production

```powershell
npm run build
npm run start
npm run start:workers
```

Docker:

```powershell
docker compose up -d --build
```

## Stack

- Node.js 20+, TypeScript (ESM)
- grammY + @grammyjs/conversations
- teleproto (GramJS) для MTProto
- Drizzle ORM + postgres.js
- PostgreSQL, Redis (BullMQ retry queue)
- Pino logging, Zod env validation
