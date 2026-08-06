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
- Exceção única e explícita: `dashboard/` é um **read model** — consulta as
  tabelas de outros módulos, mas só com `SELECT` agregado, sem escrita e sem
  regra de negócio. Somar seis indicadores pelos services daria seis chamadas
  e as somas em JS. Qualquer coisa além de agregação vai para o módulo dono.
  (`payable/` usa a mesma licença em `findPaidRentsWithoutPayout`, um SELECT em
  `receivables` para achar o que reconciliar. `cashflow/` também: o extrato é a
  união de `receivables`, `payables`, `commissions` e dos lançamentos manuais —
  derivar na leitura é o que faz cancelar um repasse apagar a taxa de
  administração junto, em vez de manter duas fontes de verdade.)
- `audit/` é transversal: qualquer módulo pode importar o `record()` do service
  dele. Mas quase nunca precisa — a trilha nasce sozinha no gateway
  (`gateway/audit.hook.ts`), que registra toda mutação de `/v1`. Chame
  `record()` só quando a ação não é uma mutação HTTP (download, webhook) ou
  quando o nome derivado da rota não descreve o que aconteceu; nesse segundo
  caso, prefira uma linha em `audit/audit.actions.ts`.
- Quando A precisa reagir a um fato de B **e** B já depende de A, não inverta a
  seta com um import: B expõe um registro de listeners e o gancho é ligado em
  `app.ts`. É o caso de `receivableService.onSettled` → `payable`, que sem isso
  fecharia o ciclo contract → receivable → payable → contract. Evento do
  RabbitMQ não serve aqui: `publish` é best-effort e engole a mensagem com o
  broker fora do ar — aceitável para reindexar o RAG, não para creditar dinheiro
  de terceiros.

## Desvio deliberado do SPEC: o grafo do MOD-AI

O SPEC (seções 6 e 7) prescreve **LangGraph** para orquestrar o agente. `ai/`
usa um grafo próprio em TypeScript (`ai/graph/`), e isso é uma decisão, não
descuido:

- O grafo do PRD tem quatro nós determinísticos em sequência, sem ramificação
  nem ciclo — o único laço real (pedir ferramenta → executar → continuar) já
  vive dentro do tool runner do SDK do provedor. `graph/run.ts` é um `for` sobre
  um array de nós tipados; um framework de grafos aqui orquestraria um `if`.
- O estado fica no nosso Postgres, sob `withTenant`/RLS, sem invólucro. O
  checkpointer do LangGraph traria um segundo lugar onde dado de tenant é
  gravado — exatamente o tipo de caminho paralelo que o isolamento não pode ter.

O dia em que houver ramificação de verdade (múltiplos canais com fluxos
diferentes, retomada de conversa longa), `graph/run.ts` é o único arquivo que
muda — e aí vale reavaliar.

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
| `document/`          | document-service       | 1    | 🟡 upload/versão/expurgo LGPD; sem OCR nem retenção automática |
| `crm/`               | crm-service            | 2    | ⬜            |
| `receivable/`        | financial-service      | 2    | 🟡 contas a receber: aluguéis gerados na assinatura + baixa manual |
| `payable/`           | financial-service      | 2    | 🟡 contas a pagar: repasse ao proprietário na baixa do aluguel |
| `payment/`           | financial-service      | 2    | ✅ Asaas: boleto/PIX sob demanda, webhook idempotente |
| `commission/`        | financial-service      | 2    | 🟡 comissão de venda (uma linha por parte); a venda em si é módulo futuro |
| `cashflow/`          | (leitura agregada)     | 2    | ✅ extrato consolidado + lançamento manual e categorias |
| `financial/`         | financial-service      | 2    | ⬜ régua de cobrança |
| `rental/`            | rental-service         | 2    | ⬜            |
| `maintenance/`       | maintenance-service    | 2    | ⬜            |
| `portal/`            | portal-service         | 2    | ⬜            |
| `publishing/`        | publishing-service     | 3    | ⬜            |
| `notification/`      | notification-service   | 2    | ⬜            |
| `billing/`           | billing-service        | 0/2  | ⬜            |
| `ai/`                | ai-orchestrator-service| 4    | 🟡 copiloto interno: RAG (pgvector) + tools + créditos |
| `admin/`             | admin-service          | 0/2  | ⬜            |
| `audit/`             | (transversal)          | 0    | ✅ trilha imutável: captura no gateway + visão global |
| `dashboard/`         | (leitura agregada)     | 1    | ✅ resumo do painel (só SELECT) |
