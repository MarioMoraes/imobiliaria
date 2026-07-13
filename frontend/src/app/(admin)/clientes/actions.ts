"use server";

import { revalidatePath } from "next/cache";
import { postJson } from "../../../lib/api";

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

/** Cria uma pessoa (locador/locatário/fiador) via POST /v1/persons. */
export async function createPersonAction(input: NewPersonInput): Promise<FormState> {
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

  const addresses = [
    buildAddress("RESIDENCIAL", r),
    buildAddress("COMERCIAL", c),
  ].filter(Boolean);

  const body: Record<string, unknown> = {
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
    source: input.source,
    email,
    phone,
    mobile: digits(r.mobile),
    addresses,
  };

  // Perfil de busca (opcional).
  if (input.intent) {
    const districts = (input.districts ?? "")
      .split(",")
      .map((d) => d.trim())
      .filter(Boolean);
    body.searchProfile = {
      intent: input.intent,
      minPriceCents: toCents(input.minPriceReais),
      maxPriceCents: toCents(input.maxPriceReais),
      districts,
      bedroomsMin: toInt(input.bedroomsMin),
    };
  }

  const res = await postJson("/v1/persons", body);
  if (!res.ok) return { ok: false, error: res.error };

  // Todas as views por papel leem a mesma tabela `persons`.
  revalidatePath("/clientes");
  revalidatePath("/proprietarios");
  revalidatePath("/fiadores");
  return { ok: true };
}
