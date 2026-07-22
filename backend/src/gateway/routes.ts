import type { FastifyInstance } from "fastify";
import { healthRoutes } from "../modules/health/health.routes.js";
import { authRoutes } from "../modules/auth/auth.routes.js";
import { propertyRoutes } from "../modules/property/property.routes.js";
import { propertyTypeRoutes } from "../modules/property-type/property-type.routes.js";
import { clauseRoutes } from "../modules/clause/clause.routes.js";
import { contractRoutes, contractTemplateRoutes } from "../modules/contract/contract.routes.js";
import {
  signatureRoutes,
  signatureSettingsRoutes,
  signatureWebhookRoutes,
} from "../modules/signature/signature.routes.js";
import { receivableRoutes } from "../modules/receivable/receivable.routes.js";
import { searchRoutes } from "../modules/search/search.routes.js";
import {
  paymentRoutes,
  paymentSettingsRoutes,
  paymentWebhookRoutes,
} from "../modules/payment/payment.routes.js";
import { inspectionItemRoutes } from "../modules/inspection-item/inspection-item.routes.js";
import { currentTenantRoutes, tenantRoutes } from "../modules/tenant/tenant.routes.js";
import { userRoutes } from "../modules/user/user.routes.js";
import { employeeRoutes } from "../modules/employee/employee.routes.js";
import { personRoutes } from "../modules/person/person.routes.js";
import { condominiumRoutes } from "../modules/condominium/condominium.routes.js";
import { districtRoutes } from "../modules/district/district.routes.js";
import { eventRoutes } from "../modules/event/event.routes.js";
import { bankRoutes } from "../modules/bank/bank.routes.js";
import { authContextHook } from "./auth-context.hook.js";

/**
 * Gateway / composição de rotas (SPEC seção 4.3). Ponto único que agrega
 * as rotas dos módulos de domínio. Cada módulo novo é registrado aqui sob
 * seu prefixo em /v1.
 *
 * - /health*        → público, sem tenant
 * - /v1/*           → exige tenant (tenantContextHook aplicado no escopo)
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
  // tenant. TODO: proteger com autorização de Super Admin.
  await app.register(tenantRoutes, { prefix: "/admin/tenants" });

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
      await v1.register(propertyRoutes, { prefix: "/properties" });
      await v1.register(propertyTypeRoutes, { prefix: "/property-types" });
      // Tabelas auxiliares (lookups): cláusulas contratuais e itens de vistoria.
      await v1.register(clauseRoutes, { prefix: "/clauses" });
      await v1.register(inspectionItemRoutes, { prefix: "/inspection-items" });
      await v1.register(districtRoutes, { prefix: "/districts" });
      await v1.register(eventRoutes, { prefix: "/events" });
      // Bancos (contas bancárias da imobiliária) — MOD-FIN.
      await v1.register(bankRoutes, { prefix: "/banks" });
      await v1.register(userRoutes, { prefix: "/users" });
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
      // Contratos (locação) + templates (MOD-CONTRATO).
      await v1.register(contractRoutes, { prefix: "/contracts" });
      await v1.register(contractTemplateRoutes, { prefix: "/contract-templates" });
      // Contas a receber (MOD-FIN). Os aluguéis nascem aqui quando o contrato
      // entra em vigência (todas as assinaturas confirmadas).
      await v1.register(receivableRoutes, { prefix: "/receivables" });
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
