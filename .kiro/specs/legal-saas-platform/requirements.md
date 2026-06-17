# Requirements Document

## Introduction

Este documento descreve os requisitos funcionais e não funcionais da **Plataforma Jurídica SaaS Multi-Tenant**, um sistema de nível corporativo destinado a centenas de escritórios de advocacia simultâneos. A plataforma centraliza a gestão de processos judiciais, tarefas, usuários e comunicações, integrando-se ao DataJud para atualização automática de informações processuais. O sistema é construído com foco em segurança máxima, auditabilidade completa, conformidade com a LGPD e alta disponibilidade.

**Stack obrigatória:** Next.js (App Router) · React · TypeScript · Shadcn/UI · Tailwind CSS · PWA · MySQL · Prisma ORM · Zod · Auth.js (NextAuth) · BullMQ · Vitest · Playwright · Testing Library

---

## Glossary

- **Platform**: O sistema SaaS jurídico como um todo.
- **Super_Admin**: Usuário administrador da plataforma com acesso irrestrito a todos os tenants.
- **Tenant**: Unidade lógica de isolamento de dados correspondente a um escritório de advocacia.
- **Office_Admin**: Administrador de um Tenant específico.
- **Lawyer**: Advogado vinculado a um Tenant.
- **Legal_Assistant**: Assistente jurídico vinculado a um Tenant.
- **Intern**: Estagiário vinculado a um Tenant.
- **Read_Only_User**: Usuário com permissão exclusiva de leitura em um Tenant.
- **RBAC_Engine**: Componente responsável pela avaliação e aplicação de permissões baseadas em papéis.
- **Audit_Service**: Componente responsável por registrar trilhas de auditoria imutáveis.
- **Process**: Processo judicial cadastrado em um Tenant.
- **CNJ_Number**: Número único do processo no formato CNJ (NNNNNNN-DD.AAAA.J.TT.OOOO).
- **DataJud_Client**: Componente responsável pela comunicação com a API pública do DataJud/CNJ.
- **Court**: Tribunal ou órgão judicial associado a um processo.
- **Court_History**: Registro imutável de todas as movimentações de tribunal de um processo.
- **Task**: Tarefa jurídica associada a um processo ou a um Tenant.
- **Task_Board**: Quadro de tarefas no estilo Kanban associado a um processo ou Tenant.
- **Notification_Service**: Componente responsável pelo envio de notificações via múltiplos canais.
- **Queue_Worker**: Processo em segundo plano que consome filas BullMQ para operações assíncronas.
- **Invitation_Token**: Token único, de uso único e com expiração usado no fluxo de convite de usuários.
- **PWA**: Progressive Web App instalável com suporte a notificações push e modo offline básico.
- **Hash_Detector**: Componente que detecta mudanças em dados processuais via comparação de hash.
- **Rate_Limiter**: Componente que limita a frequência de requisições por IP, usuário ou tenant.
- **MFA**: Autenticação multifator (Multi-Factor Authentication).
- **LGPD**: Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018).
- **CSP**: Content Security Policy, cabeçalho HTTP de segurança.
- **Argon2id**: Algoritmo de hashing de senhas resistente a ataques de força bruta e GPU.

---

## Requirements

### Requirement 1: Multi-Tenancy e Isolamento de Dados

**User Story:** Como Super Admin, quero gerenciar múltiplos escritórios de advocacia na plataforma, para que cada escritório opere de forma completamente isolada dos demais.

#### Acceptance Criteria

1. THE Platform SHALL associar cada registro de dado (processo, tarefa, usuário, configuração) a um `tenant_id` único e imutável no momento da criação.
2. WHEN uma requisição autenticada é recebida, THE Platform SHALL validar que o `tenant_id` do recurso solicitado corresponde ao `tenant_id` da sessão ativa antes de retornar qualquer dado.
3. IF uma requisição tenta acessar recursos de um `tenant_id` diferente do da sessão ativa, THEN THE Platform SHALL retornar HTTP 403 e registrar o evento no Audit_Service.
4. THE Super_Admin SHALL criar, bloquear, reativar e encerrar contas de Tenant via painel administrativo exclusivo.
5. WHEN um Tenant é bloqueado pelo Super_Admin, THE Platform SHALL impedir imediatamente o login de todos os usuários desse Tenant e exibir mensagem de conta suspensa.
6. THE Super_Admin SHALL alterar o plano de assinatura de qualquer Tenant sem interromper sessões ativas dos usuários desse Tenant.
7. THE Platform SHALL garantir que consultas ao banco de dados sempre incluam o filtro `WHERE tenant_id = :current_tenant_id` em todas as queries de dados sensíveis, sem exceção.
8. WHERE múltiplos Tenants estão ativos simultaneamente, THE Platform SHALL manter isolamento de dados entre eles sem degradação perceptível de performance.


---

### Requirement 2: Controle de Acesso Baseado em Papéis (RBAC)

**User Story:** Como Office_Admin, quero configurar permissões para cada papel de usuário no meu escritório, para que cada membro acesse apenas as funcionalidades adequadas à sua função.

#### Acceptance Criteria

1. THE RBAC_Engine SHALL suportar os seguintes papéis hierárquicos: Super_Admin, Office_Admin, Lawyer, Legal_Assistant, Intern e Read_Only_User.
2. THE RBAC_Engine SHALL avaliar permissões em cada requisição antes de executar qualquer ação de leitura, criação, atualização ou exclusão.
3. WHEN um usuário tenta executar uma ação para a qual não possui permissão, THE RBAC_Engine SHALL retornar HTTP 403 e registrar o evento no Audit_Service com detalhes da ação tentada.
4. THE Office_Admin SHALL configurar permissões granulares por papel dentro do seu Tenant, podendo habilitar ou desabilitar ações específicas para Lawyer, Legal_Assistant, Intern e Read_Only_User.
5. THE Read_Only_User SHALL visualizar processos, tarefas e documentos, mas o RBAC_Engine SHALL bloquear qualquer operação de escrita desse papel.
6. THE Intern SHALL criar e editar tarefas, mas o RBAC_Engine SHALL bloquear exclusão de processos e alterações de permissões para esse papel.
7. WHEN um usuário muda de papel, THE RBAC_Engine SHALL aplicar as novas permissões imediatamente sem necessidade de novo login.
8. THE Platform SHALL proibir a elevação de privilégios por auto-atribuição: nenhum usuário SHALL alterar o próprio papel ou o papel de usuários com nível hierárquico igual ou superior ao seu.


---

### Requirement 3: Auditoria Completa

**User Story:** Como Super_Admin ou Office_Admin, quero consultar um histórico detalhado de todas as ações realizadas na plataforma, para que eu possa identificar comportamentos suspeitos, resolver disputas e atender auditorias regulatórias.

#### Acceptance Criteria

1. THE Audit_Service SHALL registrar um evento de auditoria para cada uma das seguintes ações: login, logout, falha de autenticação, criação/alteração/exclusão de processo, criação/alteração/exclusão de tarefa, alteração de permissão, envio/aceitação/revogação de convite, mudança de tribunal, alteração de plano de Tenant, bloqueio/reativação de Tenant.
2. THE Audit_Service SHALL persistir em cada registro os campos: `id`, `tenant_id`, `user_id`, `action`, `resource_type`, `resource_id`, `timestamp`, `ip_address`, `user_agent`, `payload_before`, `payload_after`.
3. THE Audit_Service SHALL gravar eventos de auditoria de forma assíncrona sem bloquear a resposta da operação principal, com latência adicional inferior a 50ms para o fluxo principal.
4. THE Platform SHALL garantir que registros de auditoria sejam imutáveis: nenhum usuário, incluindo Super_Admin, SHALL alterar ou excluir registros de auditoria existentes.
5. THE Office_Admin SHALL consultar registros de auditoria do seu Tenant com filtros por usuário, ação, período e recurso, com paginação de até 100 registros por página.
6. THE Super_Admin SHALL consultar registros de auditoria de qualquer Tenant com os mesmos filtros disponíveis ao Office_Admin.
7. WHEN uma falha de autenticação ocorre, THE Audit_Service SHALL registrar o evento mesmo que o usuário não exista na base, utilizando o email ou identificador fornecido como referência.
8. THE Platform SHALL reter registros de auditoria por no mínimo 5 anos conforme requisitos de conformidade jurídica.


---

### Requirement 4: Gestão de Usuários e Fluxo de Convite

**User Story:** Como Office_Admin, quero convidar novos membros para o meu escritório por email, para que eles possam criar suas senhas e acessar a plataforma de forma segura sem expor credenciais.

#### Acceptance Criteria

1. WHEN o Office_Admin cria um convite para um novo usuário, THE Platform SHALL gerar um Invitation_Token único, criptograficamente seguro, com validade de 72 horas.
2. THE Platform SHALL enviar o Invitation_Token ao email do convidado em link de ativação com URL no formato `https://<domínio>/convite/<token>` imediatamente após a criação do convite.
3. WHEN o usuário convidado acessa o link de ativação e define sua senha, THE Platform SHALL invalidar o Invitation_Token imediatamente, tornando-o inutilizável para qualquer acesso subsequente.
4. IF o Invitation_Token expirou ou já foi utilizado, THEN THE Platform SHALL retornar mensagem clara de token inválido e oferecer opção para o Office_Admin reenviar novo convite.
5. THE Platform SHALL exigir que a senha definida no fluxo de ativação atenda: mínimo de 12 caracteres, ao menos uma letra maiúscula, uma letra minúscula, um número e um caractere especial.
6. THE Platform SHALL armazenar senhas exclusivamente como hash Argon2id com salt gerado automaticamente por 16 bytes aleatórios, sem armazenar a senha em texto claro em nenhuma camada.
7. THE Office_Admin SHALL revogar convites pendentes antes da expiração, invalidando o Invitation_Token correspondente imediatamente.
8. THE Office_Admin SHALL desativar contas de usuários do seu Tenant, encerrando todas as sessões ativas do usuário em até 30 segundos após a desativação.
9. WHEN um usuário é desativado, THE Platform SHALL preservar todos os dados associados ao usuário e registrar o evento no Audit_Service.


---

### Requirement 5: Autenticação e Segurança de Sessão

**User Story:** Como usuário da plataforma, quero me autenticar com segurança e ter minha sessão protegida, para que acessos não autorizados à minha conta sejam prevenidos.

#### Acceptance Criteria

1. THE Platform SHALL autenticar usuários via email e senha utilizando Auth.js (NextAuth) com estratégia de sessão baseada em JWT assinado com chave secreta de 256 bits.
2. THE Platform SHALL expirar sessões após 8 horas de inatividade, exigindo nova autenticação.
3. WHEN um usuário se autentica com sucesso, THE Platform SHALL regenerar o identificador de sessão para prevenir Session Fixation.
4. WHERE MFA está habilitado para o usuário, THE Platform SHALL exigir código TOTP válido na autenticação antes de conceder acesso, mesmo com credenciais corretas.
5. THE Rate_Limiter SHALL bloquear temporariamente o IP por 15 minutos após 5 tentativas de login malsucedidas consecutivas para o mesmo email no período de 5 minutos.
6. WHEN o bloqueio por força bruta é ativado, THE Audit_Service SHALL registrar o evento com IP, email tentado, timestamp e contagem de tentativas.
7. THE Platform SHALL transmitir todos os dados via HTTPS com TLS 1.2 ou superior, recusando conexões em protocolos inferiores.
8. THE Platform SHALL emitir os seguintes cabeçalhos de segurança em todas as respostas HTTP: `Strict-Transport-Security`, `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` e `Content-Security-Policy`.
9. IF o token de sessão apresentar assinatura inválida ou estiver expirado, THEN THE Platform SHALL retornar HTTP 401 e redirecionar o usuário para a página de login.


---

### Requirement 6: Gestão de Processos Judiciais

**User Story:** Como Lawyer ou Legal_Assistant, quero cadastrar e gerenciar processos judiciais com todos os dados relevantes, para que o escritório tenha controle centralizado e atualizado de cada caso.

#### Acceptance Criteria

1. THE Platform SHALL validar o CNJ_Number no formato `NNNNNNN-DD.AAAA.J.TT.OOOO` antes de persistir qualquer processo, retornando erro de validação descritivo para formatos inválidos.
2. THE Platform SHALL armazenar os seguintes campos obrigatórios em cada Process: `cnj_number`, `tenant_id`, `client_name`, `current_court`, `status`, `process_class`, `subject`, `responsible_users`, `created_at`, `updated_at`.
3. THE Platform SHALL armazenar os seguintes campos opcionais em cada Process: `tags`, `description`, `last_datajud_sync_at`, `datajud_hash`.
4. WHEN um processo é criado, THE Platform SHALL iniciar automaticamente a descoberta do tribunal via DataJud_Client de forma assíncrona através do Queue_Worker, sem bloquear a resposta de criação.
5. THE Lawyer SHALL atribuir múltiplos responsáveis a um processo, sendo que pelo menos um responsável deve ser um usuário ativo do Tenant.
6. THE Platform SHALL exibir a lista de processos de um Tenant com paginação de até 50 registros por página, suportando filtros por status, responsável, tribunal, tags e período de criação.
7. WHEN um processo é excluído logicamente, THE Platform SHALL preservar todos os dados históricos associados (histórico de tribunais, tarefas, auditoria) e registrar o evento no Audit_Service.
8. THE Platform SHALL impedir o cadastro de dois processos com o mesmo `cnj_number` dentro do mesmo Tenant, retornando erro de duplicidade descritivo.
9. FOR ALL processos criados, o `tenant_id` associado SHALL ser imutável após a criação.


---

### Requirement 7: Integração com DataJud

**User Story:** Como Lawyer, quero que o sistema descubra e atualize automaticamente as informações do tribunal de cada processo via DataJud, para que o escritório tenha sempre os dados processuais mais recentes sem esforço manual.

#### Acceptance Criteria

1. WHEN um Process é criado com um CNJ_Number válido, THE DataJud_Client SHALL consultar a API pública do DataJud para identificar o tribunal competente e atualizar o campo `current_court` do processo em até 5 minutos após a criação.
2. THE Queue_Worker SHALL executar verificações periódicas de atualização processual para todos os processos ativos de todos os Tenants em intervalos configuráveis, com intervalo padrão de 24 horas.
3. THE Hash_Detector SHALL calcular um hash SHA-256 do payload retornado pelo DataJud para cada processo e comparar com o `datajud_hash` armazenado para identificar mudanças antes de atualizar o banco.
4. WHEN o Hash_Detector detecta uma diferença no hash, THE Platform SHALL atualizar os dados do processo, registrar uma entrada em Court_History e disparar eventos de notificação para os responsáveis.
5. IF a API do DataJud retornar erro HTTP 4xx ou 5xx, THEN THE Queue_Worker SHALL reagendar a tentativa com backoff exponencial de 1, 2, 4 e 8 minutos, registrando cada falha no sistema de logs estruturados.
6. IF a API do DataJud estiver indisponível por mais de 60 minutos consecutivos, THEN THE Notification_Service SHALL enviar alerta ao Super_Admin com detalhes da indisponibilidade.
7. THE DataJud_Client SHALL nunca bloquear operações de usuário: todas as consultas ao DataJud SHALL ocorrer exclusivamente via Queue_Worker em segundo plano.
8. THE Platform SHALL exibir ao usuário a data e hora da última sincronização bem-sucedida com o DataJud para cada processo, com indicador visual de "desatualizado" quando a última sincronização superar 48 horas.
9. FOR ALL consultas ao DataJud, THE DataJud_Client SHALL validar e sanitizar o payload retornado antes de persistir qualquer dado, recusando payloads malformados.


---

### Requirement 8: Histórico de Tribunais

**User Story:** Como Lawyer ou Office_Admin, quero visualizar o histórico completo de mudanças de tribunal de cada processo, para que eu possa rastrear toda a tramitação processual e cumprir obrigações de documentação.

#### Acceptance Criteria

1. THE Platform SHALL registrar uma entrada em Court_History sempre que o tribunal de um processo for alterado, seja por atualização do DataJud ou por edição manual.
2. THE Court_History SHALL armazenar os seguintes campos em cada entrada: `id`, `process_id`, `tenant_id`, `previous_court`, `new_court`, `changed_at`, `change_reason`, `changed_by_user_id`, `datajud_payload`.
3. THE Platform SHALL garantir que registros em Court_History sejam imutáveis: nenhum usuário, incluindo Super_Admin, SHALL alterar ou excluir entradas de Court_History.
4. THE Platform SHALL exibir o histórico de tribunais de um processo em ordem cronológica decrescente, com todos os campos disponíveis para usuários com permissão de leitura do processo.
5. WHEN uma mudança de tribunal é detectada via DataJud, THE Court_History SHALL armazenar o payload bruto retornado pelo DataJud no campo `datajud_payload` para fins de auditoria.
6. WHEN uma mudança de tribunal é realizada manualmente pelo usuário, THE Court_History SHALL armazenar o `user_id` do responsável pela alteração e o motivo informado no campo `change_reason`.
7. THE Platform SHALL preservar todo o Court_History mesmo após a exclusão lógica do processo associado.


---

### Requirement 9: Gestão de Tarefas

**User Story:** Como Lawyer ou Legal_Assistant, quero criar e gerenciar tarefas associadas a processos jurídicos em um quadro estilo Kanban, para que o time do escritório coordene as atividades de cada caso com visibilidade clara do progresso.

#### Acceptance Criteria

1. THE Platform SHALL suportar os seguintes status de tarefa no Task_Board: "A Fazer", "Em Andamento", "Revisão" e "Concluído", nesta ordem de progressão.
2. THE Platform SHALL armazenar os seguintes campos em cada Task: `id`, `tenant_id`, `process_id` (opcional), `title`, `description`, `priority`, `assignee_user_id`, `due_date`, `status`, `created_by_user_id`, `created_at`, `updated_at`.
3. THE Platform SHALL suportar os seguintes valores de prioridade para Task: "Baixa", "Média", "Alta" e "Urgente".
4. WHEN um usuário move uma Task para um novo status no Task_Board, THE Platform SHALL registrar a movimentação em histórico de tarefa com campos: `task_id`, `from_status`, `to_status`, `moved_by_user_id`, `moved_at`.
5. THE Platform SHALL exibir tarefas de um processo agrupadas por status, com indicador visual para tarefas com `due_date` vencido.
6. WHEN uma Task é criada com prioridade "Urgente" e `due_date` nos próximos 24 horas, THE Notification_Service SHALL enviar notificação imediata ao `assignee_user_id`.
7. THE Platform SHALL permitir filtrar tarefas por status, prioridade, responsável e período de vencimento dentro de um Tenant.
8. THE Intern SHALL criar e editar tarefas no status "A Fazer" e "Em Andamento", mas o RBAC_Engine SHALL bloquear a exclusão permanente de tarefas para esse papel.
9. FOR ALL movimentações de status de tarefa, o histórico de movimentação SHALL ser imutável e preservado mesmo após a exclusão lógica da tarefa.


---

### Requirement 10: Sistema de Notificações

**User Story:** Como usuário da plataforma, quero receber notificações relevantes sobre processos e tarefas nos canais de minha preferência, para que eu seja alertado em tempo real sobre eventos que exigem atenção.

#### Acceptance Criteria

1. THE Notification_Service SHALL suportar os seguintes canais de entrega: In-App (notificação dentro da plataforma), Email e Push Notification (via PWA).
2. THE Notification_Service SHALL disparar notificações para os seguintes eventos: processo atualizado via DataJud, tribunal alterado, nova tarefa atribuída, tarefa concluída, convite enviado, convite aceito, conta bloqueada.
3. WHEN uma notificação é gerada, THE Notification_Service SHALL tentar entrega em todos os canais habilitados pelo usuário de forma assíncrona via Queue_Worker, sem bloquear o evento que originou a notificação.
4. THE Platform SHALL permitir que cada usuário configure individualmente quais canais deseja receber para cada tipo de evento, podendo desabilitar canais específicos.
5. IF a entrega de email falhar, THEN THE Queue_Worker SHALL retentar o envio até 3 vezes com intervalo de 5 minutos entre tentativas, registrando cada falha no sistema de logs.
6. THE Platform SHALL exibir notificações In-App não lidas com contador de badge na interface, atualizando em tempo real via polling a cada 30 segundos ou via WebSocket quando disponível.
7. WHEN o usuário marca uma notificação In-App como lida, THE Platform SHALL atualizar o status de leitura imediatamente e decrementar o contador de badge.
8. THE Platform SHALL preservar o histórico de notificações In-App por 90 dias, exibindo as 100 notificações mais recentes na interface.
9. WHEN uma notificação Push é recebida e o usuário clica nela, THE PWA SHALL navegar diretamente para o recurso relacionado ao evento (processo ou tarefa específica).


---

### Requirement 11: Progressive Web App (PWA)

**User Story:** Como usuário da plataforma, quero instalar o sistema como aplicativo no meu dispositivo e receber notificações push mesmo quando o navegador estiver fechado, para que eu acesse funcionalidades essenciais com a experiência de um aplicativo nativo.

#### Acceptance Criteria

1. THE PWA SHALL ser instalável em dispositivos Android, iOS e desktop a partir do navegador, exibindo prompt de instalação compatível com cada plataforma.
2. THE PWA SHALL registrar um Service Worker que armazene em cache os recursos essenciais da interface (shell da aplicação, fontes, ícones e dados recentes) para permitir visualização básica sem conexão à internet.
3. WHILE o dispositivo está offline, THE PWA SHALL exibir a última versão cacheada dos processos e tarefas acessados recentemente com indicador visual claro de modo offline.
4. THE PWA SHALL receber e exibir Push Notifications mesmo com o navegador fechado, utilizando o protocolo Web Push com chaves VAPID.
5. WHEN uma nova versão da PWA é publicada, THE Service_Worker SHALL detectar a atualização e notificar o usuário com opção de atualizar imediatamente, sem forçar refresh automático.
6. THE PWA SHALL ter pontuação mínima de 90 no Lighthouse PWA Audit para instalabilidade, performance e acessibilidade.
7. THE Platform SHALL fornecer um Web App Manifest com nome, ícones em múltiplas resoluções, cor de tema, orientação e modo de exibição `standalone` para cada Tenant.


---

### Requirement 12: Segurança Máxima e Proteção contra Ataques

**User Story:** Como Super_Admin, quero que a plataforma implemente defesas ativas contra as principais classes de vulnerabilidades web, para que dados sensíveis de processos judiciais e clientes estejam protegidos contra acessos não autorizados.

#### Acceptance Criteria

1. THE Platform SHALL utilizar queries parametrizadas via Prisma ORM em todas as interações com o banco de dados, proibindo a construção de queries por concatenação de strings com input do usuário.
2. THE Platform SHALL sanitizar e codificar todo output renderizado na interface para prevenir XSS, utilizando as proteções nativas do React e CSP com política `script-src 'self'` sem `unsafe-inline`.
3. THE Platform SHALL implementar proteção CSRF via token de dupla submissão em todos os formulários e requisições mutantes (POST, PUT, PATCH, DELETE).
4. THE Rate_Limiter SHALL aplicar limites por IP e por usuário autenticado em todos os endpoints públicos e autenticados, com limites configuráveis por tipo de operação.
5. THE Platform SHALL validar e sanitizar todas as URLs fornecidas por usuários antes de realizar requisições externas, bloqueando requisições para endereços de rede interna (127.0.0.1, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16) para prevenir SSRF.
6. THE RBAC_Engine SHALL validar a propriedade de cada recurso acessado em nível de objeto antes de retornar dados, prevenindo IDOR e BOLA verificando `tenant_id` e permissões de usuário em cada acesso.
7. THE Platform SHALL criptografar dados sensíveis em repouso utilizando AES-256 para campos como tokens, chaves de API externas e dados de PII quando armazenados no banco.
8. WHERE MFA está disponível, THE Platform SHALL suportar autenticação de dois fatores via TOTP (RFC 6238) com aplicativos autenticadores compatíveis (Google Authenticator, Authy).
9. THE Platform SHALL adicionar o cabeçalho `X-Frame-Options: DENY` e diretiva `frame-ancestors 'none'` no CSP em todas as respostas para prevenir Clickjacking.
10. IF uma requisição de upload de arquivo é recebida, THEN THE Platform SHALL validar tipo MIME, extensão e tamanho máximo de 10MB antes de processar, rejeitando arquivos executáveis ou com extensões perigosas.


---

### Requirement 13: Conformidade com a LGPD

**User Story:** Como titular de dados pessoais e como Office_Admin, quero que a plataforma trate dados pessoais em conformidade com a LGPD, para que o escritório cumpra suas obrigações legais e os titulares possam exercer seus direitos.

#### Acceptance Criteria

1. THE Platform SHALL registrar o consentimento do usuário para coleta e tratamento de dados pessoais no momento do primeiro acesso, armazenando data, hora, versão da política aceita e identificador do usuário.
2. THE Platform SHALL exibir a Política de Privacidade e os Termos de Uso antes do cadastro, exigindo aceite explícito para prosseguir.
3. WHEN um usuário solicita exportação dos seus dados pessoais, THE Platform SHALL gerar e disponibilizar o arquivo de exportação em formato JSON em até 72 horas após a solicitação.
4. WHEN um usuário solicita exclusão da sua conta, THE Platform SHALL anonimizar os dados pessoais identificáveis (nome, email, IP) em até 30 dias, preservando registros de auditoria e histórico processual de forma anonimizada.
5. THE Platform SHALL implementar política de retenção de dados, excluindo automaticamente dados pessoais de usuários inativos há mais de 5 anos após notificação prévia de 30 dias.
6. THE Platform SHALL registrar logs de acesso a dados pessoais sensíveis, identificando usuário, recurso acessado, timestamp e finalidade declarada, disponíveis para consulta pelo DPO.
7. IF uma violação de dados pessoais é detectada, THEN THE Platform SHALL notificar o Super_Admin em até 1 hora com detalhes do incidente para reporte à ANPD dentro do prazo legal de 72 horas.
8. THE Platform SHALL disponibilizar ao Office_Admin um painel de gestão de consentimentos e requisições LGPD dos usuários do seu Tenant.


---

### Requirement 14: Observabilidade e Monitoramento

**User Story:** Como Super_Admin e equipe de operações, quero monitorar a saúde do sistema em tempo real com logs estruturados e métricas, para que problemas sejam detectados e resolvidos antes de impactar usuários.

#### Acceptance Criteria

1. THE Platform SHALL emitir logs estruturados em formato JSON para cada operação relevante, incluindo campos: `timestamp`, `level`, `service`, `tenant_id`, `user_id`, `action`, `duration_ms`, `status_code`, `error_message`.
2. THE Platform SHALL registrar logs de nível ERROR para: falhas de autenticação, erros de banco de dados, falhas de integração com DataJud, exceções não tratadas e rejeições de rate limiting.
3. THE Platform SHALL registrar a duração de cada requisição HTTP e operação de banco de dados, emitindo log de alerta quando a duração superar 2000ms.
4. THE Platform SHALL expor um endpoint `/health` que retorne status HTTP 200 com payload JSON indicando estado de cada dependência crítica (banco de dados, fila BullMQ, serviço de email) sem expor informações sensíveis.
5. THE Platform SHALL rastrear e reportar erros de frontend e backend com stack trace completo, agrupando erros similares para reduzir ruído.
6. WHEN o Queue_Worker acumula mais de 100 jobs na fila de pendentes, THE Platform SHALL emitir alerta ao sistema de monitoramento com detalhes da fila afetada.
7. THE Platform SHALL manter métricas de: tempo médio de resposta por endpoint, taxa de erros por endpoint, contagem de jobs processados por fila e utilização de conexões do pool de banco de dados.


---

### Requirement 15: Backup e Recuperação de Desastres

**User Story:** Como Super_Admin, quero que os dados da plataforma sejam protegidos por backups automáticos e que a recuperação possa ser executada de forma confiável, para que falhas catastróficas não resultem em perda permanente de dados jurídicos críticos.

#### Acceptance Criteria

1. THE Platform SHALL executar backup completo do banco de dados diariamente às 02:00 UTC, armazenando o arquivo em localização geograficamente separada do servidor de produção.
2. THE Platform SHALL executar backup incremental a cada 6 horas, capturando apenas as alterações desde o último backup.
3. THE Platform SHALL reter backups diários por 30 dias e backups semanais por 12 meses.
4. THE Platform SHALL criptografar todos os arquivos de backup com AES-256 antes da transmissão e armazenamento externo.
5. THE Platform SHALL executar teste de restauração automatizado mensalmente, verificando a integridade e completude do backup mais recente sem afetar o ambiente de produção.
6. WHEN um teste de restauração falha, THE Platform SHALL notificar o Super_Admin imediatamente com detalhes da falha.
7. THE Platform SHALL documentar e manter atualizado o procedimento de recuperação de desastre com RTO (Recovery Time Objective) máximo de 4 horas e RPO (Recovery Point Objective) máximo de 6 horas.


---

### Requirement 16: Testes Automatizados

**User Story:** Como desenvolvedor da plataforma, quero que o sistema tenha cobertura de testes automatizados abrangente, para que regressões sejam detectadas automaticamente e a segurança do sistema seja verificável de forma contínua.

#### Acceptance Criteria

1. THE Platform SHALL manter cobertura mínima de 80% de linhas de código em testes unitários e de integração, medida pelo Vitest.
2. THE Platform SHALL incluir testes unitários para todas as funções de domínio (validação de CNJ, cálculo de permissões RBAC, lógica de detecção de hash, geração de tokens), com cobertura de 100% para essas funções críticas.
3. THE Platform SHALL incluir testes de integração para todos os fluxos de API: autenticação, criação de processo, atualização via DataJud, movimentação de tarefa e envio de convite.
4. THE Platform SHALL incluir testes E2E com Playwright cobrindo os fluxos críticos: cadastro via convite, login, criação de processo, movimentação de tarefa no Kanban e recebimento de notificação.
5. THE Platform SHALL incluir testes de segurança automatizados que simulem: injeção SQL em campos de busca, XSS em campos de texto, requisições sem token CSRF, acesso a recursos de outro tenant (IDOR/BOLA) e força bruta no endpoint de login.
6. THE Platform SHALL incluir testes de propriedade (property-based) para: validação do formato CNJ_Number (para todo input que não satisfaz o padrão CNJ, THE Validator SHALL rejeitar), serialização/desserialização de dados processuais (para todo Process serializado e desserializado, o resultado SHALL ser equivalente ao original) e isolamento de tenant (para toda query executada com tenant_id A, THE Platform SHALL retornar apenas dados do tenant_id A).
7. THE Platform SHALL executar a suíte de testes completa em pipeline de CI/CD a cada pull request, bloqueando merge quando a cobertura cair abaixo de 80% ou qualquer teste falhar.
8. FOR ALL testes de segurança que simulam IDOR e BOLA, THE RBAC_Engine SHALL retornar HTTP 403 e nunca retornar dados de outro tenant.


---

### Requirement 17: Arquitetura em Camadas e Contexto de Continuidade

**User Story:** Como desenvolvedor e arquiteto de software, quero que o sistema siga uma arquitetura em camadas bem definida e mantenha documentação de contexto atualizada, para que o código seja manutenível, testável e evoluível por equipes distribuídas.

#### Acceptance Criteria

1. THE Platform SHALL organizar o código fonte nas seguintes camadas obrigatórias: `src/modules/` (módulos de funcionalidade), `shared/` (utilitários compartilhados), `infrastructure/` (banco, filas, email), `domain/` (regras de negócio e entidades), `application/` (casos de uso) e `presentation/` (componentes React, Server Actions, API Routes).
2. THE Platform SHALL proibir regras de negócio em componentes React: toda lógica de domínio SHALL residir exclusivamente na camada `domain/` ou `application/`.
3. THE Platform SHALL manter o diretório `/project-context` com os arquivos: `architecture.md`, `database.md`, `api-contracts.md`, `progress.md`, `decisions.md` e `checkpoint.json`, mantidos atualizados a cada fase de implementação concluída.
4. THE Platform SHALL utilizar Zod para validação de todos os inputs externos (formulários, parâmetros de URL, payloads de API e dados do DataJud) antes de qualquer processamento na camada de aplicação.
5. THE Platform SHALL implementar as fases de desenvolvimento na seguinte sequência obrigatória: (1) Arquitetura completa, (2) Modelagem do banco, (3) Autenticação, (4) Multi-tenant, (5) Integração DataJud, (6) Gestão de processos, (7) Tarefas, (8) Notificações, (9) PWA, (10) Testes, (11) Hardening de segurança, (12) Preparação para produção.
6. THE Platform SHALL documentar cada decisão arquitetural significativa em `decisions.md` com campos: data, contexto, opções consideradas, decisão tomada e consequências esperadas.


---

### Requirement 18: Performance e Escalabilidade

**User Story:** Como usuário da plataforma em um escritório com centenas de processos, quero que o sistema responda rapidamente mesmo sob carga elevada, para que minha produtividade não seja impactada pelo desempenho da plataforma.

#### Acceptance Criteria

1. THE Platform SHALL responder a requisições de listagem (processos, tarefas) em até 500ms para páginas com até 50 registros, medido no percentil 95 das requisições.
2. THE Platform SHALL responder a requisições de criação e atualização de recursos em até 1000ms no percentil 95, excluindo operações assíncronas delegadas ao Queue_Worker.
3. THE Platform SHALL suportar pelo menos 100 Tenants ativos simultâneos com 50 usuários concorrentes por Tenant sem degradação de performance além dos limites definidos nos critérios anteriores.
4. THE Platform SHALL implementar índices de banco de dados nos campos: `tenant_id`, `cnj_number`, `status` (processos), `assignee_user_id` e `due_date` (tarefas) e `user_id` (auditoria).
5. THE Platform SHALL implementar cache de sessão e de dados de configuração de Tenant com TTL de 5 minutos para reduzir consultas repetitivas ao banco.
6. WHEN o número de registros retornados por uma query exceder 1000 linhas, THE Platform SHALL exigir paginação com `cursor` ou `offset/limit` explícito, bloqueando queries sem paginação em coleções grandes.


---

## Propriedades de Corretude

As propriedades abaixo definem comportamentos que devem ser verificáveis via testes automatizados, incluindo testes de propriedade (property-based testing) com Vitest.

### P1 — Isolamento de Tenant (Invariante)
Para toda query executada com `tenant_id = A`, o resultado SHALL conter exclusivamente registros cujo `tenant_id` seja igual a `A`. Esta propriedade deve ser verificada com dados gerados aleatoriamente para múltiplos tenants simultâneos.

### P2 — Round-trip de Serialização de Processo (Round-trip)
Para todo objeto Process serializado para JSON e desserializado, o resultado SHALL ser equivalente ao objeto original campo a campo. Esta propriedade garante que nenhum dado é perdido ou corrompido em operações de serialização.

### P3 — Validação do Formato CNJ (Error Conditions)
Para todo string que não satisfaz o padrão `NNNNNNN-DD.AAAA.J.TT.OOOO`, THE Validator SHALL rejeitar a entrada com erro de validação descritivo. Para todo string que satisfaz o padrão CNJ, THE Validator SHALL aceitar a entrada. Esta propriedade deve ser verificada com geração aleatória de strings válidas e inválidas.

### P4 — Imutabilidade de Auditoria (Invariante)
Para todo registro de auditoria criado, nenhuma operação de UPDATE ou DELETE SHALL modificar ou remover o registro. O hash SHA-256 do payload de auditoria calculado no momento da criação SHALL ser idêntico ao hash recalculado em qualquer momento posterior.

### P5 — Idempotência de Hash de DataJud (Idempotência)
Para todo payload retornado pelo DataJud, aplicar o Hash_Detector duas vezes seguidas sobre o mesmo payload não modificado SHALL produzir o mesmo resultado de "sem mudança detectada" na segunda execução.

### P6 — RBAC — Bloqueio de Elevação de Privilégio (Error Conditions)
Para toda tentativa de um usuário de atribuir a si mesmo ou a outro usuário um papel com nível hierárquico igual ou superior ao seu próprio, THE RBAC_Engine SHALL rejeitar a operação com HTTP 403, independentemente do método de requisição utilizado.

### P7 — Unicidade de Invitation_Token (Invariante)
Para todo conjunto de Invitation_Tokens gerados, nenhum par de tokens SHALL ser idêntico. Esta propriedade deve ser verificada com geração de pelo menos 10.000 tokens em sequência.

### P8 — Preservação de Court_History (Invariante)
Para todo processo com N entradas em Court_History, após qualquer operação sobre o processo (atualização, exclusão lógica, mudança de responsável), o número de entradas em Court_History SHALL ser maior ou igual a N.

