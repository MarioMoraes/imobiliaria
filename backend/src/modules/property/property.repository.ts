import { lockSequence, withTenant } from "../../shared/db.js";
import type { PoolClient } from "pg";
import type {
  CreatePropertyInput,
  Property,
  PropertyOwner,
  StoredPhoto,
  UpdatePropertyInput,
} from "./property.schema.js";

/**
 * Acesso a dados de imóveis. Toda operação roda dentro de `withTenant`,
 * portanto o RLS garante que só linhas do tenant corrente são visíveis —
 * mesmo que o SQL não filtre explicitamente por tenant_id.
 */

interface Row {
  id: string;
  tenant_id: string;
  code: number | null;
  title: string;
  kind: string;
  purpose: string;
  property_type_id: string | null;
  is_development: boolean;
  status: string;
  price_cents: string | null;

  contract_number: string | null;
  condominium_id: string | null;
  is_commercial: boolean;

  street_type: string | null;
  address: string | null;
  number: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  keys_location: string | null;
  has_sign: boolean;
  position_front: boolean;
  position_back: boolean;

  bedrooms: number | null;
  built_area: string | null;
  land_area: string | null;
  floor_info: string | null;
  ceiling_info: string | null;
  electricity_meter: string | null;
  water_meter: string | null;
  dependencies: string | null;
  allow_pets: boolean;
  allow_students: boolean;

  condo_fee_cents: string | null;
  iptu_cents: string | null;
  iptu_charged_to: string | null;
  iptu_reimburse_owner: boolean;
  iptu_installments: number | null;
  iptu_installment_cents: string | null;
  admin_fee_percent: string | null;
  charge_admin_fee: boolean;
  is_guaranteed: boolean;

  lease_term_months: number | null;
  lease_start: string | null; // castado p/ text no SELECT (evita shift de fuso)
  penalty_info: string | null;
  has_commission: boolean;
  commission_type: string | null;
  entry_date: string | null;

  broker_id: string | null;
  capturer_id: string | null;
  extra_data: string | null;
  publish_web: boolean;
  has_photos: boolean;
  notes: string | null;

  is_authorized: boolean;
  is_exclusive: boolean;
  auth_term: string | null;
  auth_days: number | null;
  auth_expiry: string | null; // castado p/ text no SELECT (evita shift de fuso)
  is_recorded: boolean;
  has_deed: boolean;
  is_registered: boolean;
  is_sold: boolean;
  registry_office: string | null;
  registration_number: string | null;

  topography: string | null;
  lot_number: string | null;
  block_number: string | null;
  front_measure: string | null;
  back_measure: string | null;
  left_measure: string | null;
  right_measure: string | null;

  owners: PropertyOwner[] | null;
  created_at: Date;
  updated_at: Date;
}

/** BIGINT/NUMERIC chegam como string no pg; converte preservando null. */
const num = (v: string | null): number | null => (v === null ? null : Number(v));

/**
 * Mapa dos campos editáveis (input camelCase → coluna snake_case). Fonte única
 * usada pelo INSERT e pelo UPDATE dinâmicos — evita contar placeholders à mão.
 * `code`, `id`, timestamps e os donos ficam de fora (não vêm do input).
 */
const COLUMN = {
  title: "title",
  kind: "kind",
  purpose: "purpose",
  propertyTypeId: "property_type_id",
  isDevelopment: "is_development",
  status: "status",
  priceCents: "price_cents",

  contractNumber: "contract_number",
  condominiumId: "condominium_id",
  isCommercial: "is_commercial",

  streetType: "street_type",
  address: "address",
  number: "number",
  district: "district",
  city: "city",
  state: "state",
  zip: "zip",
  keysLocation: "keys_location",
  hasSign: "has_sign",
  positionFront: "position_front",
  positionBack: "position_back",

  bedrooms: "bedrooms",
  builtArea: "built_area",
  landArea: "land_area",
  floorInfo: "floor_info",
  ceilingInfo: "ceiling_info",
  electricityMeter: "electricity_meter",
  waterMeter: "water_meter",
  dependencies: "dependencies",
  allowPets: "allow_pets",
  allowStudents: "allow_students",

  condoFeeCents: "condo_fee_cents",
  iptuCents: "iptu_cents",
  iptuChargedTo: "iptu_charged_to",
  iptuReimburseOwner: "iptu_reimburse_owner",
  iptuInstallments: "iptu_installments",
  iptuInstallmentCents: "iptu_installment_cents",
  adminFeePercent: "admin_fee_percent",
  chargeAdminFee: "charge_admin_fee",
  isGuaranteed: "is_guaranteed",

  leaseTermMonths: "lease_term_months",
  leaseStart: "lease_start",
  penaltyInfo: "penalty_info",
  hasCommission: "has_commission",
  commissionType: "commission_type",
  entryDate: "entry_date",

  brokerId: "broker_id",
  capturerId: "capturer_id",
  extraData: "extra_data",
  publishWeb: "publish_web",
  hasPhotos: "has_photos",
  notes: "notes",

  isAuthorized: "is_authorized",
  isExclusive: "is_exclusive",
  authTerm: "auth_term",
  authDays: "auth_days",
  authExpiry: "auth_expiry",
  isRecorded: "is_recorded",
  hasDeed: "has_deed",
  isRegistered: "is_registered",
  isSold: "is_sold",
  registryOffice: "registry_office",
  registrationNumber: "registration_number",

  topography: "topography",
  lotNumber: "lot_number",
  blockNumber: "block_number",
  frontMeasure: "front_measure",
  backMeasure: "back_measure",
  leftMeasure: "left_measure",
  rightMeasure: "right_measure",
} as const;

type ColumnKey = keyof typeof COLUMN;

// Subquery que agrega os donos (property_owners ⋈ persons) como jsonb — usada
// no list e no detalhe para trazer os proprietários sem N+1.
const OWNERS_LATERAL = `
  LEFT JOIN LATERAL (
    SELECT jsonb_agg(jsonb_build_object(
      'id', po.id, 'personId', po.person_id,
      'personName', pe.full_name, 'sharePercent', po.share_percent
    ) ORDER BY pe.full_name) AS owners
    FROM property_owners po JOIN persons pe ON pe.id = po.person_id
    WHERE po.property_id = p.id
  ) o ON true`;

// Campos DATE cast para text (evita que o parser do pg desloque o dia por fuso).
// Vêm depois de `p.*`, então sobrescrevem as colunas homônimas no objeto de linha.
const SELECT_COLS = `p.*, p.lease_start::text AS lease_start, p.entry_date::text AS entry_date, p.auth_expiry::text AS auth_expiry, o.owners`;
const RETURNING_COLS = `*, lease_start::text AS lease_start, entry_date::text AS entry_date, auth_expiry::text AS auth_expiry`;

function toProperty(row: Row): Property {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    code: row.code,
    title: row.title,
    kind: row.kind,
    purpose: row.purpose,
    propertyTypeId: row.property_type_id,
    isDevelopment: row.is_development,
    status: row.status,
    priceCents: num(row.price_cents),

    contractNumber: row.contract_number,
    condominiumId: row.condominium_id,
    isCommercial: row.is_commercial,

    streetType: row.street_type,
    address: row.address,
    number: row.number,
    district: row.district,
    city: row.city,
    state: row.state,
    zip: row.zip,
    keysLocation: row.keys_location,
    hasSign: row.has_sign,
    positionFront: row.position_front,
    positionBack: row.position_back,

    bedrooms: row.bedrooms,
    builtArea: num(row.built_area),
    landArea: num(row.land_area),
    floorInfo: row.floor_info,
    ceilingInfo: row.ceiling_info,
    electricityMeter: row.electricity_meter,
    waterMeter: row.water_meter,
    dependencies: row.dependencies,
    allowPets: row.allow_pets,
    allowStudents: row.allow_students,

    condoFeeCents: num(row.condo_fee_cents),
    iptuCents: num(row.iptu_cents),
    iptuChargedTo: row.iptu_charged_to,
    iptuReimburseOwner: row.iptu_reimburse_owner,
    iptuInstallments: row.iptu_installments,
    iptuInstallmentCents: num(row.iptu_installment_cents),
    adminFeePercent: num(row.admin_fee_percent),
    chargeAdminFee: row.charge_admin_fee,
    isGuaranteed: row.is_guaranteed,

    leaseTermMonths: row.lease_term_months,
    leaseStart: row.lease_start,
    penaltyInfo: row.penalty_info,
    hasCommission: row.has_commission,
    commissionType: row.commission_type,
    entryDate: row.entry_date,

    brokerId: row.broker_id,
    capturerId: row.capturer_id,
    extraData: row.extra_data,
    publishWeb: row.publish_web,
    hasPhotos: row.has_photos,
    notes: row.notes,

    isAuthorized: row.is_authorized,
    isExclusive: row.is_exclusive,
    authTerm: row.auth_term,
    authDays: row.auth_days,
    authExpiry: row.auth_expiry,
    isRecorded: row.is_recorded,
    hasDeed: row.has_deed,
    isRegistered: row.is_registered,
    isSold: row.is_sold,
    registryOffice: row.registry_office,
    registrationNumber: row.registration_number,

    topography: row.topography,
    lotNumber: row.lot_number,
    blockNumber: row.block_number,
    frontMeasure: row.front_measure,
    backMeasure: row.back_measure,
    leftMeasure: row.left_measure,
    rightMeasure: row.right_measure,

    owners: (row.owners ?? []).map((o) => ({ ...o, sharePercent: Number(o.sharePercent) })),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

async function loadProperty(client: PoolClient, id: string): Promise<Property> {
  const { rows } = await client.query<Row>(
    `SELECT ${SELECT_COLS} FROM properties p ${OWNERS_LATERAL} WHERE p.id = $1`,
    [id],
  );
  return toProperty(rows[0]!);
}

export async function listProperties(tenantId: string): Promise<Property[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT ${SELECT_COLS} FROM properties p ${OWNERS_LATERAL}
        ORDER BY p.created_at DESC LIMIT 100`,
    );
    return rows.map(toProperty);
  });
}

/**
 * Página do inventário disponível, para varredura completa.
 *
 * Existe porque `listProperties` tem `LIMIT 100` fixo (é a lista da tela): quem
 * precisa do inventário INTEIRO — hoje o indexador do RAG — não pode usá-la sem
 * perder imóveis em silêncio. A alternativa seria o outro módulo fazer SELECT
 * direto em `properties`, quebrando a fronteira; um método público paginado
 * mantém o SQL de imóveis dentro do módulo de imóveis.
 *
 * Pagina por `created_at, id` (e não por OFFSET) para que uma inserção no meio
 * da varredura não faça um imóvel ser pulado ou visitado duas vezes.
 */
export async function listAvailableForIndex(
  tenantId: string,
  after: { createdAt: string; id: string } | null,
  limit: number,
): Promise<Property[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT ${SELECT_COLS} FROM properties p ${OWNERS_LATERAL}
        WHERE p.status = 'available'
          AND ($1::timestamptz IS NULL OR (p.created_at, p.id) > ($1::timestamptz, $2::uuid))
        ORDER BY p.created_at, p.id
        LIMIT $3`,
      [after?.createdAt ?? null, after?.id ?? null, limit],
    );
    return rows.map(toProperty);
  });
}

/**
 * Imóveis de um condomínio (tela "Consulta Condôminos"). Ordena pelo código
 * sequencial — os apartamentos aparecem na ordem em que foram cadastrados.
 */
export async function listByCondominium(
  tenantId: string,
  condominiumId: string,
): Promise<Property[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT ${SELECT_COLS} FROM properties p ${OWNERS_LATERAL}
        WHERE p.condominium_id = $1
        ORDER BY p.code ASC NULLS LAST, p.created_at ASC`,
      [condominiumId],
    );
    return rows.map(toProperty);
  });
}

export async function findProperty(
  tenantId: string,
  id: string,
): Promise<Property | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      "SELECT id FROM properties WHERE id = $1",
      [id],
    );
    return rows[0] ? loadProperty(client, id) : null;
  });
}

/** Vincula (ou atualiza a participação de) um dono ao imóvel. Idempotente. */
export async function addOwner(
  tenantId: string,
  propertyId: string,
  personId: string,
  sharePercent: number,
): Promise<Property> {
  return withTenant(tenantId, async (client) => {
    await client.query(
      `INSERT INTO property_owners (tenant_id, property_id, person_id, share_percent)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (property_id, person_id)
       DO UPDATE SET share_percent = EXCLUDED.share_percent`,
      [tenantId, propertyId, personId, sharePercent],
    );
    return loadProperty(client, propertyId);
  });
}

export async function removeOwner(
  tenantId: string,
  propertyId: string,
  personId: string,
): Promise<Property> {
  return withTenant(tenantId, async (client) => {
    await client.query(
      "DELETE FROM property_owners WHERE property_id = $1 AND person_id = $2",
      [propertyId, personId],
    );
    return loadProperty(client, propertyId);
  });
}

export async function insertProperty(
  tenantId: string,
  input: CreatePropertyInput,
): Promise<Property> {
  return withTenant(tenantId, async (client) => {
    // Código sequencial por tenant (RLS já escopa o MAX ao tenant corrente).
    // O lock serializa inserções concorrentes: `properties` tem índice único em
    // (tenant_id, code), então sem ele a corrida virava 500 (ver `lockSequence`).
    await lockSequence(client, tenantId, "properties.code");
    const codeRes = await client.query<{ next: number }>(
      "SELECT COALESCE(MAX(code), 0) + 1 AS next FROM properties",
    );
    const code = Number(codeRes.rows[0]!.next);

    const cols = ["tenant_id", "code"];
    const values: unknown[] = [tenantId, code];
    for (const [key, col] of Object.entries(COLUMN)) {
      cols.push(col);
      values.push((input as Record<string, unknown>)[key] ?? null);
    }
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await client.query<Row>(
      `INSERT INTO properties (${cols.join(", ")})
       VALUES (${placeholders})
       RETURNING ${RETURNING_COLS}`,
      values,
    );
    // owners recém-criados são [] — recarrega no formato canônico.
    return loadProperty(client, rows[0]!.id);
  });
}

export async function updateProperty(
  tenantId: string,
  id: string,
  input: UpdatePropertyInput,
): Promise<Property | null> {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const [key, col] of Object.entries(COLUMN)) {
    const value = (input as Record<string, unknown>)[key as ColumnKey];
    if (value !== undefined) {
      values.push(value);
      sets.push(`${col} = $${values.length}`);
    }
  }
  if (sets.length === 0) return findProperty(tenantId, id);

  return withTenant(tenantId, async (client) => {
    values.push(id);
    const { rowCount } = await client.query(
      `UPDATE properties SET ${sets.join(", ")}, updated_at = now()
       WHERE id = $${values.length}`,
      values,
    );
    return (rowCount ?? 0) > 0 ? loadProperty(client, id) : null;
  });
}

/** Remove um imóvel do tenant. Retorna true se algo foi removido. */
export async function deleteProperty(
  tenantId: string,
  id: string,
): Promise<boolean> {
  return withTenant(tenantId, async (client) => {
    const { rowCount } = await client.query(
      "DELETE FROM properties WHERE id = $1",
      [id],
    );
    return (rowCount ?? 0) > 0;
  });
}

/* ---------------------------------------------------------- Fotos do imóvel */

interface PhotoRow {
  id: string;
  property_id: string;
  storage_key: string;
  content_type: string | null;
  size_bytes: string | null; // BIGINT chega como string
  caption: string | null;
  position: number;
  created_at: Date;
}

function toStoredPhoto(r: PhotoRow): StoredPhoto {
  return {
    id: r.id,
    propertyId: r.property_id,
    storageKey: r.storage_key,
    contentType: r.content_type,
    sizeBytes: num(r.size_bytes),
    caption: r.caption,
    position: r.position,
    createdAt: r.created_at.toISOString(),
  };
}

const PHOTO_COLS =
  "id, property_id, storage_key, content_type, size_bytes, caption, position, created_at";

export async function listPhotos(
  tenantId: string,
  propertyId: string,
): Promise<StoredPhoto[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<PhotoRow>(
      `SELECT ${PHOTO_COLS} FROM property_photos WHERE property_id = $1
        ORDER BY position ASC, created_at ASC`,
      [propertyId],
    );
    return rows.map(toStoredPhoto);
  });
}

/**
 * Quantas fotos cada imóvel da lista tem. Uma query com `GROUP BY` para o lote
 * inteiro, e não uma por imóvel: o indexador do RAG percorre o inventário em
 * páginas de 200, e contar de um em um seria 200 idas ao banco por página.
 *
 * Imóvel sem foto não volta do `GROUP BY` — quem chama trata a ausência como
 * zero (o `Map` não terá a chave).
 */
export async function countPhotos(
  tenantId: string,
  propertyIds: readonly string[],
): Promise<Map<string, number>> {
  if (propertyIds.length === 0) return new Map();
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ property_id: string; total: string }>(
      `SELECT property_id, COUNT(*) AS total FROM property_photos
        WHERE property_id = ANY($1::uuid[])
        GROUP BY property_id`,
      [propertyIds],
    );
    return new Map(rows.map((r) => [r.property_id, Number(r.total)]));
  });
}

export async function insertPhoto(
  tenantId: string,
  propertyId: string,
  photo: { storageKey: string; contentType: string; sizeBytes: number; caption?: string | null },
): Promise<StoredPhoto> {
  return withTenant(tenantId, async (client) => {
    // Próxima posição = fim da fila (MAX+1 dentro do imóvel).
    const { rows } = await client.query<PhotoRow>(
      `INSERT INTO property_photos (tenant_id, property_id, storage_key, content_type, size_bytes, caption, position)
       VALUES ($1, $2, $3, $4, $5, $6,
         (SELECT COALESCE(MAX(position), -1) + 1 FROM property_photos WHERE property_id = $2))
       RETURNING ${PHOTO_COLS}`,
      [tenantId, propertyId, photo.storageKey, photo.contentType, photo.sizeBytes, photo.caption ?? null],
    );
    return toStoredPhoto(rows[0]!);
  });
}

/**
 * Remove a linha da foto e devolve a `storage_key` removida (para o service
 * apagar o objeto no bucket). Retorna null se nada foi removido.
 */
export async function deletePhoto(
  tenantId: string,
  propertyId: string,
  photoId: string,
): Promise<string | null> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ storage_key: string }>(
      `DELETE FROM property_photos WHERE id = $1 AND property_id = $2
       RETURNING storage_key`,
      [photoId, propertyId],
    );
    return rows[0]?.storage_key ?? null;
  });
}

/**
 * Busca livre para a barra global. Casa por título, código, endereço, bairro e
 * cidade. `unaccent` não está instalado, então normalizamos os dois lados com
 * `lower()` — acento continua importando, o que é aceitável para termos curtos.
 */
export async function searchProperties(
  tenantId: string,
  term: string,
  limit = 5,
): Promise<Property[]> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<Row>(
      `SELECT ${SELECT_COLS} FROM properties p ${OWNERS_LATERAL}
        WHERE lower(p.title) LIKE lower($1)
           OR lower(coalesce(p.address, '')) LIKE lower($1)
           OR lower(coalesce(p.district, '')) LIKE lower($1)
           OR lower(coalesce(p.city, '')) LIKE lower($1)
           OR p.code::text = $2
        ORDER BY p.created_at DESC
        LIMIT $3`,
      [`%${term}%`, term.replace(/\D/g, "") || "-1", limit],
    );
    return rows.map(toProperty);
  });
}
