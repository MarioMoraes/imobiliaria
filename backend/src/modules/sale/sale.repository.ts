import { lockSequence, withTenant } from "../../shared/db.js";
import type {
  CreateSaleInput,
  ListSalesQuery,
  Sale,
  UpdateSaleInput,
} from "./sale.schema.js";

/**
 * Os dois LEFT JOIN (forma de pagamento e corretor) trazem só o NOME para
 * exibição — mesma licença que `commission.repository.ts` já usa com `brokers`.
 * A venda continua sem conhecer o service de nenhum dos dois.
 */
interface Row {
  id: string;
  tenant_id: string;
  code: number;
  property_id: string;
  sold_at: string | null; // DATE -> string (ver setTypeParser em shared/db.ts)

  buyer_name: string;
  buyer_nationality: string | null;
  buyer_marital_status: string | null;
  buyer_occupation: string | null;
  buyer_address: string | null;
  buyer_district: string | null;
  buyer_city: string | null;
  buyer_state: string | null;
  buyer_zip: string | null;
  buyer_cpf: string | null;
  buyer_rg: string | null;

  spouse_name: string | null;
  spouse_nationality: string | null;
  spouse_occupation: string | null;
  spouse_cpf: string | null;
  spouse_rg: string | null;
  marriage_regime: string | null;

  payment_method_id: string | null;
  payment_method_name: string | null;
  payment_notes: string | null;
  commission_percent: string; // NUMERIC chega como string no pg
  value_cents: string; // BIGINT idem
  broker_id: string | null;
  broker_name: string | null;

  created_at: Date;
  updated_at: Date;
}

function toSale(row: Row): Sale {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    propertyId: row.property_id,
    soldAt: row.sold_at,

    buyerName: row.buyer_name,
    buyerNationality: row.buyer_nationality,
    buyerMaritalStatus: row.buyer_marital_status,
    buyerOccupation: row.buyer_occupation,
    buyerAddress: row.buyer_address,
    buyerDistrict: row.buyer_district,
    buyerCity: row.buyer_city,
    buyerState: row.buyer_state,
    buyerZip: row.buyer_zip,
    buyerCpf: row.buyer_cpf,
    buyerRg: row.buyer_rg,

    spouseName: row.spouse_name,
    spouseNationality: row.spouse_nationality,
    spouseOccupation: row.spouse_occupation,
    spouseCpf: row.spouse_cpf,
    spouseRg: row.spouse_rg,
    marriageRegime: row.marriage_regime,

    paymentMethodId: row.payment_method_id,
    paymentMethodName: row.payment_method_name,
    paymentNotes: row.payment_notes,
    commissionPercent: Number(row.commission_percent),
    valueCents: Number(row.value_cents),
    brokerId: row.broker_id,
    brokerName: row.broker_name,

    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

const SELECT = `
  SELECT s.*, pm.name AS payment_method_name, b.name AS broker_name
    FROM sales s
    LEFT JOIN payment_methods pm ON pm.id = s.payment_method_id
    LEFT JOIN brokers        b  ON b.id  = s.broker_id
`;

export async function listSales(
  tenantId: string,
  query: ListSalesQuery,
): Promise<Sale[]> {
  return withTenant(tenantId, async (client) => {
    const where = query.propertyId ? "WHERE s.property_id = $1" : "";
    const params = query.propertyId ? [query.propertyId] : [];
    const { rows } = await client.query<Row>(
      `${SELECT} ${where} ORDER BY s.code DESC`,
      params,
    );
    return rows.map(toSale);
  });
}

export async function findSale(tenantId: string, id: string): Promise<Sale | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(`${SELECT} WHERE s.id = $1`, [id]);
    return rows[0] ? toSale(rows[0]) : null;
  });
}

/**
 * Colunas graváveis, na ordem em que o INSERT as escreve. A mesma lista serve
 * ao UPDATE (SET dinâmico) — uma coluna nova entra aqui uma vez só.
 *
 * `code` e `property_id` ficam de fora de propósito: são a identidade da venda.
 */
type SaleWritable = Partial<Omit<CreateSaleInput, "propertyId">>;

const COLUMNS: readonly (readonly [string, (i: SaleWritable) => unknown])[] = [
  ["sold_at", (i) => i.soldAt ?? null],
  ["buyer_name", (i) => i.buyerName],
  ["buyer_nationality", (i) => i.buyerNationality ?? null],
  ["buyer_marital_status", (i) => i.buyerMaritalStatus ?? null],
  ["buyer_occupation", (i) => i.buyerOccupation ?? null],
  ["buyer_address", (i) => i.buyerAddress ?? null],
  ["buyer_district", (i) => i.buyerDistrict ?? null],
  ["buyer_city", (i) => i.buyerCity ?? null],
  ["buyer_state", (i) => i.buyerState ?? null],
  ["buyer_zip", (i) => i.buyerZip ?? null],
  ["buyer_cpf", (i) => i.buyerCpf ?? null],
  ["buyer_rg", (i) => i.buyerRg ?? null],
  ["spouse_name", (i) => i.spouseName ?? null],
  ["spouse_nationality", (i) => i.spouseNationality ?? null],
  ["spouse_occupation", (i) => i.spouseOccupation ?? null],
  ["spouse_cpf", (i) => i.spouseCpf ?? null],
  ["spouse_rg", (i) => i.spouseRg ?? null],
  ["marriage_regime", (i) => i.marriageRegime ?? null],
  ["payment_method_id", (i) => i.paymentMethodId ?? null],
  ["payment_notes", (i) => i.paymentNotes ?? null],
  ["commission_percent", (i) => i.commissionPercent ?? 0],
  ["value_cents", (i) => i.valueCents ?? 0],
  ["broker_id", (i) => i.brokerId ?? null],
];

export async function insertSale(
  tenantId: string,
  input: CreateSaleInput,
): Promise<Sale> {
  const names = COLUMNS.map(([col]) => col);
  const values = COLUMNS.map(([, read]) => read(input));
  // $1 = tenant_id, $2 = property_id; o código sai de uma subquery.
  const placeholders = names.map((_, i) => `$${i + 3}`);

  const inserted = await withTenant(tenantId, async (client) => {
    // Sequencial por tenant, como bancos e corretores: MAX(code)+1 sob RLS, com
    // lock para serializar as inserções concorrentes do mesmo tenant.
    await lockSequence(client, tenantId, "sales.code");
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO sales (tenant_id, property_id, code, ${names.join(", ")})
       VALUES ($1, $2, (SELECT COALESCE(MAX(code), 0) + 1 FROM sales), ${placeholders.join(", ")})
       RETURNING id`,
      [tenantId, input.propertyId, ...values],
    );
    return rows[0]!.id;
  });

  // Relê pelo SELECT com os JOINs — o RETURNING não traz os nomes resolvidos.
  return (await findSale(tenantId, inserted))!;
}

/** SET dinâmico: só o que veio em `input`. Null se a venda não existe no tenant. */
export async function updateSale(
  tenantId: string,
  id: string,
  input: UpdateSaleInput,
): Promise<Sale | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  const push = (col: string, val: unknown) => {
    values.push(val);
    sets.push(`${col} = $${values.length}`);
  };

  for (const [col, read] of COLUMNS) {
    const key = camel(col) as keyof UpdateSaleInput;
    if (input[key] !== undefined) push(col, read(input));
  }

  return withTenant(tenantId, async (client) => {
    if (sets.length > 0) {
      sets.push("updated_at = now()");
      values.push(id);
      const { rowCount } = await client.query(
        `UPDATE sales SET ${sets.join(", ")} WHERE id = $${values.length}`,
        values,
      );
      if ((rowCount ?? 0) === 0) return null;
    }
    const { rows } = await client.query<Row>(`${SELECT} WHERE s.id = $1`, [id]);
    return rows[0] ? toSale(rows[0]) : null;
  });
}

/** snake_case do banco → camelCase do input (`buyer_name` → `buyerName`). */
function camel(column: string): string {
  return column.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
}

export async function deleteSale(tenantId: string, id: string): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query("DELETE FROM sales WHERE id = $1", [id]);
    return (rowCount ?? 0) > 0;
  });
}
