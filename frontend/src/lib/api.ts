/**
 * Cliente do backend (Server Components).
 *
 * Autenticação (MOD-AUTH-05): `authHeaders()` repassa o JWT da sessão do Clerk
 * como `Authorization: Bearer`. Sem sessão (dev sem Clerk configurado), cai no
 * fallback de desenvolvimento: `x-tenant-id` + `x-dev-roles` (o backend só
 * aceita esse fallback com AUTH_DEV_MODE ligado, nunca em produção).
 *
 * Endpoints REAIS hoje: /v1/dashboard/summary, /v1/properties (+ /:id/owners), /v1/property-types,
 * /v1/persons (cadastro unificado; /fiadores usa ?role=FIADOR), /v1/employees,
 * /v1/users, /admin/tenants. Os demais módulos usam lib/sample.ts.
 */
import { auth } from "@clerk/nextjs/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001";
const DEMO_TENANT_ID =
  process.env.DEMO_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";
// Papéis usados no fallback de dev (quando não há sessão Clerk). ADMIN mantém o
// painel funcional em desenvolvimento; em produção o token real define os papéis.
const DEV_ROLES = process.env.DEV_ROLES ?? "ADMIN";

/**
 * Headers de autenticação para o backend. Server-side apenas.
 * Preferência: token do Clerk; fallback: headers de dev.
 */
async function authHeaders(): Promise<Record<string, string>> {
  try {
    const { getToken } = await auth();
    const token = await getToken();
    // Com token, mandamos SÓ o token. Enviar os headers de dev junto significava
    // que qualquer sessão do Clerk vinha acompanhada de "sou ADMIN do tenant
    // demo" — bastava o backend estar em dev-mode (ou o token falhar) para toda
    // sessão do navegador virar ADMIN. Um pedido tem uma identidade só.
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {
    // Clerk não configurado/sem contexto de request — usa o fallback de dev.
  }
  // Sem sessão: fallback de desenvolvimento. O backend só o honra com
  // AUTH_DEV_MODE=true E NODE_ENV=development; em qualquer outro lugar dá 401.
  return { "x-tenant-id": DEMO_TENANT_ID, "x-dev-roles": DEV_ROLES };
}

/* --------------------------------------------------------------- Tipos */

/* Painel inicial (MOD-DASHBOARD) — espelha backend/modules/dashboard/schema. */
export interface DashboardReceivableBrief {
  id: string;
  dueDate: string;
  amountCents: number;
  status: string;
  kind: string;
  description: string | null;
  payerName: string | null;
}

export interface DashboardSummary {
  properties: {
    total: number;
    available: number;
    reserved: number;
    rented: number;
    sold: number;
    createdLast30Days: number;
  };
  contracts: {
    active: number;
    inSignature: number;
    draft: number;
    endingSoon: number;
  };
  persons: { landlords: number; tenants: number; guarantors: number };
  /** `null` quando o usuário não tem permissão financeira. */
  finance: {
    receivedThisMonthCents: number;
    openThisMonthCents: number;
    overdueCents: number;
    overdueCount: number;
    monthlyRevenue: { month: string; receivedCents: number }[];
    upcoming: DashboardReceivableBrief[];
    overdue: DashboardReceivableBrief[];
  } | null;
}

export interface PropertyOwner {
  id: string;
  personId: string;
  personName: string;
  sharePercent: number;
}

export interface PropertyPhoto {
  id: string;
  propertyId: string;
  /** URL presignada (temporária) do object storage. */
  url: string;
  caption: string | null;
  position: number;
  createdAt: string;
}

export interface Property {
  id: string;
  code?: number | null;
  title: string;
  kind: string;
  purpose?: string;
  propertyTypeId?: string | null;
  isDevelopment?: boolean;
  status: string;
  priceCents: number | null;

  contractNumber?: string | null;
  condominiumId?: string | null;
  isCommercial?: boolean;

  address?: string | null;
  number?: string | null;
  district?: string | null;
  city: string | null;
  state: string | null;
  zip?: string | null;
  keysLocation?: string | null;
  hasSign?: boolean;
  positionFront?: boolean;
  positionBack?: boolean;

  bedrooms: number | null;
  builtArea?: number | null;
  landArea?: number | null;
  floorInfo?: string | null;
  ceilingInfo?: string | null;
  electricityMeter?: string | null;
  waterMeter?: string | null;
  dependencies?: string | null;
  allowPets?: boolean;
  allowStudents?: boolean;

  condoFeeCents?: number | null;
  iptuCents?: number | null;
  iptuChargedTo?: string | null;
  iptuReimburseOwner?: boolean;
  iptuInstallments?: number | null;
  iptuInstallmentCents?: number | null;
  adminFeePercent?: number | null;
  chargeAdminFee?: boolean;
  isGuaranteed?: boolean;

  leaseTermMonths?: number | null;
  leaseStart?: string | null;
  penaltyInfo?: string | null;
  hasCommission?: boolean;
  commissionType?: string | null;
  entryDate?: string | null;

  brokerId?: string | null;
  capturerId?: string | null;
  extraData?: string | null;
  publishWeb?: boolean;
  hasPhotos?: boolean;
  notes?: string | null;

  // Venda — autorização de venda / documentação
  isAuthorized?: boolean;
  isExclusive?: boolean;
  authTerm?: string | null;
  authDays?: number | null;
  authExpiry?: string | null;
  isRecorded?: boolean;
  hasDeed?: boolean;
  isRegistered?: boolean;
  isSold?: boolean;
  registryOffice?: string | null;
  registrationNumber?: string | null;

  // Venda — medidas do terreno
  topography?: string | null;
  lotNumber?: string | null;
  blockNumber?: string | null;
  frontMeasure?: string | null;
  backMeasure?: string | null;
  leftMeasure?: string | null;
  rightMeasure?: string | null;

  owners?: PropertyOwner[];
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  cnpj?: string | null;
  creci?: string | null;
  domain: string | null;
  logoUrl: string | null;
  plan: string;
  status: "trial" | "active" | "suspended" | "inactive" | "canceled";
  createdAt: string;
  updatedAt: string;
}

export interface PropertyType {
  id: string;
  name: string;
  active: boolean;
}

/** Cláusula contratual (lookup) — tela "Tabelas". */
export interface Clause {
  id: string;
  name: string;
  description: string;
  active: boolean;
}

/** Item de vistoria (lookup) — tela "Tabelas". */
export interface InspectionItem {
  id: string;
  description: string;
  active: boolean;
}

/** Bairro (lookup) — tela "Tabelas". Apenas o nome. */
export interface District {
  id: string;
  name: string;
  active: boolean;
}

/** Evento financeiro (lookup) — tela "Tabelas". */
export interface Event {
  id: string;
  name: string;
  kind: "DEBITO" | "CREDITO";
  interestPercent: number;
  judicialInterestPercent: number;
  penaltyPercent: number;
  appliesAdminFee: boolean;
  active: boolean;
}

/**
 * Banco (conta bancária da imobiliária) — tela "Financeiro". Código, nome,
 * agência, conta e favorito são editáveis; Saldo/Cofre/Em Trânsito são derivados
 * da movimentação financeira (rotinas futuras) e somente-leitura. `probableBalanceCents`
 * (Provável Saldo) é calculado pelo backend: Saldo + Em Trânsito.
 */
export interface Bank {
  id: string;
  code: number;
  name: string;
  agency: string | null;
  accountNumber: string | null;
  favorite: boolean;
  balanceCents: number;
  vaultCents: number;
  inTransitCents: number;
  probableBalanceCents: number;
  active: boolean;
}

/** Corretor parceiro (tela "Cadastro de Corretores"). */
export interface Broker {
  id: string;
  code: number;
  name: string;
  address: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  mobile: string | null;
  cpf: string | null;
  rg: string | null;
  commissionPercent: number;
  active: boolean;
}

/** Endereço de uma pessoa (residencial/comercial). */
export interface PersonAddress {
  id?: string;
  kind: "RESIDENCIAL" | "COMERCIAL";
  street?: string;
  number?: string;
  district?: string;
  city?: string;
  state?: string;
  zip?: string;
  phone?: string;
  mobile?: string;
  fax?: string;
  email?: string;
}

export interface Employee {
  id: string;
  userId: string;
  fullName: string;
  email: string;
  cpf: string;
  position: string;
  hiredAt: string | null;
  accessStatus: "ATIVO" | "SUSPENSO" | "REVOGADO";
  /** users.status: "invited" (convite pendente) | "active" | "disabled". */
  userStatus: string;
  roles: string[];
}

export interface PersonSearchProfile {
  id: string;
  intent: "COMPRA" | "LOCACAO";
  minPriceCents: number | null;
  maxPriceCents: number | null;
  propertyTypes: string[];
  districts: string[];
  bedroomsMin?: number | null;
}

export type PersonRole = "LOCADOR" | "LOCATARIO" | "FIADOR";

/**
 * Pessoa unificada (MOD-PESSOA): locador/locatário/fiador no mesmo registro,
 * distinguidos por `roles[]`. Substitui os antigos Customer/Guarantor.
 */
export interface Person {
  id: string;
  roles: string[];
  personType: string;
  fullName: string;
  cpfCnpj: string | null;
  rg: string | null;
  rgIssuer: string | null;
  gender: string | null;
  birthDate: string | null;
  maritalStatus: string | null;
  nationality: string | null;
  occupation: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  bank: string | null;
  agency: string | null;
  account: string | null;
  holderName: string | null;
  paymentAuthorization: string | null;
  spouseName: string | null;
  spouseCpf: string | null;
  spouseRg: string | null;
  spouseOccupation: string | null;
  spouseBirthDate: string | null;
  notes: string | null;
  references: string | null;
  stage: "LEAD" | "CLIENTE" | "INQUILINO" | "COMPRADOR" | "INATIVO";
  source: string;
  status: string;
  assignedBrokerId: string | null;
  addresses: PersonAddress[];
  searchProfiles: PersonSearchProfile[];
}

/**
 * Condomínio (MOD-CONDOMINIO) — cadastro + parâmetros financeiros de cobrança.
 * `balanceCents` (Saldo) é derivado da movimentação (somente leitura).
 */
export interface Condominium {
  id: string;
  name: string;
  address: string | null;
  number: string | null;
  district: string | null;
  zip: string | null;
  city: string | null;
  state: string | null;
  balanceCents: number;
  adminFeePercent: number;
  adminFeeFixedCents: number;
  interestPercent: number;
  penaltyPercent: number;
}

/** Despesa lançada em um condomínio (tela "Cadastro de Despesas"). */
export interface CondominiumExpense {
  id: string;
  condominiumId: string;
  /** "Lancto nº" — sequencial por tenant, atribuído no backend. */
  seq: number | null;
  entryDate: string | null;
  eventId: string | null;
  eventName: string | null;
  amountCents: number;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Parte de um contrato (locador/locatário/fiador). */
export interface ContractParty {
  id: string;
  contractId: string;
  role: "LOCADOR" | "LOCATARIO" | "FIADOR" | string;
  personId: string;
  personName: string;
  signedAt: string | null;
}

/** Template de contrato do tenant (HTML com variáveis {{...}}). */
export interface ContractTemplate {
  id: string;
  name: string;
  /** Corpo do modelo em texto puro (modelos legados podem trazer HTML). */
  content?: string;
  variables: string[];
  active: boolean;
}

/** Signatário de um envelope de assinatura (MOD-ASSINATURA). */
export interface SignatureSigner {
  id: string;
  partyId: string | null;
  role: string | null;
  name: string;
  email: string | null;
  signUrl: string | null;
  status: string; // PENDENTE | ASSINADO | RECUSADO
  signedAt: string | null;
}

/** Envio do contrato ao provedor de assinatura (ZapSign). */
export interface SignatureEnvelope {
  id: string;
  contractId: string;
  version: number | null;
  provider: string;
  status: string; // PENDENTE | ASSINADO | RECUSADO | CANCELADO | EXPIRADO
  authMode: string;
  sandbox: boolean;
  hasSignedPdf: boolean;
  signedAt: string | null;
  createdAt: string;
  signers: SignatureSigner[];
}

/** Conexão da conta ZapSign do tenant. O token nunca vem do backend. */
export interface SignatureSettings {
  connected: boolean;
  provider: string;
  sandbox: boolean;
  authMode: string;
  tokenHint: string | null;
  webhookUrl: string;
  webhookRegisteredAt: string | null;
  updatedAt: string | null;
}

/** Um acerto da busca global (já normalizado pelo backend). */
export interface SearchHit {
  kind: "imovel" | "pessoa" | "contrato";
  id: string;
  label: string;
  sub: string | null;
  /** Destino no app, já com `?q=` para a lista chegar filtrada. */
  href: string;
}

export interface SearchResults {
  imoveis: SearchHit[];
  pessoas: SearchHit[];
  contratos: SearchHit[];
  total: number;
}

/** Configuração da cobrança bancária do tenant (MOD-FIN / Asaas). */
export interface PaymentSettings {
  connected: boolean;
  provider: string;
  sandbox: boolean;
  /** UNDEFINED = fatura com boleto e PIX; BOLETO ou PIX restringem. */
  billingType: string;
  apiKeyHint: string | null;
  webhookUrl: string;
  webhookRegisteredAt: string | null;
  updatedAt: string | null;
}

/**
 * Variável dinâmica (merge field) disponível nos templates. O catálogo vem do
 * backend — é a mesma lista que a geração do PDF sabe preencher.
 */
export interface MergeField {
  key: string;
  label: string;
  group: string;
  example: string;
}

/**
 * Contrato de locação (MOD-CONTRATO) — espelha a tela legada "Contratos de
 * Locação". Valores monetários em centavos; percentuais 0–100; datas ISO.
 */
export interface Contract {
  id: string;
  code: number | null;
  propertyId: string | null;
  templateId: string | null;
  status: string;

  startsAt: string | null;
  endsAt: string | null;
  termMonths: number | null;
  readjustIndex: string;
  readjustPeriodMonths: number | null;
  lastReadjustAt: string | null;
  ownerPayDay: number | null;
  tenantPayDay: number | null;
  terminatedAt: string | null;

  rentalValueCents: number | null;
  interestPercent: number | null;
  penaltyPercent: number | null;
  adminFeePercent: number | null;
  isAdministration: boolean;
  incomeTaxDeclaration: boolean;
  iptuChargedTo: string | null;
  commissionType: string | null;
  hasCommission: boolean;

  guaranteeKind: string | null;
  hasInsurance: boolean;
  insuranceDescription: string | null;
  insuranceValueCents: number | null;

  isSettled: boolean;
  hasEvictionOrder: boolean;
  hasJudicialExecution: boolean;
  processNumber: string | null;
  court: string | null;

  specialClauses: string | null;
  guarantorPropertyInfo: string | null;

  parties: ContractParty[];
  latestVersion: number | null;
  createdAt: string;
  updatedAt: string;
}

/** Conta a receber (MOD-FIN). Os aluguéis nascem da assinatura do contrato. */
export interface Receivable {
  id: string;
  contractId: string | null;
  propertyId: string | null;
  payerPersonId: string | null;
  payerName: string | null;
  kind: string;
  description: string | null;
  competence: string | null;
  installment: number | null;
  installmentsTotal: number | null;
  amountCents: number;
  dueDate: string;
  status: string;
  paidAt: string | null;
  paidAmountCents: number | null;
  /** Cobrança no Asaas — nulos enquanto a conta do tenant não está conectada. */
  asaasChargeId: string | null;
  /** PDF do boleto registrado, hospedado no provedor. */
  boletoUrl: string | null;
  invoiceUrl: string | null;
}

/* ------------------------------------------------------------- Helpers */
async function get<T>(
  path: string,
  headers: Record<string, string> = {},
): Promise<T | null> {
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      headers: { ...(await authHeaders()), ...headers },
      cache: "no-store",
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: T };
    return json.data;
  } catch {
    // Backend indisponível (ex.: infra não subiu) — a página cai no fallback.
    return null;
  }
}

/** Resumo do painel inicial (/v1/dashboard/summary). */
export function fetchDashboardSummary(): Promise<DashboardSummary | null> {
  return get<DashboardSummary>("/v1/dashboard/summary");
}

/** Imóveis do tenant da sessão. Retorna null se o backend não responder. */
export function fetchProperties(): Promise<Property[] | null> {
  return get<Property[]>("/v1/properties");
}

/** Tenants da plataforma (Super Admin). */
export function fetchTenants(): Promise<Tenant[] | null> {
  return get<Tenant[]>("/admin/tenants");
}

/**
 * Tenant atualmente logado. Usado pelo layout admin para exibir nome + logo da
 * imobiliária na sidebar. Enquanto a rota de tenant da sessão não existe, usa o
 * tenant demo (o vínculo real vem do claim do JWT).
 */
export function fetchCurrentTenant(): Promise<Tenant | null> {
  // /v1/tenant resolve a imobiliária pelo contexto da sessão — não mais pelo id
  // do tenant demo cravado aqui, que mostrava a marca errada para qualquer
  // outro tenant.
  return get<Tenant>("/v1/tenant");
}

/**
 * Perfil do usuário logado (papéis no sistema). O nome/e-mail vem do Clerk; aqui
 * só resolvemos os papéis do token (ou fallback de dev). Usado pelo topbar.
 */
export function fetchCurrentUser(): Promise<{ userId: string | null; roles: string[] } | null> {
  return get<{ userId: string | null; roles: string[] }>("/v1/users/me");
}

/** Tipos de imóvel (lookup) do tenant da sessão. */
export function fetchPropertyTypes(): Promise<PropertyType[] | null> {
  return get<PropertyType[]>("/v1/property-types");
}

/** Cláusulas contratuais (lookup) do tenant da sessão. */
export function fetchClauses(): Promise<Clause[] | null> {
  return get<Clause[]>("/v1/clauses");
}

/** Itens de vistoria (lookup) do tenant da sessão. */
export function fetchInspectionItems(): Promise<InspectionItem[] | null> {
  return get<InspectionItem[]>("/v1/inspection-items");
}

/** Bairros (lookup) do tenant da sessão. */
export function fetchDistricts(): Promise<District[] | null> {
  return get<District[]>("/v1/districts");
}

/** Eventos financeiros (lookup) do tenant da sessão. */
export function fetchEvents(): Promise<Event[] | null> {
  return get<Event[]>("/v1/events");
}

/** Bancos (contas bancárias) do tenant da sessão. */
export function fetchBanks(): Promise<Bank[] | null> {
  return get<Bank[]>("/v1/banks");
}

/** Corretores parceiros do tenant da sessão. */
export function fetchBrokers(): Promise<Broker[] | null> {
  return get<Broker[]>("/v1/brokers");
}

/** Funcionários (colaboradores internos) do tenant da sessão. */
export function fetchEmployees(): Promise<Employee[] | null> {
  return get<Employee[]>("/v1/employees");
}

/**
 * Pessoas do tenant da sessão (cadastro unificado). Opcionalmente filtra por
 * papel (ex.: `fetchPersons("FIADOR")` para a tela de fiadores).
 */
export function fetchPersons(role?: PersonRole): Promise<Person[] | null> {
  const q = role ? `?role=${encodeURIComponent(role)}` : "";
  return get<Person[]>(`/v1/persons${q}`);
}

/**
 * Uma pessoa pelo id — ficha COMPLETA (endereços, perfis de busca e
 * interações), que a listagem não traz. É o que o formulário de edição carrega.
 */
export function fetchPerson(id: string): Promise<Person | null> {
  return get<Person>(`/v1/persons/${id}`);
}

/** Condomínios do tenant da sessão. */
export function fetchCondominiums(): Promise<Condominium[] | null> {
  return get<Condominium[]>("/v1/condominiums");
}

/** Um condomínio pelo id. */
export function fetchCondominium(id: string): Promise<Condominium | null> {
  return get<Condominium>(`/v1/condominiums/${id}`);
}

/**
 * Imóveis vinculados a um condomínio (tela "Consulta Condôminos"). Retorna null
 * se o backend não responder.
 */
export function fetchPropertiesByCondominium(
  condominiumId: string,
): Promise<Property[] | null> {
  return get<Property[]>(`/v1/properties?condominiumId=${encodeURIComponent(condominiumId)}`);
}

/** Despesas lançadas em um condomínio (tela "Cadastro de Despesas"). */
export function fetchCondominiumExpenses(
  condominiumId: string,
): Promise<CondominiumExpense[] | null> {
  return get<CondominiumExpense[]>(`/v1/condominiums/${condominiumId}/expenses`);
}

/** Contratos do tenant da sessão. */
export function fetchContracts(): Promise<Contract[] | null> {
  return get<Contract[]>("/v1/contracts");
}

/**
 * Contas a receber do tenant da sessão. `contractId` filtra as parcelas de um
 * contrato (usado na ficha do contrato).
 */
/** Um mês do gráfico de fluxo de caixa (agregado no backend). */
export interface CashFlowPoint {
  /** YYYY-MM. */
  month: string;
  /** Caixa realizado no mês (parcelas com baixa, pela data do pagamento). */
  receivedCents: number;
  /** Previsto no mês (tudo que vencia nele, pago ou não). */
  expectedCents: number;
}

/** Série do fluxo de caixa: `months` meses para trás, incluindo o corrente. */
export function fetchCashFlow(months = 6): Promise<CashFlowPoint[] | null> {
  return get<CashFlowPoint[]>(`/v1/receivables/cash-flow?months=${months}`);
}

export function fetchReceivables(params?: {
  contractId?: string;
  status?: string;
}): Promise<Receivable[] | null> {
  const query = new URLSearchParams();
  if (params?.contractId) query.set("contractId", params.contractId);
  if (params?.status) query.set("status", params.status);
  const qs = query.toString();
  return get<Receivable[]>(`/v1/receivables${qs ? `?${qs}` : ""}`);
}

/** Um contrato pelo id. */
export function fetchContract(id: string): Promise<Contract | null> {
  return get<Contract>(`/v1/contracts/${id}`);
}

/**
 * Templates de contrato do tenant da sessão. `includeInactive` traz também os
 * desativados — usado pela tela de manutenção em "Tabelas".
 */
export function fetchContractTemplates(
  includeInactive = false,
): Promise<ContractTemplate[] | null> {
  return get<ContractTemplate[]>(
    `/v1/contract-templates${includeInactive ? "?all=true" : ""}`,
  );
}

/** Envelope de assinatura mais recente do contrato (null se nunca enviado). */
export function fetchContractSignature(contractId: string): Promise<SignatureEnvelope | null> {
  return get<SignatureEnvelope>(`/v1/contracts/${contractId}/signature`);
}

/** Configuração da integração de assinatura do tenant. */
export function fetchSignatureSettings(): Promise<SignatureSettings | null> {
  return get<SignatureSettings>("/v1/signature-settings");
}

/** Busca global (barra do topo): imóveis, pessoas e contratos do tenant. */
export function fetchSearch(q: string): Promise<SearchResults | null> {
  return get<SearchResults>(`/v1/search?q=${encodeURIComponent(q)}`);
}

/** Configuração da cobrança bancária (Asaas) do tenant. */
export function fetchPaymentSettings(): Promise<PaymentSettings | null> {
  return get<PaymentSettings>("/v1/payment-settings");
}

/** Catálogo de variáveis dinâmicas aceitas nos templates. */
export function fetchMergeFields(): Promise<MergeField[] | null> {
  return get<MergeField[]>("/v1/contract-templates/merge-fields");
}

/** Fotos de um imóvel (data URL base64 — Fase 0). */
export function fetchPropertyPhotos(propertyId: string): Promise<PropertyPhoto[] | null> {
  return get<PropertyPhoto[]>(`/v1/properties/${propertyId}/photos`);
}

type JsonResult = { ok: true; data: unknown } | { ok: false; error: string };

/**
 * Envia JSON server-side ao backend com o header de tenant (Fase 0).
 * Usado por Server Actions. Retorna { ok } ou { ok:false, error }.
 */
export async function sendJson(
  method: "POST" | "PATCH" | "PUT" | "DELETE",
  path: string,
  body?: unknown,
): Promise<JsonResult> {
  try {
    // Só declara Content-Type: application/json quando HÁ corpo. Um DELETE
    // (sem body) com esse header faz o Fastify rejeitar com
    // FST_ERR_CTP_EMPTY_JSON_BODY ("Body cannot be empty…") → 500.
    const hasBody = body !== undefined;
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method,
      headers: {
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
        ...(await authHeaders()),
      },
      body: hasBody ? JSON.stringify(body) : undefined,
      cache: "no-store",
    });
    const json = (await res.json().catch(() => ({}))) as {
      data?: unknown;
      error?: { message?: string; details?: unknown };
    };
    if (!res.ok) {
      return { ok: false, error: json.error?.message ?? `Erro ${res.status}` };
    }
    return { ok: true, data: json.data };
  } catch {
    return { ok: false, error: "Backend indisponível. Suba a infra (npm run dev)." };
  }
}

/** Atalho POST (compatível com os callers existentes). */
export function postJson(path: string, body: unknown): Promise<JsonResult> {
  return sendJson("POST", path, body);
}

/** Atalho PATCH. */
export function patchJson(path: string, body: unknown): Promise<JsonResult> {
  return sendJson("PATCH", path, body);
}

/** Atalho DELETE. */
export function deleteJson(path: string): Promise<JsonResult> {
  return sendJson("DELETE", path);
}

/* ------------------------------------------------------------ Formatos */
// Moram em lib/format.ts (sem `server-only`) para poderem ser usados também por
// Client Components; reexportados aqui para não mexer nos callers existentes.
export { formatDate, formatDay, formatPrice } from "./format";

export const propertyKindLabel: Record<string, string> = {
  sale: "Venda",
  rent: "Locação",
  season: "Temporada",
  commercial: "Comercial",
  rural: "Rural",
  land: "Terreno",
};

/** Finalidade (venda/locação/temporada) — distinta do tipo do imóvel. */
export const propertyPurposeLabel: Record<string, string> = {
  sale: "Venda",
  rent: "Locação",
  season: "Temporada",
};
