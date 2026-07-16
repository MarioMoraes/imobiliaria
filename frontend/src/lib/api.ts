/**
 * Cliente do backend (Server Components).
 *
 * Autenticação (MOD-AUTH-05): `authHeaders()` repassa o JWT da sessão do Clerk
 * como `Authorization: Bearer`. Sem sessão (dev sem Clerk configurado), cai no
 * fallback de desenvolvimento: `x-tenant-id` + `x-dev-roles` (o backend só
 * aceita esse fallback com AUTH_DEV_MODE ligado, nunca em produção).
 *
 * Endpoints REAIS hoje: /v1/properties (+ /:id/owners), /v1/property-types,
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
  // Headers de dev enviados SEMPRE como fallback: o backend só os honra com
  // AUTH_DEV_MODE ligado (nunca em produção). Assim, um usuário logado no Clerk
  // mas ainda sem tenant (pré-onboarding) consegue ver o tenant demo em dev.
  const devFallback = { "x-tenant-id": DEMO_TENANT_ID, "x-dev-roles": DEV_ROLES };
  try {
    const { getToken } = await auth();
    const token = await getToken();
    if (token) return { Authorization: `Bearer ${token}`, ...devFallback };
  } catch {
    // Clerk não configurado/sem contexto de request — usa só o fallback de dev.
  }
  return devFallback;
}

/* --------------------------------------------------------------- Tipos */
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
  maritalStatus: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
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
  return get<Tenant>(`/admin/tenants/${DEMO_TENANT_ID}`);
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

/** Condomínios do tenant da sessão. */
export function fetchCondominiums(): Promise<Condominium[] | null> {
  return get<Condominium[]>("/v1/condominiums");
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
export function formatPrice(cents: number | null): string {
  if (cents === null || cents === undefined) return "—";
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

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
