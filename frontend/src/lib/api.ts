/**
 * Cliente do backend usado pelos Server Components.
 *
 * Fase 0: o tenant é enviado via header `x-tenant-id` com o DEMO_TENANT_ID.
 * Na Fase 0 real, o tenant virá do JWT do Clerk (sessão do usuário) e este
 * helper passará a repassar o token de autenticação.
 */
const BACKEND_URL = process.env.BACKEND_URL ?? "http://localhost:3001";
const DEMO_TENANT_ID =
  process.env.DEMO_TENANT_ID ?? "00000000-0000-0000-0000-000000000001";

export interface Property {
  id: string;
  title: string;
  kind: string;
  status: string;
  priceCents: number | null;
  city: string | null;
  state: string | null;
  bedrooms: number | null;
}

export async function fetchProperties(): Promise<Property[]> {
  const res = await fetch(`${BACKEND_URL}/v1/properties`, {
    headers: { "x-tenant-id": DEMO_TENANT_ID },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Backend respondeu ${res.status}`);
  const json = (await res.json()) as { data: Property[] };
  return json.data;
}

export function formatPrice(cents: number | null): string {
  if (cents === null) return "—";
  return (cents / 100).toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
  });
}
