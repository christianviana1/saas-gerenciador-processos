# Database — Legal SaaS Platform

## Banco: MySQL 8.0+ via Prisma ORM 5.x

## Tabelas

| Tabela | Propósito | Mutável? |
|---|---|---|
| `tenants` | Escritórios de advocacia (unidades de isolamento) | Sim |
| `users` | Usuários com soft delete | Sim |
| `processes` | Processos judiciais com soft delete | Sim |
| `court_history` | Histórico de tribunais — **APPEND-ONLY** | Não |
| `tasks` | Tarefas Kanban com soft delete | Sim |
| `task_history` | Histórico de movimentações de status — **APPEND-ONLY** | Não |
| `audit_logs` | Trilha de auditoria — **APPEND-ONLY** | Não |
| `notifications` | Notificações in-app (TTL 90 dias) | Sim (readAt) |
| `user_notification_preferences` | Preferências por canal por tipo | Sim |
| `invitation_tokens` | Tokens de convite (72h TTL) | Sim (usedAt/revokedAt) |
| `consent_records` | Registros de consentimento LGPD | Não |
| `datajud_syncs` | Histórico de sincronizações DataJud | Sim (status) |

## Índices Críticos

- `(tenant_id)` em todas as tabelas com dados de tenant
- `(tenant_id, status)` em `processes` e `tasks`
- `(cnj_number, tenant_id)` UNIQUE em `processes`
- `(email, tenant_id)` UNIQUE em `users`
- `(tenant_id, user_id)` em `audit_logs`
- `(assignee_user_id, due_date)` em `tasks`
- `(expires_at)` em `invitation_tokens` e `notifications`

## Estratégia de Multi-Tenancy

**Row-Level Security via aplicação** (não via MySQL RLS):
- Todos os repositories filtram por `tenantId` como parâmetro obrigatório
- Nenhuma query direta ao Prisma fora dos repositories
- Testes de propriedade (Property 1) verificam isolamento automaticamente

## Campos Criptografados

- `users.mfa_secret` → AES-256-GCM (chave em variável de ambiente)
- `invitation_tokens.token` → armazenado como hash SHA-256 no banco (valor real enviado por email)

## Retenção de Dados

- `audit_logs`: mínimo 5 anos (requisito legal)
- `notifications`: 90 dias (campo `expires_at`)
- `invitation_tokens`: limpeza automática após expiração + uso
- Dados de usuários inativos: anonimização após 5 anos (LGPD)

## Migrações

Gerenciadas pelo Prisma Migrate. Toda migration deve:
1. Ser testada em ambiente de staging antes de produção
2. Ser reversível quando possível
3. Incluir índices no mesmo migration que cria a tabela
