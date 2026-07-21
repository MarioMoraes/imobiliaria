"use server";

import { revalidatePath } from "next/cache";
import { deleteJson, fetchPerson, patchJson, postJson, type Person } from "../../../lib/api";

/** Papéis possíveis de uma pessoa (uma pessoa acumula 1+). */
export type PersonRole = "LOCADOR" | "LOCATARIO" | "FIADOR";

/** Bloco de endereço (residencial/comercial) — inclui contato do bloco (legado). */
export interface AddressInput {
  zip?: string;
  street?: string;
  number?: string;
  district?: string;
  city?: string;
  state?: string;
  phone?: string;
  mobile?: string;
  fax?: string;
  email?: string;
}

export interface NewPersonInput {
  roles: PersonRole[];
  personType: "PF" | "PJ";
  fullName: string;
  cpfCnpj?: string;
  rg?: string;
  rgIssuer?: string;
  gender?: "" | "M" | "F" | "OUTRO";
  birthDate?: string;
  maritalStatus?: string;
  nationality?: string;
  occupation?: string;
  // Cônjuge
  spouseName?: string;
  spouseCpf?: string;
  spouseRg?: string;
  spouseOccupation?: string;
  spouseBirthDate?: string;
  // Bancário
  bank?: string;
  agency?: string;
  account?: string;
  holderName?: string;
  paymentAuthorization?: string;
  // Observações
  notes?: string;
  references?: string;
  source: string;
  // Endereços
  residential: AddressInput;
  commercial: AddressInput;
  // Perfil de busca (opcional)
  intent?: "" | "COMPRA" | "LOCACAO";
  minPriceReais?: string;
  maxPriceReais?: string;
  districts?: string;
  bedroomsMin?: string;
}

export interface FormState {
  ok?: boolean;
  error?: string;
}

const clean = (v?: string) => {
  const t = (v ?? "").trim();
  return t === "" ? undefined : t;
};
const digits = (v?: string) => {
  const d = (v ?? "").replace(/\D/g, "");
  return d === "" ? undefined : d;
};
/**
 * Documento (CPF/CNPJ) na forma canônica: remove a máscara mantendo letras
 * (CNPJ alfanumérico) e coloca em caixa alta. CPF continua 100% numérico.
 */
const doc = (v?: string) => {
  const d = (v ?? "").replace(/[^0-9A-Za-z]/g, "").toUpperCase();
  return d === "" ? undefined : d;
};
const toCents = (v?: string): number | undefined => {
  const n = Number((v ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n * 100 : undefined;
};
const toInt = (v?: string): number | undefined => {
  const n = Number((v ?? "").replace(/[^\d]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Monta o payload de um endereço; retorna undefined se o bloco estiver vazio. */
function buildAddress(kind: "RESIDENCIAL" | "COMERCIAL", a: AddressInput) {
  const out = {
    kind,
    zip: digits(a.zip),
    street: clean(a.street),
    number: clean(a.number),
    district: clean(a.district),
    city: clean(a.city),
    state: clean(a.state),
    phone: digits(a.phone),
    mobile: digits(a.mobile),
    fax: digits(a.fax),
    email: clean(a.email),
  };
  const hasData = Object.entries(out).some(([k, v]) => k !== "kind" && Boolean(v));
  return hasData ? out : undefined;
}

/** Perfil de busca do formulário (undefined quando não há intenção escolhida). */
function buildSearchProfile(input: NewPersonInput) {
  if (!input.intent) return undefined;
  const districts = (input.districts ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter(Boolean);
  return {
    intent: input.intent,
    minPriceCents: toCents(input.minPriceReais),
    maxPriceCents: toCents(input.maxPriceReais),
    districts,
    bedroomsMin: toInt(input.bedroomsMin),
  };
}

/**
 * Valida o formulário e normaliza a ficha. Compartilhado por criar/editar — o
 * que muda entre os dois é só o verbo e o tratamento de campos vazios (na
 * criação são omitidos; na edição viram null para limpar o valor anterior).
 */
function buildPersonFields(
  input: NewPersonInput,
): { ok: false; error: string } | { ok: true; fields: Record<string, unknown>; addresses: unknown[] } {
  const fullName = input.fullName.trim();
  if (fullName.length < 2) return { ok: false, error: "Informe o nome da pessoa." };
  if (!input.roles || input.roles.length === 0) {
    return { ok: false, error: "Selecione ao menos um papel (locador/locatário/fiador)." };
  }

  // Contato principal (dedup) derivado do bloco residencial → comercial.
  const r = input.residential;
  const c = input.commercial;
  const email = clean(r.email) ?? clean(c.email);
  const phone = digits(r.mobile) ?? digits(r.phone) ?? digits(c.mobile) ?? digits(c.phone);
  if (!email && !phone) {
    return { ok: false, error: "Informe ao menos um contato (e-mail ou telefone) nos Dados Residenciais." };
  }

  return {
    ok: true,
    addresses: [buildAddress("RESIDENCIAL", r), buildAddress("COMERCIAL", c)].filter(Boolean),
    fields: {
      roles: input.roles,
      personType: input.personType,
      fullName,
      cpfCnpj: doc(input.cpfCnpj),
      rg: clean(input.rg),
      rgIssuer: clean(input.rgIssuer),
      gender: clean(input.gender),
      birthDate: clean(input.birthDate),
      maritalStatus: clean(input.maritalStatus),
      nationality: clean(input.nationality) ?? "BRASILEIRA",
      occupation: clean(input.occupation),
      spouseName: clean(input.spouseName),
      spouseCpf: digits(input.spouseCpf),
      spouseRg: clean(input.spouseRg),
      spouseOccupation: clean(input.spouseOccupation),
      spouseBirthDate: clean(input.spouseBirthDate),
      bank: clean(input.bank),
      agency: clean(input.agency),
      account: clean(input.account),
      holderName: clean(input.holderName),
      paymentAuthorization: clean(input.paymentAuthorization),
      notes: clean(input.notes),
      references: clean(input.references),
      email,
      phone,
      mobile: digits(r.mobile),
    },
  };
}

/** Todas as views por papel leem a mesma tabela `persons`. */
function revalidatePersonViews(): void {
  revalidatePath("/clientes");
  revalidatePath("/proprietarios");
  revalidatePath("/fiadores");
}

/**
 * Ficha completa para o formulário de edição — a listagem não traz endereços
 * nem perfis de busca, então o modal carrega a pessoa ao abrir.
 */
export async function loadPersonAction(id: string): Promise<Person | null> {
  return fetchPerson(id);
}

/** Cria uma pessoa (locador/locatário/fiador) via POST /v1/persons. */
export async function createPersonAction(input: NewPersonInput): Promise<FormState> {
  const built = buildPersonFields(input);
  if (!built.ok) return built;

  const body: Record<string, unknown> = {
    ...built.fields,
    source: input.source,
    addresses: built.addresses,
  };
  const searchProfile = buildSearchProfile(input);
  if (searchProfile) body.searchProfile = searchProfile;

  const res = await postJson("/v1/persons", body);
  if (!res.ok) return { ok: false, error: res.error };

  revalidatePersonViews();
  return { ok: true };
}

/**
 * Edita a ficha via PATCH /v1/persons/:id. Campos vazios viram `null` (limpam o
 * valor). Endereços e perfil de busca têm endpoint próprio e são upsert pelo
 * `kind`/`intent` — reenviá-los substitui o bloco anterior.
 */
export async function updatePersonAction(id: string, input: NewPersonInput): Promise<FormState> {
  const built = buildPersonFields(input);
  if (!built.ok) return built;

  // `source` e `stage` não são editáveis pela ficha (origem é histórico; o
  // estágio muda por contrato/CRM — RN-05).
  const body = Object.fromEntries(
    Object.entries(built.fields).map(([k, v]) => [k, v ?? null]),
  );

  const res = await patchJson(`/v1/persons/${id}`, body);
  if (!res.ok) return { ok: false, error: res.error };

  for (const address of built.addresses) {
    const sent = await postJson(`/v1/persons/${id}/addresses`, address);
    if (!sent.ok) return { ok: false, error: sent.error };
  }

  const searchProfile = buildSearchProfile(input);
  if (searchProfile) {
    const sent = await postJson(`/v1/persons/${id}/search-profiles`, searchProfile);
    if (!sent.ok) return { ok: false, error: sent.error };
  }

  revalidatePersonViews();
  return { ok: true };
}

/**
 * Remove a pessoa (soft delete no backend: a ficha vira inativa e sai das
 * listas, preservando o histórico de contratos e interações).
 */
export async function deletePersonAction(id: string): Promise<FormState> {
  const res = await deleteJson(`/v1/persons/${id}`);
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePersonViews();
  return { ok: true };
}
