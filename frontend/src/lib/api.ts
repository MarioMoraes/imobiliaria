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
 *
 * Este também é o gate de sessão das **Server Actions**: os layouts protegidos
 * (`lib/auth-guard.ts`) não rodam quando o navegador invoca uma action, então
 * sem esta checagem qualquer um poderia disparar as ~70 actions do painel.
 * Como toda action chega ao backend por aqui, um único ponto cobre todas.
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
    // Clerk não configurado/sem contexto de request — cai no tratamento abaixo.
  }
  // Sem sessão em produção: não há a quem se passar. Falhar aqui evita gastar a
  // ida ao backend (que responderia 401) e mantém a recusa explícita.
  if (process.env.NODE_ENV === "production") {
    throw new Error("UNAUTHENTICATED");
  }
  // Em desenvolvimento, fallback do tenant demo. O backend só o honra com
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
    /* A série do gráfico vem de fetchCashFlow() — mesma fonte da Gestão Financeira. */
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

/** Estado do item na vistoria. Três caixas na tela, mutuamente exclusivas. */
export type InspectionCondition = "BOM" | "MEDIO" | "RUIM";

/** Uma linha do checklist de vistoria — nasce do catálogo de Itens de Vistoria. */
export interface PropertyInspectionEntry {
  id: string;
  inspectionId: string;
  inspectionItemId: string | null;
  /** Snapshot da descrição: a linha sobrevive à exclusão do item no catálogo. */
  description: string;
  position: number;
  quantity: number;
  condition: InspectionCondition | null;
  notes: string | null;
}

/** Cabeçalho da vistoria — uma por imóvel; `seq` é o "Número" da tela legada. */
export interface PropertyInspection {
  id: string;
  propertyId: string;
  seq: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** O que a tela de vistoria consome numa chamada só. */
export interface PropertyInspectionView {
  inspection: PropertyInspection;
  entries: PropertyInspectionEntry[];
  property: { id: string; code: number | null; title: string; address: string };
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
  /** Chave PIX do repasse (CPF|CNPJ|EMAIL|PHONE|EVP em `pixKeyType`). */
  pixKey: string | null;
  pixKeyType: string | null;
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

/**
 * Conta a pagar (MOD-FIN). Hoje é o repasse ao proprietário: nasce quando um
 * aluguel é baixado, já com a taxa de administração deduzida.
 */
export interface Payable {
  id: string;
  contractId: string | null;
  propertyId: string | null;
  /** Parcela de aluguel que originou o repasse. */
  receivableId: string | null;
  payeePersonId: string;
  payeeName: string | null;
  /** Código do imóvel (sequencial por tenant), não o UUID. */
  propertyCode: number | null;
  kind: string;
  description: string | null;
  competence: string | null;
  /** Participação do dono no imóvel — o rateio entre coproprietários. */
  sharePercent: number;
  /** Parte do aluguel que cabe a este dono, antes da taxa. */
  grossCents: number;
  adminFeePercent: number;
  /** Taxa de administração retida — é a receita da imobiliária. */
  adminFeeCents: number;
  /** Líquido a pagar: bruto menos a taxa. */
  amountCents: number;
  dueDate: string;
  status: string;
  paidAt: string | null;
  paidAmountCents: number | null;
  /** Transferência PIX no Asaas — nulos enquanto o repasse não foi enviado. */
  asaasTransferId: string | null;
  transferStatus: string | null;
  /** Motivo da recusa; o repasse volta a ABERTO para o operador corrigir. */
  transferFailedReason: string | null;
}

/** Indicadores do mês de repasses (agregados no backend). */
export interface PayableSummary {
  month: string;
  openCents: number;
  paidCents: number;
  overdueCents: number;
  overdueCount: number;
  /** Taxa de administração apurada no mês — receita da imobiliária. */
  adminFeeCents: number;
  pendingCount: number;
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

/**
 * Vistoria do imóvel. O backend cria a vistoria e materializa as linhas a
 * partir do catálogo na primeira chamada — por isso um GET já devolve a lista
 * pronta para preencher.
 */
export function fetchPropertyInspection(
  propertyId: string,
): Promise<PropertyInspectionView | null> {
  return get<PropertyInspectionView>(`/v1/properties/${propertyId}/inspection`);
}

/**
 * Laudo de vistoria em PDF — devolve a `Response` CRUA, não JSON: quem chama é
 * o route handler que repassa os bytes ao navegador (ver fetchPayoutReport).
 */
export async function fetchInspectionReport(propertyId: string): Promise<Response> {
  return fetch(`${BACKEND_URL}/v1/properties/${propertyId}/inspection/report`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
}

/**
 * Contrato de administração do imóvel em PDF — `Response` crua, como o laudo de
 * vistoria. As testemunhas são digitadas na emissão (popup) e vão na query.
 */
export async function fetchAdministrationContract(
  propertyId: string,
  witnesses: { first: string; second: string },
): Promise<Response> {
  const qs = new URLSearchParams({
    testemunha1: witnesses.first,
    testemunha2: witnesses.second,
  });
  return fetch(
    `${BACKEND_URL}/v1/properties/${propertyId}/administration-contract?${qs}`,
    { headers: await authHeaders(), cache: "no-store" },
  );
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

/* ------------------------------------------------------- Copiloto (MOD-AI) */

export interface AiCredits {
  balance: number;
  reserved: number;
  used: number;
  /** balance - reserved: o que dá para gastar agora. */
  available: number;
}

export interface AiConversation {
  id: string;
  channel: string;
  status: string;
  sentiment: string | null;
  unresolvedAttempts: number;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AiMessage {
  id: string;
  role: string;
  content: string;
  tokens: number;
  createdAt: string;
}

export interface AiToolCall {
  id: string;
  tool: string;
  input: unknown;
  output: string | null;
  status: string;
  durationMs: number | null;
  createdAt: string;
}

export interface AiConversationDetail extends AiConversation {
  messages: AiMessage[];
  toolCalls: AiToolCall[];
}

/** Saldo de créditos de IA do tenant. Null quando a rota falha (sem permissão). */
export function fetchAiCredits(): Promise<AiCredits | null> {
  return get<AiCredits>("/v1/ai/credits");
}

/** Conversas do copiloto (mais recentes primeiro). */
export function fetchAiConversations(): Promise<AiConversation[] | null> {
  return get<AiConversation[]>("/v1/ai/conversations");
}

/** Uma conversa com histórico e trilha de ferramentas. */
export function fetchAiConversation(id: string): Promise<AiConversationDetail | null> {
  return get<AiConversationDetail>(`/v1/ai/conversations/${id}`);
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
  /** Mês de referência (YYYY-MM): competência da parcela, ou o mês do vencimento nas avulsas. */
  competence?: string;
}): Promise<Receivable[] | null> {
  const query = new URLSearchParams();
  if (params?.contractId) query.set("contractId", params.contractId);
  if (params?.status) query.set("status", params.status);
  if (params?.competence) query.set("competence", params.competence);
  const qs = query.toString();
  return get<Receivable[]>(`/v1/receivables${qs ? `?${qs}` : ""}`);
}

export function fetchPayables(params?: {
  contractId?: string;
  payeePersonId?: string;
  status?: string;
  /** Competência do aluguel que originou o repasse. */
  competence?: string;
  /** Mês de VENCIMENTO (YYYY-MM) — é por ele que a tela de repasses filtra. */
  dueMonth?: string;
  limit?: number;
}): Promise<Payable[] | null> {
  const query = new URLSearchParams();
  if (params?.contractId) query.set("contractId", params.contractId);
  if (params?.payeePersonId) query.set("payeePersonId", params.payeePersonId);
  if (params?.status) query.set("status", params.status);
  if (params?.competence) query.set("competence", params.competence);
  if (params?.dueMonth) query.set("dueMonth", params.dueMonth);
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return get<Payable[]>(`/v1/payables${qs ? `?${qs}` : ""}`);
}

/**
 * Indicadores do mês. Vêm agregados do backend em vez de somados aqui porque a
 * listagem tem limite — somar a página traria cards que mentem conforme a
 * carteira cresce.
 */
export function fetchPayableSummary(month?: string): Promise<PayableSummary | null> {
  return get<PayableSummary>(`/v1/payables${month ? `/summary?month=${month}` : "/summary"}`);
}

/**
 * Relatório de repasses em PDF — devolve a `Response` CRUA, não JSON: quem chama
 * é o route handler que repassa os bytes ao navegador. É a única rota do backend
 * que responde arquivo em vez do envelope `{ data }`.
 */
export async function fetchPayoutReport(month: string): Promise<Response> {
  return fetch(`${BACKEND_URL}/v1/payables/report?month=${encodeURIComponent(month)}`, {
    headers: await authHeaders(),
    cache: "no-store",
  });
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

/* ---------------------------------------------------------- Documentos */

/** A que um documento se prende (MOD-DOC). */
export type DocumentEntityType = "PROPERTY" | "PERSON" | "CONTRACT";

export interface DocumentRecord {
  id: string;
  entityType: string;
  entityId: string;
  kind: string;
  fileName: string | null;
  mime: string | null;
  sizeBytes: number | null;
  expiresAt: string | null;
  status: string;
  currentVersion: number;
  /** Derivado da validade pelo backend — nenhuma rotina precisa ter rodado. */
  expired: boolean;
  /** Presignada e curta; nula depois do expurgo. */
  url: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentCounts {
  total: number;
  expiring30: number;
  expired: number;
}

/** Documentos do tenant, opcionalmente filtrados por entidade/natureza. */
export function fetchDocuments(filters: {
  entityType?: DocumentEntityType;
  entityId?: string;
  kind?: string;
} = {}): Promise<DocumentRecord[] | null> {
  const qs = new URLSearchParams(
    Object.entries(filters).filter(([, v]) => !!v) as [string, string][],
  );
  const suffix = qs.size ? `?${qs}` : "";
  return get<DocumentRecord[]>(`/v1/documents${suffix}`);
}

/** Contadores da biblioteca (total, a vencer em 30 dias, vencidos). */
export function fetchDocumentCounts(): Promise<DocumentCounts | null> {
  return get<DocumentCounts>("/v1/documents/summary");
}

/* ---------------------------------------------------------- Auditoria */

/** Uma linha da trilha (MOD-AUTH-07). Espelha backend/modules/audit/schema. */
export interface AuditLog {
  id: string;
  tenantId: string;
  /** Só na visão global do Super Admin. */
  tenantName?: string;
  userId: string | null;
  actorLabel: string | null;
  action: string;
  entity: string;
  entityId: string | null;
  payload: unknown;
  ipAddress: string | null;
  requestId: string | null;
  status: "OK" | "DENIED";
  createdAt: string;
}

export interface AuditPage {
  items: AuditLog[];
  total: number;
  page: number;
  limit: number;
}

export interface AuditSummary {
  last24h: number;
  sensitive24h: number;
  ai24h: number;
  denied24h: number;
}

export interface AuditFilters {
  action?: string;
  entity?: string;
  entityId?: string;
  status?: "OK" | "DENIED";
  q?: string;
  from?: string;
  to?: string;
  page?: number;
  limit?: number;
  /** Só na visão global. */
  tenantId?: string;
}

function auditQueryString(filters: AuditFilters): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") qs.set(key, String(value));
  }
  return qs.size ? `?${qs}` : "";
}

/** Trilha do próprio tenant (exige `audit:read` — ADMIN). */
export function fetchAuditLogs(filters: AuditFilters = {}): Promise<AuditPage | null> {
  return get<AuditPage>(`/v1/audit${auditQueryString(filters)}`);
}

/** Trilha global cross-tenant (Super Admin — MOD-SADMIN-04). */
export function fetchGlobalAuditLogs(filters: AuditFilters = {}): Promise<AuditPage | null> {
  return get<AuditPage>(`/admin/audit${auditQueryString(filters)}`);
}

/** Contadores das últimas 24h para os cartões do painel da plataforma. */
export function fetchAuditSummary(): Promise<AuditSummary | null> {
  return get<AuditSummary>("/admin/audit/summary");
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
  } catch (err) {
    // Sem sessão (ver authHeaders): a action foi invocada fora de uma sessão
    // válida. Mensagem própria — "backend indisponível" mandaria o usuário
    // investigar a infra por um problema que é de login.
    if (err instanceof Error && err.message === "UNAUTHENTICATED") {
      return { ok: false, error: "Sessão expirada. Faça login novamente." };
    }
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
