# API Contracts — Legal SaaS Platform

## Convenções

- Base URL: `/api`
- Auth: `Authorization: Bearer <jwt>` em todas as rotas autenticadas
- Content-Type: `application/json`
- IDs: CUID format
- Timestamps: ISO 8601 UTC
- Paginação: `?page=1&limit=20` (máx 50 para listas, 100 para auditoria)

## Formato de Erro Padrão

```json
{
  "error": {
    "code": "VAL_001",
    "message": "Dados de entrada inválidos",
    "details": { "field": ["mensagem de erro"] },
    "requestId": "req_..."
  }
}
```

## Códigos de Status

| Status | Uso |
|---|---|
| 200 | GET, PATCH, PUT bem-sucedidos |
| 201 | POST — recurso criado |
| 204 | DELETE bem-sucedido |
| 400 | JSON malformado |
| 401 | Token inválido/expirado |
| 403 | RBAC negado / tenant cruzado |
| 404 | Recurso não encontrado no tenant |
| 409 | Conflito (CNJ duplicado, email duplicado) |
| 422 | Validação Zod falhou |
| 429 | Rate limit excedido |
| 500 | Erro interno |
| 503 | Dependência indisponível |

## Endpoints

### Autenticação
- `POST /api/auth/login` — Login com email/senha
- `POST /api/auth/mfa/verify` — Verificar código TOTP
- `POST /api/auth/mfa/setup` — Configurar MFA
- `DELETE /api/auth/session` — Logout
- `GET /api/auth/session` — Dados da sessão atual

### Processos
- `GET /api/processos` — Listar (filtros: status, responsável, tribunal, tags, período)
- `POST /api/processos` — Criar (body: CreateProcessSchema)
- `GET /api/processos/:id` — Detalhes
- `PATCH /api/processos/:id` — Atualizar
- `DELETE /api/processos/:id` — Exclusão lógica
- `GET /api/processos/:id/historico` — Court History
- `POST /api/processos/:id/sync` — Forçar sync DataJud

### Tarefas
- `GET /api/tarefas` — Listar (filtros: status, prioridade, responsável, vencimento)
- `POST /api/tarefas` — Criar
- `PATCH /api/tarefas/:id` — Atualizar
- `PATCH /api/tarefas/:id/status` — Mover status Kanban
- `DELETE /api/tarefas/:id` — Exclusão lógica

### Usuários
- `GET /api/usuarios` — Listar usuários do tenant
- `POST /api/usuarios/convite` — Criar convite (body: InviteUserSchema)
- `DELETE /api/usuarios/convite/:id` — Revogar convite
- `PATCH /api/usuarios/:id/status` — Ativar/desativar
- `PATCH /api/usuarios/:id/papel` — Mudar papel (RBAC: não pode elevar acima do próprio)

### Convite (público)
- `GET /convite/:token` — Verificar token de convite
- `POST /convite/:token/ativar` — Ativar conta (body: ActivateAccountSchema)

### Notificações
- `GET /api/notificacoes` — Listar notificações (paginado, 100 mais recentes)
- `PATCH /api/notificacoes/:id/lida` — Marcar como lida
- `PATCH /api/notificacoes/todas-lidas` — Marcar todas como lidas
- `GET /api/notificacoes/preferencias` — Preferências por canal
- `PUT /api/notificacoes/preferencias` — Atualizar preferências

### Auditoria
- `GET /api/auditoria` — Logs com filtros (usuário, ação, período, recurso)

### Admin (Super_Admin)
- `GET /api/admin/tenants` — Listar tenants
- `PATCH /api/admin/tenants/:id/status` — Bloquear/reativar tenant
- `PATCH /api/admin/tenants/:id/plano` — Alterar plano

### Sistema
- `GET /api/health` — Health check (público, sem auth)

## Schemas Zod Chave

Ver `src/shared/schemas/` para definições completas de:
- `CreateProcessSchema`, `ProcessFiltersSchema`
- `CreateTaskSchema`, `MoveTaskStatusSchema`
- `InviteUserSchema`, `ActivateAccountSchema`
- `AuditFiltersSchema`
