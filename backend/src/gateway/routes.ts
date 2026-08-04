import type { FastifyInstance } from "fastify";
import { healthRoutes } from "../modules/health/health.routes.js";
import { authRoutes } from "../modules/auth/auth.routes.js";
import { propertyRoutes } from "../modules/property/property.routes.js";
import { propertyTypeRoutes } from "../modules/property-type/property-type.routes.js";
import { clauseRoutes } from "../modules/clause/clause.routes.js";
import {
  contractRoutes,
  contractTemplateRoutes,
  propertyContractRoutes,
} from "../modules/contract/contract.routes.js";
import {
  signatureRoutes,
  signatureSettingsRoutes,
  signatureWebhookRoutes,
} from "../modules/signature/signature.routes.js";
import { receivableRoutes } from "../modules/receivable/receivable.routes.js";
import { payableRoutes } from "../modules/payable/payable.routes.js";
import { searchRoutes } from "../modules/search/search.routes.js";
import {
  paymentRoutes,
  paymentSettingsRoutes,
  paymentWebhookRoutes,
  payoutRoutes,
} from "../modules/payment/payment.routes.js";
import { inspectionItemRoutes } from "../modules/inspection-item/inspection-item.routes.js";
import { inspectionRoutes } from "../modules/inspection/inspection.routes.js";
import { currentTenantRoutes, tenantRoutes } from "../modules/tenant/tenant.routes.js";
import { userRoutes } from "../modules/user/user.routes.js";
import { employeeRoutes } from "../modules/employee/employee.routes.js";
import { personRoutes } from "../modules/person/person.routes.js";
import { condominiumRoutes } from "../modules/condominium/condominium.routes.js";
import { brokerRoutes } from "../modules/broker/broker.routes.js";
import { documentRoutes } from "../modules/document/document.routes.js";
import { districtRoutes } from "../modules/district/district.routes.js";
import { eventRoutes } from "../modules/event/event.routes.js";
import { bankRoutes } from "../modules/bank/bank.routes.js";
import { dashboardRoutes } from "../modules/dashboard/dashboard.routes.js";
import { aiPlatformRoutes, aiRoutes } from "../modules/ai/ai.routes.js";
import { adminAuditRoutes, auditRoutes } from "../modules/audit/audit.routes.js";
import { authContextHook } from "./auth-context.hook.js";
import { auditCaptureHook, auditRecordHook } from "./audit.hook.js";
import { platformAdminHook } from "./platform-admin.hook.js";

/**
 * Gateway / composição de rotas (SPEC seção 4.3). Ponto único que agrega
 * as rotas dos módulos de domínio. Cada módulo novo é registrado aqui sob
 * seu prefixo em /v1.
 *
 * - /health*        → público, sem tenant
 * - /webhooks/*     → público na rota; autenticado por segredo do tenant no header
 * - /admin/*        → plataforma (platformAdminHook), NÃO escopado por tenant
 * - /v1/*           → exige tenant (authContextHook aplicado no escopo)
 */
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // Público
  await app.register(healthRoutes);

  // Callback do provedor de assinatura (ZapSign). Fica FORA de /v1: o provedor
  // não manda header de tenant nem token de sessão. O tenant vem da URL e a
  // autenticidade, de um header secreto por tenant (ver signature.routes.ts).
  await app.register(signatureWebhookRoutes, { prefix: "/webhooks/zapsign" });

  // Callback do provedor de cobrança (Asaas), pelo mesmo motivo: sem header de
  // tenant nem sessão. Tenant na URL, autenticidade pelo authToken no header.
  await app.register(paymentWebhookRoutes, { prefix: "/webhooks/asaas" });

  // Administração da plataforma (Super Admin). Fora de /v1: não é escopado por
  // tenant, então o `authContextHook` não se aplica — o gate é o
  // `platformAdminHook` (sessão do Clerk + allowlist PLATFORM_ADMIN_CLERK_IDS).
  await app.register(
    async (admin) => {
      admin.addHook("onRequest", platformAdminHook);
      await admin.register(tenantRoutes, { prefix: "/tenants" });
      // Créditos de IA do tenant (consulta e recarga). Compartilha o prefixo
      // /tenants — os paths são distintos (/:id/credits).
      await admin.register(aiPlatformRoutes, { prefix: "/tenants" });
      // Auditoria global cross-tenant (MOD-SADMIN-04 / SPEC 9.4).
      await admin.register(adminAuditRoutes, { prefix: "/audit" });
    },
    { prefix: "/admin" },
  );

  // Auth público: onboarding cria o tenant (ainda não há tenant a resolver),
  // por isso fica FORA do escopo /v1 tenant-scoped abaixo. Paths não colidem
  // com as rotas de domínio (/v1/auth/* vs /v1/properties, etc.).
  await app.register(authRoutes, { prefix: "/v1/auth" });

  // API versionada, isolada por tenant e autenticada
  await app.register(
    async (v1) => {
      // Resolve identidade (Clerk/dev) + tenant ativo + papéis, e entra no
      // AsyncLocalStorage. As rotas usam `requirePermission(...)` para o RBAC.
      v1.addHook("onRequest", authContextHook);
      // Trilha de auditoria (MOD-AUTH-07): toda mutação de /v1 é registrada, sem
      // que cada módulo precise lembrar. Ver gateway/audit.hook.ts.
      v1.addHook("onSend", auditCaptureHook);
      v1.addHook("onResponse", auditRecordHook);
      await v1.register(propertyRoutes, { prefix: "/properties" });
      // Vistoria: compartilha o prefixo com propertyRoutes — os paths não
      // colidem (tudo pende de /:id/inspection).
      await v1.register(inspectionRoutes, { prefix: "/properties" });
      // Contrato de administração emitido do cadastro do imóvel — mesmo caso:
      // compartilha o prefixo, pende de /:id/administration-contract.
      await v1.register(propertyContractRoutes, { prefix: "/properties" });
      await v1.register(propertyTypeRoutes, { prefix: "/property-types" });
      // Tabelas auxiliares (lookups): cláusulas contratuais e itens de vistoria.
      await v1.register(clauseRoutes, { prefix: "/clauses" });
      await v1.register(inspectionItemRoutes, { prefix: "/inspection-items" });
      await v1.register(districtRoutes, { prefix: "/districts" });
      await v1.register(eventRoutes, { prefix: "/events" });
      // Bancos (contas bancárias da imobiliária) — MOD-FIN.
      await v1.register(bankRoutes, { prefix: "/banks" });
      // Painel inicial: leitura agregada dos demais módulos.
      await v1.register(dashboardRoutes, { prefix: "/dashboard" });
      // Copiloto de IA (MOD-AI): conversa, histórico, créditos e o índice do RAG.
      await v1.register(aiRoutes, { prefix: "/ai" });
      await v1.register(userRoutes, { prefix: "/users" });
      // Trilha do próprio tenant (só leitura — ver audit.routes.ts).
      await v1.register(auditRoutes, { prefix: "/audit" });
      // Busca global da barra do topo (compõe imóveis + pessoas + contratos).
      await v1.register(searchRoutes, { prefix: "/search" });
      // Cadastro da própria imobiliária (nome, CNPJ, CRECI, logo).
      await v1.register(currentTenantRoutes, { prefix: "/tenant" });
      await v1.register(employeeRoutes, { prefix: "/employees" });
      // Cadastro unificado de pessoas (locador/locatário/fiador).
      // Substitui os antigos /v1/customers e /v1/guarantors — a tela /fiadores
      // consome /v1/persons?role=FIADOR.
      await v1.register(personRoutes, { prefix: "/persons" });
      // Cadastro de condomínios (identificação + parâmetros de cobrança).
      await v1.register(condominiumRoutes, { prefix: "/condominiums" });
      await v1.register(brokerRoutes, { prefix: "/brokers" });
      await v1.register(documentRoutes, { prefix: "/documents" });
      // Contratos (locação) + templates (MOD-CONTRATO).
      await v1.register(contractRoutes, { prefix: "/contracts" });
      await v1.register(contractTemplateRoutes, { prefix: "/contract-templates" });
      // Contas a receber (MOD-FIN). Os aluguéis nascem aqui quando o contrato
      // entra em vigência (todas as assinaturas confirmadas).
      await v1.register(receivableRoutes, { prefix: "/receivables" });
      // Contas a pagar (MOD-FIN): o repasse ao proprietário nasce aqui quando um
      // aluguel é baixado, já com a taxa de administração deduzida.
      await v1.register(payableRoutes, { prefix: "/payables" });
      // Envio do repasse por PIX (Asaas). Compartilha o prefixo /payables — os
      // paths não colidem (transfer, sync-transfer).
      await v1.register(payoutRoutes, { prefix: "/payables" });
      // Cobrança bancária (Asaas). Compartilha o prefixo /receivables — os
      // paths não colidem (boleto, sync-charge).
      await v1.register(paymentRoutes, { prefix: "/receivables" });
      await v1.register(paymentSettingsRoutes, { prefix: "/payment-settings" });
      // Assinatura eletrônica (MOD-ASSINATURA). Compartilha o prefixo /contracts
      // com contractRoutes — os paths não colidem (send-to-sign, signature…).
      await v1.register(signatureRoutes, { prefix: "/contracts" });
      await v1.register(signatureSettingsRoutes, { prefix: "/signature-settings" });
    },
    { prefix: "/v1" },
  );
}
