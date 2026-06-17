# Implementation Plan: Plataforma Jurídica SaaS Multi-Tenant

## Overview

Plano de implementação incremental da plataforma jurídica SaaS multi-tenant construída com Next.js 14 (App Router), TypeScript, Prisma ORM (MySQL), Auth.js v5, BullMQ, Shadcn/UI e Tailwind CSS. Cada tarefa constrói sobre as anteriores, garantindo que nenhum código fique órfão sem integração. A sequência segue a ordem definida no Requirement 17.5.

## Tasks

- [x] 1. Configurar estrutura do projeto e infraestrutura base
  - Inicializar projeto Next.js 14 com App Router e TypeScript strict mode
  - Instalar e configurar todas as dependências: Shadcn/UI, Tailwind CSS, Prisma, Auth.js v5, BullMQ, Zod, fast-check, Vitest, Playwright, Argon2, otplib, web-push, pino
  - Criar estrutura de pastas: `src/app`, `src/modules`, `src/domain`, `src/application`, `src/infrastructure`, `src/shared`, `tests/unit`, `tests/integration`, `tests/property`, `tests/e2e`, `tests/security`
  - Configurar `vitest.config.ts` com coverage thresholds (80% geral, 100% funções de domínio críticas), `playwright.config.ts` e `tsconfig.json` com path aliases (`@/`)
  - Criar `.env.example` com todas as variáveis necessárias: `DATABASE_URL`, `REDIS_HOST/PORT/PASSWORD`, `NEXTAUTH_SECRET`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `AES_ENCRYPTION_KEY`, `SMTP_*`
  - Criar `tests/setup.ts` com configuração global do Vitest
  - _Requirements: 17.1, 17.3, 16.1_


- [x] 2. Implementar schema Prisma e primeira migration
  - [x] 2.1 Criar `src/infrastructure/database/prisma/schema.prisma` com todos os modelos: Tenant, User, Process, CourtHistory, Task, TaskHistory, AuditLog, Notification, UserNotificationPreference, InvitationToken, ConsentRecord, DataJudSync
    - Incluir todos os enums: TenantPlan, TenantStatus, UserRole, UserStatus, ProcessStatus, TaskPriority, TaskStatus, NotificationType, DataJudSyncStatus
    - Definir todos os índices compostos críticos: `(tenantId)`, `(tenantId, status)`, `(cnjNumber, tenantId)` UNIQUE, `(email, tenantId)` UNIQUE, `(assigneeUserId, dueDate)`, `(expiresAt)`
    - _Requirements: 1.1, 1.7, 6.2, 6.3, 8.2, 9.2, 3.2, 18.4_

  - [x] 2.2 Executar `prisma migrate dev` para criar a migration inicial e gerar o Prisma Client
    - Criar `src/infrastructure/database/prisma/seed.ts` com dados de seed: 1 Super_Admin tenant + usuário SUPER_ADMIN
    - _Requirements: 17.2_


- [x] 3. Implementar camada de domínio: Value Objects e serviços de domínio
  - [x] 3.1 Criar `src/domain/value-objects/CnjNumber.ts` com validação do padrão `NNNNNNN-DD.AAAA.J.TT.OOOO` via regex e método `CnjNumber.parse(str)`
    - Lançar `ValidationError` com mensagem descritiva para formatos inválidos
    - _Requirements: 6.1, 16.2_

  - [x]* 3.2 Escrever property test para `CnjNumber` (Property 3)
    - **Property 3: Validação do Formato CNJ_Number**
    - Gerar strings válidas com `fc.tuple` combinando segmentos numéricos corretos e verificar que `CnjNumber.parse()` não lança
    - Gerar strings inválidas com `fc.string().filter(...)` e verificar que `CnjNumber.parse()` lança `ValidationError`
    - **Validates: Requirements 6.1, 16.6**
    - _Arquivo: `tests/property/cnjValidator.property.test.ts`_

  - [x] 3.3 Criar `src/domain/value-objects/TaskStatus.ts` e `TenantId.ts` encapsulando enums e lógica de transição de status válida
    - _Requirements: 9.1, 1.1_

  - [x] 3.4 Criar `src/domain/services/HashDetector.ts` com método `computeHash(payload: object): string` usando SHA-256 (Node.js `crypto`)
    - _Requirements: 7.3_

  - [x]* 3.5 Escrever property test para `HashDetector` (Property 5)
    - **Property 5: Idempotência do Hash_Detector**
    - Verificar que `computeHash(payload) === computeHash(payload)` para qualquer payload JSON
    - Verificar que payloads distintos (JSON.stringify diferente) produzem hashes distintos
    - **Validates: Requirements 7.3, 16.6**
    - _Arquivo: `tests/property/hashDetector.property.test.ts`_


  - [x] 3.6 Criar `src/domain/services/RBACEngine.ts` com tipos `Role`, `Action`, interface `IRBACEngine`, métodos `can(context, action): boolean` e `enforce(context, action): void`
    - Implementar `PermissionMatrix.ts` com matriz estática de permissões por papel
    - Implementar validação de hierarquia de papéis: READ_ONLY_USER(1) < INTERN(2) < LEGAL_ASSISTANT(3) < LAWYER(4) < OFFICE_ADMIN(5) < SUPER_ADMIN(6)
    - _Requirements: 2.1, 2.2, 2.4, 2.8_

  - [x]* 3.7 Escrever property test para `RBACEngine` — bloqueio de elevação de privilégio (Property 7)
    - **Property 7: RBAC — Bloqueio de Elevação de Privilégio**
    - Para qualquer usuário com hierarquia H tentando atribuir papel H' ≥ H, `can()` deve retornar `false` e `enforce()` deve lançar `ForbiddenError`
    - **Validates: Requirements 2.8, 16.8**
    - _Arquivo: `tests/property/rbacPrivilegeEscalation.property.test.ts`_

  - [x] 3.8 Criar `src/domain/services/TokenGenerator.ts` com método `generateInvitationToken(): string` usando `crypto.randomBytes(32).toString('hex')`
    - _Requirements: 4.1_

  - [x]* 3.9 Escrever property test para `TokenGenerator` (Property 6)
    - **Property 6: Unicidade de Invitation_Token**
    - Gerar N ≥ 10.000 tokens e verificar que `new Set(tokens).size === N`
    - **Validates: Requirements 4.1, 16.6**
    - _Arquivo: `tests/property/tokenUniqueness.property.test.ts`_


  - [x] 3.10 Criar entidades de domínio em `src/domain/entities/`: `Process.ts`, `Task.ts`, `User.ts`, `Tenant.ts`, `AuditLog.ts` com tipos TypeScript e validações de negócio
    - Definir interfaces de repositório em `src/domain/repositories/`: `IProcessRepository.ts`, `ITaskRepository.ts`, `IUserRepository.ts`, `IAuditRepository.ts`
    - Cada interface de repositório deve receber `tenantId` como parâmetro obrigatório em todos os métodos
    - _Requirements: 1.7, 17.2_

- [x] 4. Checkpoint — Domínio e banco de dados
  - Garantir que todos os testes de propriedade do domínio passam: Properties 3, 5, 6, 7
  - Garantir que o schema Prisma é válido e a migration foi aplicada com sucesso
  - Perguntar ao usuário se há dúvidas antes de prosseguir para a autenticação


- [x] 5. Implementar segurança e infraestrutura de autenticação
  - [x] 5.1 Criar `src/infrastructure/security/Argon2Hash.ts` com métodos `hash(password: string): Promise<string>` e `verify(hash: string, password: string): Promise<boolean>` usando argon2 com salt de 16 bytes
    - _Requirements: 4.6_

  - [x]* 5.2 Escrever property test para `Argon2Hash` — round-trip de verificação (Property 9)
    - **Property 9: Hash de Senha — Round-Trip de Verificação**
    - Para qualquer senha válida, `verify(await hash(pwd), pwd)` deve retornar `true`
    - Para qualquer senha distinta, `verify(hash, outraSenha)` deve retornar `false`
    - O hash gerado nunca deve ser igual ao texto plano
    - **Validates: Requirements 4.6, 12.7**
    - _Arquivo: `tests/property/passwordHash.property.test.ts`_

  - [x] 5.3 Criar `src/infrastructure/security/AESEncryption.ts` com `encrypt(plaintext, key)` e `decrypt(ciphertext, key)` usando AES-256-GCM com IV aleatório de 16 bytes
    - Formato de saída: `iv:authTag:encrypted` em base64
    - _Requirements: 12.7, 4.6_

  - [x] 5.4 Criar `src/infrastructure/security/TOTPService.ts` usando `otplib` com `generateSecret()`, `generateQRUri()` e `verify(token, secret)`
    - _Requirements: 5.4, 12.8_

  - [x] 5.5 Criar `src/infrastructure/security/RateLimiter.ts` com sliding window algorithm usando Redis (ioredis)
    - Configurar limites: LOGIN_BY_IP (20/5min), LOGIN_BY_EMAIL (5/5min), API_BY_USER (300/min), API_BY_TENANT (2000/min), PUBLIC (100/min)
    - Configurar lockout de 15 minutos após 5 falhas de login pelo mesmo email
    - _Requirements: 5.5, 5.6, 12.4_

  - [x] 5.6 Criar `src/infrastructure/security/CSRFProtection.ts` com double-submit cookie token
    - _Requirements: 12.3_


- [x] 6. Implementar autenticação com Auth.js v5
  - [x] 6.1 Configurar Auth.js v5 em `src/app/api/auth/[...nextauth]/route.ts` com strategy JWT HS256, expiração de 8 horas e regeneração de session ID após login
    - Implementar `CredentialsProvider` que valida email/senha com Argon2Hash e retorna `{ userId, tenantId, role }` no token
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 6.2 Implementar `src/application/auth/AuthenticateUseCase.ts` orquestrando: verificação de lockout → Argon2Hash.verify → verificação de MFA → emissão de JWT + auditoria
    - Integrar com `RateLimiter` e registrar falhas no Audit_Service via fila assíncrona
    - _Requirements: 5.1, 5.4, 5.5, 3.7_

  - [x] 6.3 Implementar `src/application/auth/SetupMFAUseCase.ts` para gerar secret TOTP, criptografar com AES-256 e armazenar em `User.mfaSecret`
    - Criar `src/app/(auth)/mfa/page.tsx` com QR Code e formulário de verificação TOTP
    - _Requirements: 5.4, 12.8_

  - [x] 6.4 Criar páginas de autenticação: `src/app/(auth)/login/page.tsx` com formulário de login (email + senha + TOTP condicional) usando Shadcn/UI e Server Actions
    - Implementar `src/modules/auth/actions/loginAction.ts` e `mfaAction.ts`
    - _Requirements: 5.1, 5.4_

  - [x]* 6.5 Escrever testes de integração para os fluxos de autenticação
    - Login com credenciais válidas → token JWT emitido
    - Login com senha inválida → 401 + audit log
    - Login após 5 falhas → 429 lockout por 15 minutos
    - Login com MFA habilitado sem TOTP → rejeição
    - Token expirado → 401 redirecionamento para login
    - _Requirements: 5.1, 5.2, 5.5, 16.3_


- [x] 7. Implementar middleware de multi-tenancy, RBAC e segurança
  - [x] 7.1 Criar `src/shared/middleware/tenantGuard.ts` que extrai `tenantId` do JWT, injeta no contexto da requisição e retorna HTTP 403 + auditoria ao detectar `tenantId` cruzado
    - _Requirements: 1.2, 1.3_

  - [x] 7.2 Criar `middleware.ts` (Next.js Edge Middleware) aplicando: autenticação JWT, `tenantGuard`, rate limiting e `securityHeaders` em todas as rotas autenticadas
    - _Requirements: 5.9, 12.1_

  - [x] 7.3 Criar `src/shared/middleware/securityHeaders.ts` com todos os headers obrigatórios: HSTS, X-Content-Type-Options, X-Frame-Options: DENY, Referrer-Policy, Permissions-Policy, CSP com nonce por requisição sem `unsafe-inline`
    - Aplicar no `next.config.mjs` e no middleware
    - _Requirements: 5.8, 12.2, 12.9_

  - [x] 7.4 Criar `src/shared/errors/AppError.ts` com hierarquia completa: `AuthenticationError`, `ForbiddenError`, `TenantIsolationError`, `ValidationError`, `NotFoundError`, `ConflictError`
    - Criar handler global de erros para Server Actions e API Routes com formato JSON padronizado (`code`, `message`, `details`, `requestId`)
    - _Requirements: 1.3, 2.3_

  - [x]* 7.5 Escrever testes de segurança para isolamento de tenant (Property 1)
    - **Property 1: Isolamento de Tenant**
    - Criar dados em tenant A e tenant B, autenticar como usuário do tenant A, verificar que consultas retornam apenas registros com `tenantId === A`
    - Testar acesso direto a recurso de tenant B → HTTP 403
    - **Validates: Requirements 1.2, 1.3, 1.7, 6.9**
    - _Arquivo: `tests/security/tenantIsolation.security.test.ts`_


- [x] 8. Implementar infraestrutura de filas BullMQ e Audit Service
  - [x] 8.1 Criar `src/infrastructure/queues/queues.ts` definindo as 4 filas BullMQ: `datajud-sync`, `notifications`, `audit`, `email` com configurações de retry/backoff/removeOn conforme design
    - Configurar conexão Redis com variáveis de ambiente
    - _Requirements: 3.3, 7.7, 10.3_

  - [x] 8.2 Criar `src/infrastructure/queues/workers/auditWorker.ts` que consome a fila `audit` e persiste `AuditLog` no banco via Prisma com concorrência 20
    - Incluir payload_hash SHA-256 em cada registro para verificação de integridade
    - _Requirements: 3.2, 3.3, 3.4_

  - [x] 8.3 Criar `src/application` → interface `IAuditService` e implementação `AuditServiceImpl` com método `log(event: AuditEvent): void` que enfileira no BullMQ (fire-and-forget, latência < 50ms)
    - _Requirements: 3.3, 3.1_

  - [x]* 8.4 Escrever property test para imutabilidade de AuditLog (Property 4)
    - **Property 4: Imutabilidade de Trilhas**
    - Após criar N registros de AuditLog, tentar UPDATE/DELETE e verificar que registros permanecem inalterados
    - Verificar que `payload_hash` calculado no momento da criação é idêntico ao hash recalculado posteriormente
    - Para CourtHistory: após operações sobre o processo, verificar que count de entradas ≥ N inicial
    - **Validates: Requirements 3.4, 8.3, 9.9**
    - _Arquivo: `tests/property/auditImmutability.property.test.ts`_


- [x] 9. Implementar repositórios Prisma e use cases de gestão de usuários
  - [x] 9.1 Criar implementações Prisma dos repositórios em `src/infrastructure/database/repositories/`: `ProcessRepository.ts`, `TaskRepository.ts`, `UserRepository.ts`, `AuditRepository.ts`
    - Todo método deve receber `tenantId` e aplicar `WHERE tenant_id = tenantId` obrigatoriamente
    - Implementar `findMany` com paginação (offset/limit, máx 50 para processos/tarefas, 100 para auditoria)
    - _Requirements: 1.7, 6.6, 18.6_

  - [x] 9.2 Criar `src/application/usuarios/InviteUserUseCase.ts`: validar permissão RBAC (user:invite), verificar email não duplicado no tenant, gerar token com `TokenGenerator`, persistir `InvitationToken` com `expiresAt = now + 72h`, enfileirar email
    - _Requirements: 4.1, 4.2, 4.7_

  - [x] 9.3 Criar `src/application/usuarios/ActivateUserUseCase.ts`: buscar token válido (não expirado, não usado, não revogado), validar política de senha com Zod `ActivateAccountSchema`, hash Argon2id, criar usuário, marcar token como `usedAt`, criar `ConsentRecord`
    - _Requirements: 4.3, 4.4, 4.5, 4.6, 13.1_

  - [x] 9.4 Criar `src/application/usuarios/DeactivateUserUseCase.ts`: verificar RBAC, desativar usuário, invalidar todas as sessões ativas em até 30 segundos, registrar auditoria
    - _Requirements: 4.8, 4.9_

  - [x] 9.5 Criar API Routes para usuários: `src/app/api/usuarios/route.ts` (GET lista, POST convite), `src/app/api/usuarios/[id]/status/route.ts` (PATCH), `src/app/api/usuarios/[id]/papel/route.ts` (PATCH), `src/app/api/usuarios/convite/[id]/route.ts` (DELETE revogação)
    - Criar rota pública: `src/app/(auth)/convite/[token]/page.tsx` e action de ativação
    - _Requirements: 4.2, 4.3, 4.7, 4.8, 2.7_

  - [x]* 9.6 Escrever testes de integração para fluxo de convite
    - Convite criado → token de uso único → ativação cria usuário e invalida token → token reutilizado retorna 400
    - Convite expirado → 400 com mensagem descritiva
    - Revogação de convite pendente → token invalidado imediatamente
    - _Requirements: 4.1, 4.3, 4.4, 4.7, 16.3_


- [ ] 10. Implementar gestão de processos judiciais
  - [x] 10.1 Criar `src/application/processos/CreateProcessUseCase.ts`: RBAC (process:create), `CnjNumber.parse()` para validação, verificar unicidade `(cnjNumber, tenantId)`, criar processo com `tenantId` imutável, enfileirar `datajud-sync initial-sync`, registrar auditoria
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.8, 6.9_

  - [x] 10.2 Criar `src/application/processos/UpdateProcessUseCase.ts` e `ListProcessesUseCase.ts`
    - `ListProcessesUseCase`: aplicar filtros por status, responsável, tribunal, tags, período; paginação máx 50 registros
    - `UpdateProcessUseCase`: RBAC (process:update), verificar `tenantId` imutável, registrar auditoria
    - _Requirements: 6.5, 6.6, 6.9_

  - [-] 10.3 Criar API Routes de processos: `src/app/api/processos/route.ts` (GET, POST), `src/app/api/processos/[id]/route.ts` (GET, PATCH, DELETE), `src/app/api/processos/[id]/historico/route.ts` (GET), `src/app/api/processos/[id]/sync/route.ts` (POST)
    - DELETE implementa soft delete: `deletedAt = now()`, preserva histórico e auditoria
    - _Requirements: 6.6, 6.7, 8.4_

  - [x]* 10.4 Escrever property test para round-trip de serialização de Process (Property 2)
    - **Property 2: Round-Trip de Serialização de Process**
    - Para qualquer objeto Process com campos obrigatórios preenchidos com valores aleatórios, `JSON.parse(JSON.stringify(process))` deve produzir objeto equivalente campo a campo
    - Nenhum campo deve ser perdido, truncado ou corrompido
    - **Validates: Requirements 16.6, 6.2, 6.3**
    - _Arquivo: `tests/property/processSerialization.property.test.ts`_

  - [x]* 10.5 Escrever testes de integração para gestão de processos
    - Criar processo com CNJ válido → 201 + sync enfileirado
    - Criar processo com CNJ duplicado no mesmo tenant → 409
    - Listar processos com filtros → paginação correta
    - Exclusão lógica preserva histórico e auditoria
    - _Requirements: 6.1, 6.6, 6.7, 6.8, 16.3_


- [ ] 11. Implementar integração com DataJud e histórico de tribunais
  - [x] 11.1 Criar `src/infrastructure/datajud/DataJudClient.ts` com validação SSRF (blocklist RFC 1918), cliente HTTP para `https://api-publica.datajud.cnj.jus.br`, validação/sanitização do payload com Zod schemas em `src/infrastructure/datajud/schemas/`
    - Implementar Circuit Breaker: 5 falhas consecutivas → estado Aberto → 30s espera → Semi-Aberto
    - _Requirements: 7.7, 7.9, 12.5_

  - [-] 11.2 Criar `src/infrastructure/queues/workers/datajudSyncWorker.ts` que consome `datajud-sync` com concorrência 5
    - Job `initial-sync`/`periodic-sync`/`forced-sync`: buscar processo por `(id, tenantId)`, chamar `DataJudClient`, usar `HashDetector.computeHash()`, comparar com `datajudHash` armazenado
    - Se hash diferente: UPDATE processo, INSERT CourtHistory com `datajudPayload`, enfileirar notificações para responsáveis
    - Backoff exponencial: 1, 2, 4, 8 minutos para erros HTTP 4xx/5xx
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 11.3 Criar `src/application/processos/SyncDataJudUseCase.ts` para sync forçado pelo usuário
    - Atualizar `lastDatajudSyncAt` em cada sync bem-sucedido
    - Alertar Super_Admin via notificação quando DataJud indisponível > 60 minutos consecutivos
    - _Requirements: 7.6, 7.8_

  - [x] 11.4 Configurar job cron periódico em `src/infrastructure/queues/`: `periodic-sync` com `repeat: { pattern: '0 2 * * *' }` e `jobId` único para evitar duplicação
    - _Requirements: 7.2_

  - [x]* 11.5 Escrever testes de integração para o worker DataJud
    - Payload com hash diferente → atualiza processo, insere CourtHistory, dispara notificação
    - Payload com mesmo hash → nenhuma alteração no banco
    - Erro HTTP 500 → backoff exponencial, status RETRYING no DataJudSync
    - _Requirements: 7.3, 7.4, 7.5, 16.3_


- [x] 12. Checkpoint — Autenticação, multi-tenancy e processos
  - Garantir que todos os testes de integração de autenticação, convite, processos e DataJud passam
  - Verificar cobertura ≥ 80% nos módulos implementados até aqui
  - Perguntar ao usuário se há dúvidas antes de prosseguir para tarefas e notificações

- [ ] 13. Implementar gestão de tarefas (Kanban)
  - [x] 13.1 Criar `src/application/tarefas/CreateTaskUseCase.ts`: RBAC (task:create), validar `assigneeUserId` é usuário ativo do tenant, criar Task com `tenantId` obrigatório, disparar notificação imediata se prioridade URGENT e `dueDate` nos próximos 24h
    - _Requirements: 9.2, 9.3, 9.6_

  - [-] 13.2 Criar `src/application/tarefas/MoveTaskStatusUseCase.ts`: RBAC (task:update), validar transição de status (enum `TaskStatus`), inserir registro imutável em `TaskHistory` com `(taskId, fromStatus, toStatus, movedByUserId, movedAt)`
    - _Requirements: 9.4, 9.9_

  - [x] 13.3 Criar API Routes de tarefas: `src/app/api/tarefas/route.ts` (GET com filtros, POST), `src/app/api/tarefas/[id]/route.ts` (PATCH, DELETE), `src/app/api/tarefas/[id]/status/route.ts` (PATCH para movimento Kanban)
    - Filtros em GET: status, prioridade, responsável, período de vencimento
    - _Requirements: 9.1, 9.5, 9.7, 9.8_

  - [x]* 13.4 Escrever testes de integração para o Kanban de tarefas
    - Criar tarefa URGENT com dueDate < 24h → notificação disparada para assignee
    - Mover tarefa entre status → TaskHistory imutável criado
    - Intern tenta deletar tarefa → 403
    - Exclusão lógica preserva TaskHistory
    - _Requirements: 9.4, 9.6, 9.8, 9.9, 16.3_


- [ ] 14. Implementar sistema de notificações
  - [-] 14.1 Criar `src/infrastructure/email/EmailService.ts` com `sendEmail(to, subject, body)` via SMTP/Resend e templates HTML em `src/infrastructure/email/templates/` para: convite, notificação de processo, notificação de tarefa, alerta de conta bloqueada
    - _Requirements: 10.1, 10.5_

  - [x] 14.2 Criar `src/infrastructure/queues/workers/notificationWorker.ts` consumindo `notifications` com concorrência 10
    - Para cada notificação: buscar preferências do usuário (`UserNotificationPreference`), entregar pelos canais habilitados (in-app já persistido, email via `emailQueue`, push via `WebPushService`)
    - Retry de email: 3x com intervalo de 5 minutos
    - _Requirements: 10.2, 10.3, 10.5_

  - [x] 14.3 Criar `src/application/notificacoes/SendNotificationUseCase.ts`: persistir `Notification` com `expiresAt = now + 90d`, buscar preferências do usuário, enfileirar entrega multicanal
    - _Requirements: 10.3, 10.4, 10.8_

  - [x] 14.4 Criar API Routes de notificações: `src/app/api/notificacoes/route.ts` (GET lista das 100 mais recentes com badge count), `src/app/api/notificacoes/[id]/lida/route.ts` (PATCH marcar como lida)
    - Implementar polling a cada 30 segundos no cliente via React Query ou SWR
    - _Requirements: 10.6, 10.7_

  - [-] 14.5 Criar `src/app/api/usuarios/[id]/push-subscription/route.ts` (POST) para salvar subscription VAPID do usuário
    - Criar `src/infrastructure/push/WebPushService.ts` com `sendNotification(subscription, payload)`
    - _Requirements: 10.1, 11.4_

  - [x]* 14.6 Escrever testes de integração para o sistema de notificações
    - Notificação criada → entregue pelos canais configurados do usuário
    - Falha de email → 3 retries com 5 min de intervalo
    - Marcar como lida → badge decrementado
    - Notificações expiradas (> 90 dias) não retornadas na listagem
    - _Requirements: 10.3, 10.5, 10.7, 10.8, 16.3_


- [x] 15. Implementar painel Super_Admin e gestão de tenants
  - [x] 15.1 Criar use cases de gestão de tenants em `src/application/`: `CreateTenantUseCase.ts`, `BlockTenantUseCase.ts` (invalida sessões imediatamente), `ReactivateTenantUseCase.ts`, `UpdateTenantPlanUseCase.ts` (sem interromper sessões ativas)
    - _Requirements: 1.4, 1.5, 1.6_

  - [x] 15.2 Criar `src/app/admin/` com páginas protegidas para SUPER_ADMIN: listagem de tenants, detalhes do tenant, gestão de plano, bloqueio/reativação
    - Implementar `src/app/api/admin/tenants/` routes com RBAC exclusivo para SUPER_ADMIN
    - _Requirements: 1.4, 1.5, 1.6, 2.1_

  - [x] 15.3 Criar `src/app/api/auditoria/route.ts` com filtros: userId, action, resourceType, período (createdFrom/To), paginação máx 100
    - Office_Admin acessa apenas auditoria do seu tenant; Super_Admin acessa qualquer tenant
    - _Requirements: 3.5, 3.6_


- [ ] 16. Implementar interface React (App Router) — módulos principais
  - [-] 16.1 Criar layout autenticado `src/app/(platform)/layout.tsx` com sidebar, header com badge de notificações, e navegação usando Shadcn/UI e Tailwind CSS
    - Integrar polling de notificações (30s) e indicador visual de modo offline
    - _Requirements: 10.6, 11.3_

  - [x] 16.2 Criar `src/app/(platform)/processos/page.tsx` com listagem paginada de processos (filtros, paginação, indicador de desatualização > 48h) e `src/app/(platform)/processos/[id]/page.tsx` com detalhes e histórico de tribunais em ordem cronológica decrescente
    - Criar `src/app/(platform)/processos/novo/page.tsx` com formulário de criação validado via Zod
    - _Requirements: 6.6, 7.8, 8.4_

  - [x] 16.3 Criar `src/app/(platform)/tarefas/page.tsx` com Kanban Board (`src/modules/tarefas/components/KanbanBoard.tsx`) com colunas: "A Fazer", "Em Andamento", "Revisão", "Concluído"
    - Indicador visual para tarefas com `dueDate` vencido
    - Drag-and-drop ou botões de movimento de status entre colunas
    - _Requirements: 9.1, 9.5_

  - [-] 16.4 Criar `src/app/(platform)/configuracoes/page.tsx` com: gerenciamento de usuários do tenant, convites pendentes, preferências de notificação por canal por tipo de evento
    - _Requirements: 4.7, 10.4_

  - [-] 16.5 Criar `src/app/(platform)/notificacoes/page.tsx` com histórico das 100 notificações mais recentes e funcionalidade de marcar como lida
    - _Requirements: 10.7, 10.8_


- [ ] 17. Implementar PWA e Service Worker
  - [x] 17.1 Criar `public/manifest.json` com name, short_name, start_url, display: standalone, theme_color, orientation, icons em múltiplas resoluções (72 a 512px) e screenshots
    - _Requirements: 11.1, 11.7_

  - [x] 17.2 Criar `public/sw.js` com estratégias de cache: Cache-First para shell estático, Network-First (timeout 3s) para APIs, Stale-While-Revalidate para assets UI
    - Implementar página `public/offline.html` para modo offline
    - _Requirements: 11.2, 11.3_

  - [-] 17.3 Configurar `next-pwa` em `next.config.mjs` com geração automática do Service Worker em produção e detecção de atualização com prompt para o usuário (sem refresh forçado)
    - _Requirements: 11.5_

  - [x] 17.4 Implementar registro do Service Worker em `src/app/layout.tsx` e integração Web Push: gerar VAPID keys, criar `src/app/api/push/subscribe/route.ts` para salvar subscription, enviar push via `WebPushService` no `notificationWorker`
    - Implementar listener `push` e `notificationclick` no Service Worker para navegar ao recurso relacionado
    - _Requirements: 11.4, 10.9_


- [ ] 18. Implementar conformidade LGPD
  - [x] 18.1 Criar `src/app/(auth)/convite/[token]/page.tsx` exibindo Política de Privacidade e Termos de Uso antes da ativação, exigindo aceite explícito que persiste `ConsentRecord` com `(userId, tenantId, policyVersion, consentedAt, ipAddress, userAgent)`
    - _Requirements: 13.1, 13.2_

  - [-] 18.2 Criar `src/application/lgpd/ExportUserDataUseCase.ts`: coletar dados pessoais do usuário de todas as tabelas, serializar em JSON, disponibilizar para download em até 72h (via job BullMQ ou geração síncrona para dados pequenos)
    - _Requirements: 13.3_

  - [-] 18.3 Criar `src/application/lgpd/AnonymizeUserUseCase.ts`: substituir nome, email, IP por valores anonimizados, preservar registros de auditoria e histórico processual anonimizados, registrar evento de anonimização
    - _Requirements: 13.4_

  - [x] 18.4 Criar `src/app/(platform)/configuracoes/lgpd/page.tsx` com painel de gestão de consentimentos e requisições LGPD para Office_Admin; incluir link para exportação e exclusão de dados para usuários
    - _Requirements: 13.8_

  - [x] 18.5 Criar job cron BullMQ para verificação de usuários inativos há mais de 5 anos: enviar notificação prévia de 30 dias, depois disparar `AnonymizeUserUseCase`
    - _Requirements: 13.5_


- [ ] 19. Implementar observabilidade, health check e logger estruturado
  - [-] 19.1 Criar `src/shared/logger/logger.ts` usando `pino` com format JSON, campos obrigatórios: `timestamp`, `level`, `service`, `tenantId`, `userId`, `action`, `durationMs`, `statusCode`, `errorMessage`, `requestId`
    - Criar middleware de request logging para capturar duração e emitir alerta quando > 2000ms
    - _Requirements: 14.1, 14.2, 14.3_

  - [x] 19.2 Criar `src/app/api/health/route.ts` que retorna status de cada dependência: database (Prisma `$queryRaw SELECT 1`), redis (PING), email (config check), bullmq (queue counts) sem expor dados sensíveis
    - _Requirements: 14.4_

  - [x] 19.3 Implementar monitoramento de filas BullMQ: quando `pendingCount > 100` em qualquer fila, emitir log de alerta e notificação para Super_Admin
    - Registrar métricas de: tempo médio de resposta por endpoint, taxa de erros, jobs processados por fila, utilização do pool de conexões Prisma
    - _Requirements: 14.6, 14.7_

- [ ] 20. Implementar hardening de segurança
  - [-] 20.1 Criar `src/shared/middleware/rateLimitMiddleware.ts` integrando `RateLimiter` ao middleware Next.js para aplicar limites em todos os endpoints públicos e autenticados
    - _Requirements: 12.4_

  - [x] 20.2 Implementar validação de uploads: verificar tipo MIME, extensão (allowlist) e tamanho máximo de 10MB, rejeitar arquivos executáveis
    - _Requirements: 12.10_

  - [x] 20.3 Implementar validação SSRF em `DataJudClient` para todas as URLs externas, bloqueando endereços de rede interna (127.0.0.1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, link-local)
    - _Requirements: 12.5_

  - [x]* 20.4 Escrever testes de segurança automatizados
    - Injeção SQL em campos de busca via Prisma → 0 registros afetados indevidamente
    - XSS em campos de texto → output sanitizado pelo React, CSP bloqueia scripts inline
    - Requisição sem CSRF token → 403
    - Acesso a recurso de outro tenant (IDOR) → 403, zero dados vazados
    - Força bruta no login → lockout após 5 tentativas
    - SSRF: URL interna bloqueada → 400
    - _Requirements: 12.1, 12.2, 12.3, 12.5, 12.6, 16.5, 16.8_


- [x] 21. Implementar testes E2E com Playwright
  - [x] 21.1 Criar `tests/e2e/invite-and-login.spec.ts`: Office_Admin cria convite → usuário acessa link → define senha → login → dashboard
    - _Requirements: 4.1, 4.2, 4.3, 16.4_

  - [x] 21.2 Criar `tests/e2e/create-process.spec.ts`: login → criar processo com CNJ válido → confirmação 201 → CNJ inválido → erro de validação descritivo
    - _Requirements: 6.1, 6.2, 16.4_

  - [x] 21.3 Criar `tests/e2e/kanban-task.spec.ts`: login → criar tarefa → mover entre colunas Kanban → verificar TaskHistory criado
    - _Requirements: 9.1, 9.4, 16.4_

  - [x] 21.4 Criar `tests/e2e/mfa-setup.spec.ts`: login → configurar MFA → logout → login com TOTP correto → acesso concedido → login com TOTP inválido → 401
    - _Requirements: 5.4, 16.4_

  - [x] 21.5 Criar `tests/e2e/notification.spec.ts`: criar processo → aguardar DataJud sync mockado → verificar badge de notificação → marcar como lida → badge decrementado
    - _Requirements: 10.6, 10.7, 16.4_

  - [x] 21.6 Criar `tests/e2e/rbac-intern.spec.ts`: login como Intern → tentar deletar processo → HTTP 403 → criar tarefa "A Fazer" → sucesso → tentar alterar papel de usuário → HTTP 403
    - _Requirements: 2.3, 2.6, 9.8, 16.4_

- [x] 22. Checkpoint — Testes e cobertura
  - Executar suite completa: `npm run test:unit`, `npm run test:integration`, `npm run test:property`, `npm run test:security`
  - Verificar cobertura ≥ 80% linhas globais e 100% nas funções críticas de domínio (CnjNumber, HashDetector, RBACEngine, TokenGenerator, Argon2Hash)
  - Executar `npm run test:e2e` e garantir que todos os 6 cenários E2E passam
  - Perguntar ao usuário se há dúvidas antes de prosseguir para preparação de produção


- [x] 23. Preparação para produção
  - [x] 23.1 Configurar pipeline CI/CD em `.github/workflows/ci.yml`: services MySQL 8.0 + Redis 7, `prisma migrate deploy`, todos os test scripts, build Next.js, bloqueio de merge se cobertura < 80% ou qualquer teste falhar
    - _Requirements: 16.7_

  - [x] 23.2 Criar `src/app/api/health/route.ts` finalizado com verificação real de todas as dependências críticas
    - Criar `scripts/backup.sh` para backup diário às 02:00 UTC com criptografia AES-256, retenção de 30 dias diários e 12 meses semanais
    - _Requirements: 14.4, 15.1, 15.2, 15.3, 15.4_

  - [x] 23.3 Configurar cache de sessão e configuração de Tenant no Redis com TTL de 5 minutos para reduzir consultas ao banco
    - Criar `src/infrastructure/cache/RedisCache.ts` com `get(key)`, `set(key, value, ttlSeconds)`, `del(key)`
    - _Requirements: 18.5_

  - [x] 23.4 Atualizar `project-context/progress.md`, `project-context/decisions.md` e `project-context/checkpoint.json` com o estado final de implementação de todas as 12 fases
    - _Requirements: 17.3, 17.6_

- [x] 24. Checkpoint final — Validação completa do sistema
  - Garantir que todos os testes passam (unit, integration, property, security, e2e)
  - Verificar que a cobertura de código está ≥ 80% globalmente e 100% nas funções críticas
  - Garantir que o build de produção (`npm run build`) é concluído sem erros
  - Perguntar ao usuário se há dúvidas antes de considerar o projeto concluído


## Notes

- Tarefas marcadas com `*` são opcionais e podem ser puladas para um MVP mais rápido, porém são fortemente recomendadas para um sistema de nível corporativo com requisitos de segurança e auditoria jurídica
- Cada tarefa referencia requisitos específicos para rastreabilidade
- Os checkpoints garantem validação incremental antes de avançar para a próxima fase
- Property tests validam invariantes universais do sistema: isolamento de tenant (P1), serialização (P2), validação CNJ (P3), imutabilidade de trilhas (P4), hash detector (P5), unicidade de tokens (P6), RBAC (P7), preservação de Court_History (P8), hash de senha (P9)
- Todos os documentos de `project-context/` devem ser atualizados ao final de cada fase conforme Requirement 17.3
- A sequência de implementação segue a ordem obrigatória definida em Requirement 17.5


## Task Dependency Graph

```json
{
  "waves": [
    {
      "id": 0,
      "tasks": ["2.1", "3.1", "3.3", "3.8"]
    },
    {
      "id": 1,
      "tasks": ["2.2", "3.2", "3.4", "3.6", "7.4"]
    },
    {
      "id": 2,
      "tasks": ["3.5", "3.7", "3.9", "3.10", "5.1", "5.3", "5.4", "5.5", "5.6", "8.1"]
    },
    {
      "id": 3,
      "tasks": ["5.2", "6.1", "7.1", "7.3", "8.2", "9.1"]
    },
    {
      "id": 4,
      "tasks": ["6.2", "6.3", "7.2", "7.5", "8.3", "9.2", "9.3"]
    },
    {
      "id": 5,
      "tasks": ["6.4", "8.4", "9.4", "9.5", "10.1", "15.1"]
    },
    {
      "id": 6,
      "tasks": ["6.5", "9.6", "10.2", "11.1", "13.1", "15.2", "15.3"]
    },
    {
      "id": 7,
      "tasks": ["10.3", "10.4", "11.2", "13.2", "14.1", "16.1"]
    },
    {
      "id": 8,
      "tasks": ["10.5", "11.3", "11.4", "13.3", "14.2", "16.2"]
    },
    {
      "id": 9,
      "tasks": ["11.5", "13.4", "14.3", "14.4", "16.3", "17.1", "17.2", "18.1"]
    },
    {
      "id": 10,
      "tasks": ["14.5", "14.6", "16.4", "16.5", "17.3", "18.2", "18.3", "19.1", "20.1"]
    },
    {
      "id": 11,
      "tasks": ["17.4", "18.4", "18.5", "19.2", "19.3", "20.2", "20.3"]
    },
    {
      "id": 12,
      "tasks": ["20.4", "21.1", "21.2", "21.3", "21.4", "21.5", "21.6"]
    },
    {
      "id": 13,
      "tasks": ["23.1", "23.2", "23.3", "23.4"]
    }
  ]
}
```
