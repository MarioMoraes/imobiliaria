import type pg from "pg";
import { lockSequence, withTenant } from "../../shared/db.js";
import type {
  Inspection,
  InspectionCondition,
  InspectionEntry,
  SaveInspectionEntryInput,
} from "./inspection.schema.js";

interface Row {
  id: string;
  tenant_id: string;
  property_id: string;
  seq: number | null;
  notes: string | null;
  created_at: Date;
  updated_at: Date;
}

interface EntryRow {
  id: string;
  inspection_id: string;
  inspection_item_id: string | null;
  description: string;
  position: number;
  quantity: number;
  condition: string | null;
  notes: string | null;
}

function toInspection(row: Row): Inspection {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    propertyId: row.property_id,
    seq: row.seq,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function toEntry(row: EntryRow): InspectionEntry {
  return {
    id: row.id,
    inspectionId: row.inspection_id,
    inspectionItemId: row.inspection_item_id,
    description: row.description,
    position: row.position,
    quantity: row.quantity,
    condition: (row.condition as InspectionCondition | null) ?? null,
    notes: row.notes,
  };
}

/**
 * Cria as linhas que faltam a partir do catálogo de Itens de Vistoria ativos.
 *
 * Idempotente por construção: o índice único (inspection_id, inspection_item_id)
 * absorve as repetições. Rodar isto a cada abertura mantém a vistoria alinhada
 * ao catálogo — item novo em /tabelas aparece na próxima consulta sem que o
 * usuário precise sincronizar nada, e o que já estava preenchido não é tocado.
 *
 * A `position` continua de onde parou para os itens novos irem para o fim da
 * lista; a `description` é copiada (snapshot) para a linha sobreviver à exclusão
 * do item no catálogo.
 */
async function syncEntriesFromCatalog(
  client: pg.PoolClient,
  tenantId: string,
  inspectionId: string,
): Promise<void> {
  await client.query(
    `INSERT INTO property_inspection_entries
       (tenant_id, inspection_id, inspection_item_id, description, position)
     SELECT $1, $2, i.id, i.description,
            (SELECT COALESCE(MAX(position), 0) FROM property_inspection_entries WHERE inspection_id = $2)
              + row_number() OVER (ORDER BY i.description ASC)
       FROM inspection_items i
      WHERE i.active
        AND NOT EXISTS (
              SELECT 1 FROM property_inspection_entries e
               WHERE e.inspection_id = $2 AND e.inspection_item_id = i.id)
     ON CONFLICT (inspection_id, inspection_item_id) DO NOTHING`,
    [tenantId, inspectionId],
  );
}

/**
 * Devolve a vistoria do imóvel, criando-a na primeira abertura. O "Número" da
 * tela legada é um sequencial por tenant — daí o `lockSequence` (ver shared/db).
 */
export async function getOrCreateByProperty(
  tenantId: string,
  propertyId: string,
): Promise<{ inspection: Inspection; entries: InspectionEntry[] }> {
  return withTenant(tenantId, async (client) => {
    const existing = await client.query<Row>(
      "SELECT * FROM property_inspections WHERE property_id = $1",
      [propertyId],
    );

    let row = existing.rows[0];
    if (!row) {
      await lockSequence(client, tenantId, "property_inspections.seq");
      const created = await client.query<Row>(
        `INSERT INTO property_inspections (tenant_id, property_id, seq)
         VALUES ($1, $2, (SELECT COALESCE(MAX(seq), 0) + 1 FROM property_inspections))
         RETURNING *`,
        [tenantId, propertyId],
      );
      row = created.rows[0]!;
    }

    await syncEntriesFromCatalog(client, tenantId, row.id);

    const entries = await client.query<EntryRow>(
      `SELECT id, inspection_id, inspection_item_id, description, position,
              quantity, condition, notes
         FROM property_inspection_entries
        WHERE inspection_id = $1
        ORDER BY position ASC, description ASC`,
      [row.id],
    );

    return { inspection: toInspection(row), entries: entries.rows.map(toEntry) };
  });
}

export async function findByProperty(
  tenantId: string,
  propertyId: string,
): Promise<Inspection | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      "SELECT * FROM property_inspections WHERE property_id = $1",
      [propertyId],
    );
    return rows[0] ? toInspection(rows[0]) : null;
  });
}

/**
 * Grava o preenchimento da vistoria inteira numa transação só (é o "Confirmar"
 * da tela). O `AND inspection_id = $x` escopa a filha: um id de outra vistoria
 * no payload simplesmente não atualiza nada.
 */
export async function saveEntries(
  tenantId: string,
  inspectionId: string,
  entries: SaveInspectionEntryInput[],
  notes: string | null | undefined,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    for (const entry of entries) {
      await client.query(
        `UPDATE property_inspection_entries
            SET quantity = $1, condition = $2, notes = $3, updated_at = now()
          WHERE id = $4 AND inspection_id = $5`,
        [entry.quantity, entry.condition, entry.notes, entry.id, inspectionId],
      );
    }

    if (notes !== undefined) {
      await client.query(
        "UPDATE property_inspections SET notes = $1, updated_at = now() WHERE id = $2",
        [notes, inspectionId],
      );
    } else {
      await client.query(
        "UPDATE property_inspections SET updated_at = now() WHERE id = $1",
        [inspectionId],
      );
    }
  });
}
