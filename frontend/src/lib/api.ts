/**
 * Cliente do backend (Server Components).
 *
 * Fase 0: o tenant é enviado via header `x-tenant-id` (DEMO_TENANT_ID).
 * Na migração p/ Clerk este helper passará a repassar o JWT da sessão — nada
 * mais no frontend muda.
 *
 * Endpoints REAIS hoje: /v1/properties (GET/POST), /admin/tenants (CRUD).
 * Os demais módulos do PRD usam dados de exemplo (lib/sample.ts) até o backend
 * evoluir; a assinatura das funções aqui já está pronta para conectar.
 */
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001";
const DEMO_TENANT_ID =
  process.env.DEMO_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";

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
  domain: string | null;
  plan: string;
  status: "active" | "suspended" | "inactive";
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
      headers,
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

/** Imóveis do tenant demo. Retorna null se o backend não responder. */
export function fetchProperties(): Promise<Property[] | null> {
  return get<Property[]>("/v1/properties", { "x-tenant-id": DEMO_TENANT_ID });
}

/** Tenants da plataforma (Super Admin). */
export function fetchTenants(): Promise<Tenant[] | null> {
  return get<Tenant[]>("/admin/tenants");
}

/** Tipos de imóvel (lookup) do tenant demo. */
export function fetchPropertyTypes(): Promise<PropertyType[] | null> {
  return get<PropertyType[]>("/v1/property-types", { "x-tenant-id": DEMO_TENANT_ID });
}

/** Fiadores do tenant demo. */
export function fetchGuarantors(): Promise<Guarantor[] | null> {
  return get<Guarantor[]>("/v1/guarantors", { "x-tenant-id": DEMO_TENANT_ID });
}

/**
 * POST server-side ao backend com o header de tenant (Fase 0).
 * Usado por Server Actions. Retorna { ok } ou { ok:false, error }.
 */
export async function postJson(
  path: string,
  body: unknown,
): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-tenant-id": DEMO_TENANT_ID },
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
