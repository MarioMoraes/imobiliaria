# PRD Detalhado — Gestão de Funcionários (RH básico / Identidade & Permissões)

**Módulo:** MOD-FUNC
**Arquivo:** 06/20
**Prioridade:** P1
**Fase de Implementação:** 1 (Core de Gestão)
**Serviço Backend:** employee-service (`backend/src/modules/employee`, monólito porta 3001)
**Tabelas Principais:** employees, employee_roles, employee_permissions, employee_access_log
**Data:** 2026-07-10
**Status:** Em implementação — MOD-FUNC-01 (CRUD), 02 (atribuição de papéis) e 03 (gestão de acesso ATIVO/SUSPENSO/REVOGADO com sync de `users.status` + regra do último ADMIN) concluídos (2026-07-12). MOD-FUNC-04 (permissões finas) e 05 (log de acesso — junto do MOD-AUTH-07 audit log) pendentes. Convite por e-mail nasce como TODO (depende do MOD-AUTH-06).

---

## 1. Visão Geral

**Contexto de negócio.** Este módulo trata dos **colaboradores internos** da imobiliária (não corretores externos): recepção, financeiro, administrativo. O foco é **identidade e permissões operacionais (RBAC)**, não folha de pagamento. Garante que cada colaborador tenha exatamente o acesso necessário — princípio do menor privilégio, essencial para segurança e LGPD.

**Integração sistêmica.** Estende MOD-AUTH: todo funcionário é um `user` com papel(is). Este módulo adiciona metadados de RH (cargo, admissão, status de acesso) e permissões finas quando papéis-padrão não bastam. Consumido por todos os módulos via o middleware RBAC. Publica `employee.created`, `employee.access_revoked`.

**Escopo desta fase.** MVP: cadastro de colaborador, cargo, vínculo com papel(is) RBAC, ativação/desativação de acesso, log de acesso. **Fora desta fase:** folha de pagamento, ponto eletrônico, gestão de férias formais, papéis 100% customizados (herda restrição do MOD-AUTH).

## 2. Sub-Features

| ID | Nome | Descrição | Must/Should/Nice |
|---|---|---|---|
| MOD-FUNC-01 | CRUD funcionário | Cadastro, cargo, dados de admissão | Must Have ✅ |
| MOD-FUNC-02 | Atribuição de papéis | Vincular um ou mais papéis-padrão RBAC | Must Have ✅ |
| MOD-FUNC-03 | Gestão de acesso | Ativar/suspender/revogar acesso do colaborador | Must Have ✅ |
| MOD-FUNC-04 | Permissões finas | Overrides pontuais além do papel (Should) | Should Have |
| MOD-FUNC-05 | Log de acesso | Histórico de login/ações administrativas | Should Have |

## 3. Critérios de Aceite

### [MOD-FUNC-01] — CRUD funcionário

**AC-01 (Happy Path)** — **Dado** um ADMIN, **Quando** `POST /v1/employees` com cargo e papel `FINANCEIRO`, **Então** cria funcionário + convite de usuário (MOD-AUTH), publica `employee.created` (201).
**AC-02 (Validação)** — **Dado** papel inexistente, **Quando** cria, **Então** `422` `ERR_FUNC_002`.
**AC-03 (Edge Case)** — **Dado** CPF de funcionário já cadastrado como corretor, **Quando** cria, **Então** `409` `ERR_FUNC_004` sugerindo unificar identidade sob o mesmo `user`.

### [MOD-FUNC-03] — Gestão de acesso

**AC-01 (Happy Path)** — **Dado** um funcionário desligado, **Quando** ADMIN faz `PATCH /v1/employees/:id/revoke`, **Então** `user` vira `DISABLED`, sessões ativas são revogadas, publica `employee.access_revoked` (200).
**AC-02 (Permissão)** — **Dado** um GESTOR, **Quando** tenta revogar acesso de um ADMIN, **Então** `403` `ERR_FUNC_003` (só ADMIN gere acesso).
**AC-03 (Edge Case)** — **Dado** o único ADMIN do tenant, **Quando** tenta se auto-revogar, **Então** `409` `ERR_FUNC_005` "Não é possível remover o último administrador".

## 4. Modelo de Dados

| Tabela | Campo | Tipo | Obrigatório | Descrição |
|---|---|---|---|---|
| employees | tenant_id, id | String | ✓ | Isolamento / PK |
| employees | user_id | String | ✓ | FK users |
| employees | cpf (criptografado) | String | ✓ | Único por tenant |
| employees | position | String | ✓ | Cargo |
| employees | hired_at | Date | — | Admissão |
| employees | access_status | Enum | ✓ | ATIVO, SUSPENSO, REVOGADO |
| employee_permissions | employee_id, permission, granted | — | — | Overrides finos |
| employee_access_log | employee_id, action, ip, created_at | — | ✓ | Imutável |

### Campos com Criptografia AES-256-GCM
| Campo | Tabela | Justificativa |
|---|---|---|
| cpf | employees | Dado pessoal (LGPD) |

### Índices
```sql
CREATE INDEX idx_employees_tenant ON employees(tenant_id);
CREATE UNIQUE INDEX idx_employees_user ON employees(user_id);
CREATE INDEX idx_emp_access_log ON employee_access_log(employee_id, created_at DESC);
```

## 5. Contratos de API

| Método | Path | Roles | Descrição |
|---|---|---|---|
| GET | /v1/employees | ADMIN, GESTOR | Listar |
| POST | /v1/employees | ADMIN | Criar + convidar |
| GET | /v1/employees/:id | ADMIN, GESTOR | Detalhe |
| PATCH | /v1/employees/:id | ADMIN | Atualizar cargo/papéis |
| PATCH | /v1/employees/:id/revoke | ADMIN | Revogar acesso |
| GET | /v1/employees/:id/access-log | ADMIN | Log de acesso |

```typescript
export const CreateEmployeeSchema = z.object({
  fullName: z.string().min(2),
  cpf: z.string().refine(isValidCpf, 'CPF inválido'),
  email: z.string().email(),
  position: z.string().min(2),
  roles: z.array(z.enum(['ADMIN','GESTOR','FINANCEIRO','AUXILIAR'])).min(1),
})
```

### Códigos de Erro

| Código | HTTP | Cenário |
|---|---|---|
| ERR_FUNC_001 | 404 | Não encontrado |
| ERR_FUNC_002 | 422 | Inválido |
| ERR_FUNC_003 | 403 | Papel insuficiente |
| ERR_FUNC_004 | 409 | Identidade duplicada |
| ERR_FUNC_005 | 409 | Último ADMIN não pode ser removido |

## 6. Máquinas de Estado

### Acesso do Funcionário

```
ATIVO ──(suspender)──► SUSPENSO ──(reativar)──► ATIVO
   │                       │
   └──(revogar/desligar)──►┴──► REVOGADO (sessões killed, user DISABLED)
```

| De | Para | Evento | Efeito |
|---|---|---|---|
| ATIVO | SUSPENSO | `employee.suspended` | bloqueia login temporário |
| * | REVOGADO | `employee.access_revoked` | revoga sessões, DISABLED no MOD-AUTH |

## 7. Regras de Negócio & Edge Cases

| # | Cenário | Comportamento | Módulos |
|---|---|---|---|
| RN-01 | Último ADMIN protegido | Bloqueia revogação/auto-remoção | MOD-AUTH |
| RN-02 | Revogação mata sessões ativas | Invalida refresh token family | MOD-AUTH |
| RN-03 | Overrides finos nunca elevam além do que ADMIN possui | Teto pelo papel | Segurança |

## 8. Eventos RabbitMQ

| Evento | Publisher | Consumers | Payload |
|---|---|---|---|
| `employee.created` | employee | auth (convite), admin | `{ tenantId, employeeId, roles, timestamp }` |
| `employee.access_revoked` | employee | auth, admin | `{ tenantId, employeeId, timestamp }` |

## 9. Segurança & LGPD

### Controle de Acesso

| Operação | Super Admin | Admin | Gestor | Financeiro | Corretor |
|---|---|---|---|---|---|
| Listar | ✓ | ✓ | ✓ | — | — |
| Criar | ✓ | ✓ | — | — | — |
| Editar papéis | ✓ | ✓ | — | — | — |
| Revogar acesso | ✓ | ✓ | — | — | — |

### Audit Log
`employee.created`, `role.changed`, `employee.access_revoked`, `permission.override` → imutável.

### Dados Pessoais (LGPD)
CPF e dados do colaborador: base legal execução de contrato de trabalho/obrigação legal; retenção conforme legislação trabalhista (mínimo aplicável).

## 10. Performance & Observabilidade

### Cache Redis
Reutiliza cache de RBAC do MOD-AUTH (`rbac:{tenantId}:{userId}`).

### Métricas
- `active_employees`: colaboradores ativos por tenant.
- `access_revocations`: revogações/mês (indicador de turnover/segurança).

## 11. Questões em Aberto

| # | Questão | Impacto | Decisor | Prazo |
|---|---|---|---|---|
| 1 | Integração futura com folha/ponto? | Escopo RH | PM | Fase 5 |
| 2 | Permissões finas no MVP ou só papéis-padrão? | Complexidade RBAC | Tech Lead | Fase 1 |
