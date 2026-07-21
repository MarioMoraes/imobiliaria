# Módulos de Domínio

O backend é um **monólito modular**: um único deployable, mas com fronteiras
de módulo explícitas. Cada módulo mapeia um serviço do SPEC (seção 4.2) e segue
o mesmo padrão do módulo de referência `property/`:

```
<modulo>/
  <modulo>.schema.ts       # tipos + validação (zod)
  <modulo>.repository.ts   # acesso a dados via withTenant() (RLS)
  <modulo>.service.ts      # regras de negócio + publicação de eventos
  <modulo>.routes.ts       # rotas HTTP (Fastify), sob /v1/<modulo>
```

Regras de fronteira:

- Um módulo **nunca** importa o `repository` de outro módulo. Integração entre
  módulos é feita por **eventos** (`shared/events.ts`) ou chamando o `service`
  público do outro módulo. Isso mantém cada módulo pronto para virar
  microserviço sem reescrever a lógica.
- Todo acesso a dado de domínio passa por `withTenant(tenantId, ...)`.
- Registre as rotas do módulo em `gateway/routes.ts`.

## Roadmap de módulos (SPEC seção 16)

| Módulo (dir)         | Serviço no SPEC        | Fase | Status        |
|----------------------|------------------------|------|---------------|
| `property/`          | property-service       | 1    | ✅ referência |
| `health/`            | (transversal)          | 0    | ✅            |
| `auth/`              | auth-service           | 0    | ⬜ a fazer    |
| `tenant/`            | tenant-service         | 0    | ✅ CRUD + resolução |
| `owner/`             | owner-service          | 1    | ⬜            |
| `customer/`          | customer-service       | 1    | ⬜            |
| `broker/`            | broker-service         | 1    | ⬜            |
| `employee/`          | employee-service       | 1    | ⬜            |
| `scheduling/`        | scheduling-service     | 1    | ⬜            |
| `contract/`          | contract-service       | 1    | ✅ CRUD + partes + templates + PDF |
| `signature/`         | (parte do contract)    | 2    | ✅ ZapSign: envio, webhook, sync |
| `document/`          | document-service       | 1    | ⬜            |
| `crm/`               | crm-service            | 2    | ⬜            |
| `receivable/`        | financial-service      | 2    | 🟡 contas a receber: aluguéis gerados na assinatura + baixa manual |
| `payment/`           | financial-service      | 2    | ✅ Asaas: boleto/PIX sob demanda, webhook idempotente |
| `financial/`         | financial-service      | 2    | ⬜ repasses, comissões, DRE |
| `rental/`            | rental-service         | 2    | ⬜            |
| `maintenance/`       | maintenance-service    | 2    | ⬜            |
| `portal/`            | portal-service         | 2    | ⬜            |
| `publishing/`        | publishing-service     | 3    | ⬜            |
| `notification/`      | notification-service   | 2    | ⬜            |
| `billing/`           | billing-service        | 0/2  | ⬜            |
| `ai-orchestrator/`   | ai-orchestrator-service| 4    | ⬜ LangGraph  |
| `admin/`             | admin-service          | 0/2  | ⬜            |
