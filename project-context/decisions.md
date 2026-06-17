# Decisões Arquiteturais — Legal SaaS Platform

## ADR-001: MySQL vs PostgreSQL

**Data**: 2024-01  
**Contexto**: Escolha de banco de dados relacional para multi-tenancy com dados jurídicos sensíveis.  
**Opções Consideradas**: MySQL 8.0, PostgreSQL 15, PlanetScale (MySQL serverless)  
**Decisão**: MySQL 8.0  
**Consequências**: 
- Amplamente suportado em ambientes de hosting corporativo brasileiro
- Não há Row Level Security nativo (compensado por guards na camada de repositório)
- Prisma tem suporte completo para MySQL

## ADR-002: Multi-Tenancy via Row-Level Security na Aplicação

**Data**: 2024-01  
**Contexto**: Estratégia de isolamento de dados entre tenants.  
**Opções Consideradas**: (a) Banco separado por tenant, (b) Schema separado por tenant, (c) Row-level com `tenant_id`, (d) MySQL RLS  
**Decisão**: Row-level com `tenant_id` na camada de repositório  
**Consequências**:
- Simples operacionalmente (1 banco, 1 schema)
- Risco de vazamento de dados mitigado por testes de propriedade (Property 1)
- Escalável para centenas de tenants sem criação de schemas
- Requer disciplina dos repositórios (sempre filtrar por `tenant_id`)

## ADR-003: Auth.js v5 com JWT (Stateless)

**Data**: 2024-01  
**Contexto**: Estratégia de sessão para SaaS multi-tenant.  
**Opções Consideradas**: Auth.js com database sessions, Auth.js com JWT, custom JWT  
**Decisão**: Auth.js v5 com JWT HS256, 8h de expiração  
**Consequências**:
- Sessões stateless: não há round-trip ao banco em cada requisição para verificar sessão
- Invalidação imediata requer blacklist Redis (para desativação de usuário/tenant)
- JWT contém `userId`, `tenantId`, `role` — dados suficientes para RBAC sem DB lookup

## ADR-004: BullMQ para Operações Assíncronas

**Data**: 2024-01  
**Contexto**: DataJud, notificações, auditoria nunca devem bloquear resposta ao usuário.  
**Opções Consideradas**: BullMQ + Redis, AWS SQS, Bull (v3), pg-boss (Postgres)  
**Decisão**: BullMQ 5.x + Redis 7.x  
**Consequências**:
- Retry com backoff exponencial nativo
- Dashboard BullBoard para monitoramento visual
- Requer Redis como dependência adicional (compartilhado com cache de sessão)
- Dead letter queue via `removeOnFail: false`

## ADR-005: Argon2id para Hash de Senhas

**Data**: 2024-01  
**Contexto**: Algoritmo de hashing de senhas resistente a ataques modernos.  
**Opções Consideradas**: bcrypt, scrypt, Argon2id, PBKDF2  
**Decisão**: Argon2id  
**Consequências**:
- Vencedor do Password Hashing Competition 2015
- Resistente a ataques de GPU e side-channel
- Parâmetros: memória 64MB, iterações 3, parallelismo 4
- Mais lento que bcrypt em verificação (aceitável: ~300ms por verificação)

## ADR-006: fast-check para Property-Based Testing

**Data**: 2024-01  
**Contexto**: Biblioteca PBT para Vitest/TypeScript.  
**Opções Consideradas**: fast-check, jsverify, faker+manual  
**Decisão**: fast-check  
**Consequências**:
- Suporte nativo a TypeScript com tipos genéricos
- Integra com Vitest sem adaptador
- Shrinking automático de contraexemplos
- Mínimo 100 iterações por propriedade (configurável)

## ADR-007: CSP com Nonce (sem unsafe-inline)

**Data**: 2024-01  
**Contexto**: Proteção XSS em aplicação Next.js com Shadcn/UI.  
**Opções Consideradas**: CSP sem scripts inline, CSP com `unsafe-inline`, sem CSP  
**Decisão**: CSP com nonce gerado por requisição no Edge Middleware  
**Consequências**:
- Proteção máxima contra XSS: sem `unsafe-inline`
- Nonce injetado via `<script nonce="...">` pelo Next.js
- Requer configuração cuidadosa de third-party scripts
- Shadcn/UI não usa inline styles conflitantes com CSP

## ADR-009: SSRF Protection via Shared Validator

**Data**: 2025-07  
**Contexto**: DataJudClient precisava de proteção SSRF, e outras partes do sistema podem precisar da mesma lógica.  
**Opções Consideradas**: (a) Inline no DataJudClient, (b) Utility compartilhado, (c) Biblioteca externa  
**Decisão**: `src/shared/utils/ssrfValidator.ts` como utility compartilhado  
**Consequências**:
- Reutilizável em qualquer parte que faz requisições externas
- Bloqueia: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, 169.254.0.0/16, 100.64.0.0/10, ::1, fc00::/7, fe80::/10
- 54 testes unitários cobrem todos os casos limítrofes
- DataJudClient importa o validator e adiciona `redirect: 'error'` para prevenir redirect bypass

## ADR-010: Tenant Config Cache em Redis

**Data**: 2025-07  
**Contexto**: O tenantGuard precisava verificar o status do tenant a cada requisição, causando lookups repetidos.  
**Opções Consideradas**: (a) Sem cache (DB lookup sempre), (b) In-memory LRU cache, (c) Redis com TTL  
**Decisão**: Redis cache com TTL de 5 minutos (`src/infrastructure/cache/tenantCache.ts`)  
**Consequências**:
- Elimina ~95% dos lookups de tenant config em produção
- TTL de 5min é aceitável: bloqueio de tenant reflete em até 5min para novos logins
- Cache invalidado explicitamente ao bloquear/alterar plano do tenant
- Fail-silent: se Redis indisponível, lookup vai ao banco normalmente

## ADR-011: Circuit Breaker In-Memory para DataJud

**Data**: 2025-07  
**Contexto**: DataJud pode ficar indisponível; o sistema não deve ficar em loop de retries infinitos.  
**Opções Consideradas**: (a) Sem circuit breaker, (b) Redis-based, (c) In-memory  
**Decisão**: Circuit Breaker in-memory na classe DataJudClient (5 falhas → OPEN 30s)  
**Consequências**:
- Evita cascata de falhas quando DataJud está fora
- In-memory: não persiste entre reinicializações (aceitável para este caso)
- Estados: CLOSED → OPEN → HALF_OPEN → CLOSED
- Super_Admin recebe alerta após 60min de indisponibilidade via notificação

## ADR-008: Imutabilidade Física de Trilhas de Auditoria

**Data**: 2024-01  
**Contexto**: Garantir integridade de registros de auditoria.  
**Opções Consideradas**: (a) Nenhuma proteção, (b) Hash de integridade, (c) Append-only + hash  
**Decisão**: Append-only (sem UPDATE/DELETE permitido na camada de repositório) + hash SHA-256 no campo `payload_hash`  
**Consequências**:
- Repositório de auditoria não expõe métodos `update()` ou `delete()`
- Hash permite detectar adulteração se alguém modificar diretamente o banco
- Property 4 verifica essa invariante automaticamente
