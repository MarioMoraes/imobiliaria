/**
 * Cliente do backend (Server Components).
 *
 * Autenticação (MOD-AUTH-05): `authHeaders()` repassa o JWT da sessão do Clerk
 * como `Authorization: Bearer`. Sem sessão (dev sem Clerk configurado), cai no
 * fallback de desenvolvimento: `x-tenant-id` + `x-dev-roles` (o backend só
 * aceita esse fallback com AUTH_DEV_MODE ligado, nunca em produção).
 *
 * Endpoints REAIS hoje: /v1/properties, /v1/property-types, /v1/guarantors,
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
    if (token) return { Authorization: `Bearer ${token}` };
  } catch {
    // Clerk não configurado/sem contexto de request — usa o fallback de dev.
  }
  return { "x-tenant-id": DEMO_TENANT_ID, "x-dev-roles": DEV_ROLES };
}

/* --------------------------------------------------------------- Tipos */
export interface Property {
  id: string;
  title: string;
  kind: string;
  purpose?: string;
  propertyTypeId?: string | null;
  isDevelopment?: boolean;
  status: string;
  priceCents: number | null;
  city: string | null;
  state: string | null;
  bedrooms: number | null;
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

export interface GuarantorAddress {
  id?: string;
  kind: "RESIDENCIAL" | "COMERCIAL";
  city?: string;
  state?: string;
  street?: string;
}

export interface Guarantor {
  id: string;
  personType: string;
  cpfCnpj: string;
  fullName: string;
  maritalStatus: string | null;
  email: string | null;
  mobile: string | null;
  phone: string | null;
  status: string;
  addresses: GuarantorAddress[];
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

/** Tipos de imóvel (lookup) do tenant da sessão. */
export function fetchPropertyTypes(): Promise<PropertyType[] | null> {
  return get<PropertyType[]>("/v1/property-types");
}

/** Fiadores do tenant da sessão. */
export function fetchGuarantors(): Promise<Guarantor[] | null> {
  return get<Guarantor[]>("/v1/guarantors");
}

type JsonResult = { ok: true; data: unknown } | { ok: false; error: string };

/**
 * Envia JSON server-side ao backend com o header de tenant (Fase 0).
 * Usado por Server Actions. Retorna { ok } ou { ok:false, error }.
 */
export async function sendJson(
  method: "POST" | "PATCH" | "PUT",
  path: string,
  body: unknown,
): Promise<JsonResult> {
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json", ...(await authHeaders()) },
      body: JSON.stringify(body),
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
