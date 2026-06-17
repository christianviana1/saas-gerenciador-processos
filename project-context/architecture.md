# Arquitetura — Legal SaaS Platform

## Stack

- **Framework**: Next.js 14 (App Router), React 18, TypeScript
- **UI**: Shadcn/UI + Tailwind CSS
- **Autenticação**: Auth.js v5 (NextAuth) — JWT HS256, 8h, TOTP RFC 6238
- **Banco de Dados**: MySQL 8.0 + Prisma ORM 5.x
- **Filas**: BullMQ 5.x + Redis 7.x
- **Validação**: Zod 3.x (100% dos inputs externos)
- **Testes**: Vitest 1.x + fast-check (PBT) + Playwright E2E
- **PWA**: next-pwa + Web Push VAPID
- **Segurança**: Argon2id (senhas), AES-256-GCM (dados sensíveis)

## Camadas

```
presentation/  → React components, Server Actions, API Routes
application/   → Use Cases (orquestração de domínio)
domain/        → Entities, Value Objects, Repository Interfaces, Domain Services
infrastructure/ → Prisma, BullMQ workers, Email, DataJud client, Redis cache
shared/        → Erros, Logger, Middleware, Utils
```

**Regra de Ouro**: Lógica de negócio NUNCA em componentes React. Componentes chamam Server Actions → Use Cases → Domain.

## Padrões

- **Multi-tenancy**: Row-level via `tenant_id` em cada query (garantido pelos repositories)
- **RBAC**: Avaliado antes de cada operação em `RBACEngine.enforce()`
- **Auditoria**: Fire-and-forget via BullMQ `audit` queue — não bloqueia resposta
- **DataJud**: 100% assíncrono via BullMQ `datajud-sync` queue — nunca bloqueia usuário
- **Circuit Breaker**: DataJud com 5 falhas → estado Aberto → 30s espera → Semi-Aberto

## Multi-Tenancy

Todo repositório recebe `tenantId` como parâmetro obrigatório.
Middleware `tenantGuard.ts` extrai `tenantId` do JWT e injeta no contexto.
Violação de tenant resulta em HTTP 403 + AuditLog automático.

## Segurança em Camadas

Rate Limit → Autenticação JWT → RBAC → Validação Zod → Sanitização → Repositório (tenant filter) → Auditoria
