import { moneyToWords } from "../../shared/extenso.js";
import type { Person, PersonAddress } from "../person/person.schema.js";
import type { Property } from "../property/property.schema.js";
import type { Sale } from "../sale/sale.schema.js";
import type { Contract } from "./contract.schema.js";

/**
 * Catálogo de *merge fields* (variáveis dinâmicas) dos templates de contrato.
 *
 * Fonte única da verdade: cada campo declara o rótulo, o exemplo E como extrair
 * o valor. Assim o catálogo exibido no editor e o contexto usado na geração do
 * PDF não têm como divergir — adicionar um campo aqui já o torna preenchível.
 *
 * A validação de template (`unknownVariables`) e a paleta do frontend leem esta
 * mesma lista.
 */

/* ----------------------------------------------------- Formatação */

/** Escapa o que quebraria o HTML do template. */
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Placeholder de campo vazio — deixa visível o que falta preencher. */
const BLANK = "____________";

const text = (v: string | null | undefined): string => (v ? esc(v) : BLANK);

/** Centavos → "1.234,56". */
const brl = (cents: number | null | undefined): string =>
  cents === null || cents === undefined
    ? BLANK
    : (cents / 100).toLocaleString("pt-BR", { minimumFractionDigits: 2 });

/**
 * Centavos → "dois mil e quinhentos reais".
 *
 * Contrato escreve o valor em algarismos e o repete em palavras; cada campo
 * monetário do catálogo tem, por isso, um par `_extenso`.
 */
const brlWords = (cents: number | null | undefined): string =>
  cents === null || cents === undefined ? BLANK : esc(moneyToWords(cents));

/** ISO (YYYY-MM-DD) → dd/mm/aaaa. */
const dateBr = (iso: string | null | undefined): string => {
  if (!iso) return "__/__/____";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
};

const num = (v: number | null | undefined, suffix = ""): string =>
  v === null || v === undefined ? BLANK : `${v}${suffix}`;

const MARITAL_STATUS: Record<string, string> = {
  SOLTEIRO: "solteiro(a)",
  CASADO: "casado(a)",
  DIVORCIADO: "divorciado(a)",
  VIUVO: "viúvo(a)",
  UNIAO_ESTAVEL: "em união estável",
};

const GUARANTEE: Record<string, string> = {
  FIADOR: "fiador",
  CAUCAO: "caução",
  SEGURO_FIANCA: "seguro-fiança",
  TITULO_CAP: "título de capitalização",
};

const IPTU_CHARGED_TO: Record<string, string> = {
  LOCATARIO: "locatário",
  LOCADOR: "locador",
};

/* ------------------------------------------------- Campos de pessoa */

/** Endereço principal da pessoa (residencial, ou o primeiro cadastrado). */
function mainAddress(person: Person | null): PersonAddress | null {
  if (!person) return null;
  return (
    person.addresses.find((a) => a.kind === "RESIDENCIAL") ?? person.addresses[0] ?? null
  );
}

interface PersonFieldDef {
  suffix: string;
  label: string;
  example: string;
  value: (p: Person | null) => string;
}

/**
 * Ficha da pessoa — os campos que uma qualificação de parte costuma exigir
 * ("brasileiro, casado, engenheiro, portador do RG… e do CPF…, residente em…").
 * Vale igual para locador, locatário e fiador.
 */
const PERSON_FIELDS = [
  { suffix: "nome", label: "Nome completo", example: "João da Silva", value: (p) => text(p?.fullName) },
  { suffix: "cpf_cnpj", label: "CPF / CNPJ", example: "123.456.789-00", value: (p) => text(p?.cpfCnpj) },
  { suffix: "rg", label: "RG", example: "12.345.678-9", value: (p) => text(p?.rg) },
  { suffix: "rg_orgao", label: "Órgão emissor do RG", example: "SSP/SP", value: (p) => text(p?.rgIssuer) },
  { suffix: "nacionalidade", label: "Nacionalidade", example: "brasileira", value: (p) => text(p?.nationality) },
  {
    suffix: "estado_civil",
    label: "Estado civil",
    example: "casado(a)",
    value: (p) => (p?.maritalStatus ? MARITAL_STATUS[p.maritalStatus] ?? esc(p.maritalStatus) : BLANK),
  },
  { suffix: "profissao", label: "Profissão", example: "engenheiro", value: (p) => text(p?.occupation) },
  { suffix: "data_nascimento", label: "Data de nascimento", example: "05/03/1985", value: (p) => dateBr(p?.birthDate) },
  { suffix: "email", label: "E-mail", example: "joao@example.com", value: (p) => text(p?.email) },
  {
    suffix: "telefone",
    label: "Telefone",
    example: "(11) 99000-1111",
    value: (p) => text(p?.mobile ?? p?.phone),
  },
  {
    suffix: "endereco",
    label: "Endereço completo",
    example: "Rua das Flores, 100 — Centro",
    value: (p) => {
      const a = mainAddress(p);
      if (!a) return BLANK;
      const line = [a.street, a.number, a.district].filter(Boolean).join(", ");
      return line ? esc(line) : BLANK;
    },
  },
  { suffix: "cidade", label: "Cidade", example: "São Paulo", value: (p) => text(mainAddress(p)?.city) },
  { suffix: "uf", label: "UF", example: "SP", value: (p) => text(mainAddress(p)?.state) },
  { suffix: "cep", label: "CEP", example: "01234-567", value: (p) => text(mainAddress(p)?.zip) },
  { suffix: "conjuge_nome", label: "Nome do cônjuge", example: "Maria da Silva", value: (p) => text(p?.spouseName) },
  { suffix: "conjuge_cpf", label: "CPF do cônjuge", example: "987.654.321-00", value: (p) => text(p?.spouseCpf) },
] as const satisfies readonly PersonFieldDef[];

type PersonSuffix = (typeof PERSON_FIELDS)[number]["suffix"];

/** Prefixos que recebem a ficha completa. */
const PERSON_ROLES = [
  { prefix: "locador", group: "Locador", role: "LOCADOR" },
  { prefix: "locatario", group: "Locatário", role: "LOCATARIO" },
  { prefix: "fiador", group: "Fiador", role: "FIADOR" },
] as const;

type PersonPrefix = (typeof PERSON_ROLES)[number]["prefix"];

/* -------------------------------------------------- Campos do imóvel */

interface PropertyFieldDef {
  suffix: string;
  label: string;
  example: string;
  value: (p: Property | null) => string;
}

/**
 * O cadastro guarda **um** preço (`priceCents`); o que ele significa vem da
 * finalidade do imóvel. Por isso os campos de venda e de locação só rendem
 * valor quando a finalidade bate — pôr um aluguel onde o contrato diz "preço de
 * venda" seria escrever o número errado numa escritura.
 */
const salePrice = (p: Property | null): number | null =>
  p && p.purpose === "sale" ? p.priceCents : null;

const rentPrice = (p: Property | null): number | null =>
  p && (p.purpose === "rent" || p.purpose === "season") ? p.priceCents : null;

const PROPERTY_FIELDS = [
  { suffix: "codigo", label: "Código do imóvel", example: "1042", value: (p) => num(p?.code) },
  { suffix: "titulo", label: "Título/descrição", example: "Apartamento 2 dormitórios", value: (p) => text(p?.title) },
  {
    suffix: "endereco",
    label: "Endereço completo",
    example: "Rua das Flores, nº 100, Centro",
    value: (p) => {
      if (!p) return BLANK;
      // O tipo de logradouro é parte do nome da rua ("Rua das Acácias"), não um
      // item separado — só o número e o bairro entram como itens da lista.
      const street = [p.streetType, p.address].filter(Boolean).join(" ");
      const line = [street, p.number ? `nº ${p.number}` : null, p.district]
        .filter(Boolean)
        .join(", ");
      return line ? esc(line) : BLANK;
    },
  },
  { suffix: "numero", label: "Número", example: "100", value: (p) => text(p?.number) },
  { suffix: "bairro", label: "Bairro", example: "Centro", value: (p) => text(p?.district) },
  { suffix: "cidade", label: "Cidade", example: "São Paulo", value: (p) => text(p?.city) },
  { suffix: "uf", label: "UF", example: "SP", value: (p) => text(p?.state) },
  { suffix: "cep", label: "CEP", example: "01234-567", value: (p) => text(p?.zip) },
  { suffix: "quartos", label: "Dormitórios", example: "2", value: (p) => num(p?.bedrooms) },
  { suffix: "area_construida", label: "Área construída (m²)", example: "68", value: (p) => num(p?.builtArea) },
  { suffix: "area_terreno", label: "Área do terreno (m²)", example: "125", value: (p) => num(p?.landArea) },
  { suffix: "valor", label: "Preço do cadastro", example: "250.000,00", value: (p) => brl(p?.priceCents) },
  {
    suffix: "valor_extenso",
    label: "Preço do cadastro (por extenso)",
    example: "duzentos e cinquenta mil reais",
    value: (p) => brlWords(p?.priceCents),
  },
  { suffix: "valor_venda", label: "Preço de venda", example: "250.000,00", value: (p) => brl(salePrice(p)) },
  {
    suffix: "valor_venda_extenso",
    label: "Preço de venda (por extenso)",
    example: "duzentos e cinquenta mil reais",
    value: (p) => brlWords(salePrice(p)),
  },
  { suffix: "valor_aluguel", label: "Valor do aluguel", example: "2.500,00", value: (p) => brl(rentPrice(p)) },
  {
    suffix: "valor_aluguel_extenso",
    label: "Valor do aluguel (por extenso)",
    example: "dois mil e quinhentos reais",
    value: (p) => brlWords(rentPrice(p)),
  },
  { suffix: "valor_condominio", label: "Valor do condomínio", example: "450,00", value: (p) => brl(p?.condoFeeCents) },
  {
    suffix: "valor_condominio_extenso",
    label: "Valor do condomínio (por extenso)",
    example: "quatrocentos e cinquenta reais",
    value: (p) => brlWords(p?.condoFeeCents),
  },
  { suffix: "valor_iptu", label: "Valor do IPTU", example: "1.200,00", value: (p) => brl(p?.iptuCents) },
  {
    suffix: "valor_iptu_extenso",
    label: "Valor do IPTU (por extenso)",
    example: "mil e duzentos reais",
    value: (p) => brlWords(p?.iptuCents),
  },
  { suffix: "matricula", label: "Matrícula do imóvel", example: "123.456", value: (p) => text(p?.registrationNumber) },
  { suffix: "cartorio", label: "Cartório de registro", example: "1º CRI da Capital", value: (p) => text(p?.registryOffice) },
  { suffix: "local_chaves", label: "Local das chaves", example: "Na imobiliária", value: (p) => text(p?.keysLocation) },
  { suffix: "medidor_luz", label: "Medidor de luz", example: "0123456", value: (p) => text(p?.electricityMeter) },
  { suffix: "medidor_agua", label: "Medidor de água", example: "9876543", value: (p) => text(p?.waterMeter) },
] as const satisfies readonly PropertyFieldDef[];

type PropertySuffix = (typeof PROPERTY_FIELDS)[number]["suffix"];

/* ------------------------------ Campos da venda e do comprador */

/**
 * O comprador NÃO é uma `Person`: a venda guarda os dados dele como texto
 * livre, porque o que vai para a escritura é o que foi digitado no dia do
 * fechamento (ver `sale.schema.ts`). Por isso estes campos têm lista própria em
 * vez de reaproveitar `PERSON_FIELDS`.
 *
 * Documento emitido antes de a venda existir sai com tudo em branco — é o mesmo
 * comportamento de um contrato ainda incompleto.
 */
interface SaleFieldDef {
  suffix: string;
  label: string;
  example: string;
  value: (s: Sale | null) => string;
}

const BUYER_FIELDS = [
  { suffix: "nome", label: "Nome do comprador", example: "João da Silva", value: (s) => text(s?.buyerName) },
  { suffix: "cpf", label: "CPF do comprador", example: "123.456.789-00", value: (s) => text(s?.buyerCpf) },
  { suffix: "rg", label: "RG do comprador", example: "12.345.678-9", value: (s) => text(s?.buyerRg) },
  { suffix: "nacionalidade", label: "Nacionalidade", example: "brasileira", value: (s) => text(s?.buyerNationality) },
  {
    suffix: "estado_civil",
    label: "Estado civil",
    example: "casado(a)",
    value: (s) =>
      s?.buyerMaritalStatus
        ? MARITAL_STATUS[s.buyerMaritalStatus] ?? esc(s.buyerMaritalStatus)
        : BLANK,
  },
  { suffix: "profissao", label: "Profissão", example: "engenheiro", value: (s) => text(s?.buyerOccupation) },
  { suffix: "endereco", label: "Endereço", example: "Rua das Flores, 100", value: (s) => text(s?.buyerAddress) },
  { suffix: "bairro", label: "Bairro", example: "Centro", value: (s) => text(s?.buyerDistrict) },
  { suffix: "cidade", label: "Cidade", example: "São Paulo", value: (s) => text(s?.buyerCity) },
  { suffix: "uf", label: "UF", example: "SP", value: (s) => text(s?.buyerState) },
  { suffix: "cep", label: "CEP", example: "01234-567", value: (s) => text(s?.buyerZip) },
  { suffix: "conjuge_nome", label: "Nome do cônjuge", example: "Maria da Silva", value: (s) => text(s?.spouseName) },
  { suffix: "conjuge_cpf", label: "CPF do cônjuge", example: "987.654.321-00", value: (s) => text(s?.spouseCpf) },
  { suffix: "conjuge_rg", label: "RG do cônjuge", example: "98.765.432-1", value: (s) => text(s?.spouseRg) },
  {
    suffix: "conjuge_nacionalidade",
    label: "Nacionalidade do cônjuge",
    example: "brasileira",
    value: (s) => text(s?.spouseNationality),
  },
  {
    suffix: "conjuge_profissao",
    label: "Profissão do cônjuge",
    example: "professora",
    value: (s) => text(s?.spouseOccupation),
  },
  {
    suffix: "regime_casamento",
    label: "Regime de casamento",
    example: "comunhão parcial de bens",
    value: (s) => text(s?.marriageRegime),
  },
] as const satisfies readonly SaleFieldDef[];

type BuyerSuffix = (typeof BUYER_FIELDS)[number]["suffix"];

const SALE_FIELDS = [
  { suffix: "numero", label: "Número da venda", example: "10986", value: (s) => num(s?.code) },
  { suffix: "data", label: "Data da venda", example: "10/08/2026", value: (s) => dateBr(s?.soldAt) },
  { suffix: "valor", label: "Valor da venda", example: "500.000,00", value: (s) => brl(s?.valueCents) },
  {
    suffix: "valor_extenso",
    label: "Valor da venda (por extenso)",
    example: "quinhentos mil reais",
    value: (s) => brlWords(s?.valueCents),
  },
  { suffix: "comissao", label: "Comissão (%)", example: "6", value: (s) => num(s?.commissionPercent) },
  {
    suffix: "forma_pagamento",
    label: "Forma de pagamento",
    example: "Financiado",
    value: (s) => text(s?.paymentMethodName),
  },
  {
    suffix: "forma_pagamento_detalhe",
    label: "Detalhamento do pagamento",
    example: "Sinal de 50.000,00 e o saldo financiado em 360 meses",
    value: (s) => (s?.paymentNotes ? esc(s.paymentNotes) : BLANK),
  },
  { suffix: "corretor", label: "Corretor da venda", example: "Ana Souza", value: (s) => text(s?.brokerName) },
] as const satisfies readonly SaleFieldDef[];

type SaleSuffix = (typeof SALE_FIELDS)[number]["suffix"];

/* ------------------------------------------------ Campos do contrato */

interface ContractFieldDef {
  suffix: string;
  label: string;
  example: string;
  value: (c: Contract, p: Property | null) => string;
}

const CONTRACT_FIELDS = [
  { suffix: "numero", label: "Número do contrato", example: "128", value: (c) => num(c.code) },
  { suffix: "meses", label: "Prazo em meses", example: "30", value: (c) => num(c.termMonths) },
  { suffix: "inicio", label: "Início da vigência", example: "01/08/2026", value: (c) => dateBr(c.startsAt) },
  { suffix: "vencimento", label: "Vencimento", example: "01/02/2029", value: (c) => dateBr(c.endsAt) },
  {
    suffix: "valor",
    label: "Valor do aluguel",
    example: "2.500,00",
    value: (c, p) => brl(c.rentalValueCents ?? p?.priceCents ?? null),
  },
  {
    suffix: "valor_extenso",
    label: "Valor do aluguel (por extenso)",
    example: "dois mil e quinhentos reais",
    value: (c, p) => brlWords(c.rentalValueCents ?? p?.priceCents ?? null),
  },
  {
    suffix: "valor_seguro",
    label: "Valor do seguro",
    example: "380,00",
    value: (c) => brl(c.insuranceValueCents),
  },
  {
    suffix: "valor_seguro_extenso",
    label: "Valor do seguro (por extenso)",
    example: "trezentos e oitenta reais",
    value: (c) => brlWords(c.insuranceValueCents),
  },
  { suffix: "dia_pagamento", label: "Dia de pagamento", example: "10", value: (c) => num(c.tenantPayDay) },
  { suffix: "indice_reajuste", label: "Índice de reajuste", example: "IPCA", value: (c) => text(c.readjustIndex) },
  {
    suffix: "periodo_reajuste",
    label: "Periodicidade do reajuste (meses)",
    example: "12",
    value: (c) => num(c.readjustPeriodMonths),
  },
  { suffix: "multa", label: "Multa (%)", example: "10", value: (c) => num(c.penaltyPercent) },
  { suffix: "juros", label: "Juros (%)", example: "1", value: (c) => num(c.interestPercent) },
  { suffix: "taxa_administracao", label: "Taxa de administração (%)", example: "8", value: (c) => num(c.adminFeePercent) },
  {
    suffix: "garantia",
    label: "Modalidade da garantia",
    example: "fiador",
    value: (c) => (c.guaranteeKind ? GUARANTEE[c.guaranteeKind] ?? esc(c.guaranteeKind) : BLANK),
  },
  {
    suffix: "iptu_responsavel",
    label: "Quem paga o IPTU",
    example: "locatário",
    value: (c) => (c.iptuChargedTo ? IPTU_CHARGED_TO[c.iptuChargedTo] ?? esc(c.iptuChargedTo) : BLANK),
  },
  {
    suffix: "clausulas_especiais",
    label: "Cláusulas especiais",
    example: "Texto livre do contrato",
    value: (c) => (c.specialClauses ? esc(c.specialClauses) : ""),
  },
  {
    suffix: "data_hoje",
    label: "Data de hoje (por extenso)",
    example: "20 de julho de 2026",
    value: () =>
      new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }),
  },
] as const satisfies readonly ContractFieldDef[];

type ContractSuffix = (typeof CONTRACT_FIELDS)[number]["suffix"];

/* ---------------------------------------------------- Testemunhas */

/**
 * Testemunhas não saem de cadastro nenhum: são digitadas na hora de emitir o
 * documento (o popup do contrato de administração). Por isso o valor vem do
 * contexto, e não de uma entidade — num documento gerado sem elas o campo sai
 * como qualquer outro campo em branco.
 */
const WITNESS_FIELDS = [
  { key: "testemunha1.nome", label: "Nome da 1ª testemunha", example: "Ana Souza" },
  { key: "testemunha2.nome", label: "Nome da 2ª testemunha", example: "Carlos Lima" },
] as const;

type WitnessKey = (typeof WITNESS_FIELDS)[number]["key"];

/** Nomes das duas testemunhas informados na emissão. */
export interface WitnessNames {
  first: string;
  second: string;
}

/* --------------------------------------------- Campos agregados (listas) */

/** Papéis com várias pessoas: lista de nomes separada por ";". */
const LIST_FIELDS = [
  { key: "locadores.nomes", group: "Locador", label: "Nomes de todos os locadores", example: "João da Silva; Ana Costa" },
  { key: "locatarios.nomes", group: "Locatário", label: "Nomes de todos os locatários", example: "Maria Souza; Ana Lima" },
  { key: "fiadores.nomes", group: "Fiador", label: "Nomes de todos os fiadores", example: "Carlos Pereira" },
] as const;

type ListKey = (typeof LIST_FIELDS)[number]["key"];

/* ------------------------------------------------------- Catálogo */

export type MergeFieldGroup =
  | "Locador"
  | "Locatário"
  | "Fiador"
  | "Comprador"
  | "Imóvel"
  | "Contrato"
  | "Venda"
  | "Testemunhas";

export interface MergeField {
  /** Chave usada no template: `{{ chave }}`. */
  key: string;
  /** Rótulo exibido na paleta do editor. */
  label: string;
  /** Agrupamento na paleta (um dropdown por grupo). */
  group: MergeFieldGroup;
  /** Exemplo do valor renderizado. */
  example: string;
}

/**
 * União das chaves do catálogo. O contexto de renderização é tipado como
 * `Record<MergeFieldKey, string>`, então esquecer de preencher um campo novo
 * (ou preencher uma chave inexistente) quebra o `typecheck`.
 */
export type MergeFieldKey =
  | `${PersonPrefix}.${PersonSuffix}`
  | `comprador.${BuyerSuffix}`
  | `imovel.${PropertySuffix}`
  | `contrato.${ContractSuffix}`
  | `venda.${SaleSuffix}`
  | ListKey
  | WitnessKey;

/** Catálogo achatado, na ordem em que o editor deve exibir. */
export const MERGE_FIELDS: readonly MergeField[] = [
  ...PERSON_ROLES.flatMap(({ prefix, group }) => [
    ...PERSON_FIELDS.map((f) => ({
      key: `${prefix}.${f.suffix}`,
      label: f.label,
      group: group as MergeFieldGroup,
      example: f.example,
    })),
    ...LIST_FIELDS.filter((l) => l.group === group).map((l) => ({
      key: l.key as string,
      label: l.label,
      group: l.group as MergeFieldGroup,
      example: l.example,
    })),
  ]),
  ...BUYER_FIELDS.map((f) => ({
    key: `comprador.${f.suffix}`,
    label: f.label,
    group: "Comprador" as MergeFieldGroup,
    example: f.example,
  })),
  ...PROPERTY_FIELDS.map((f) => ({
    key: `imovel.${f.suffix}`,
    label: f.label,
    group: "Imóvel" as MergeFieldGroup,
    example: f.example,
  })),
  ...CONTRACT_FIELDS.map((f) => ({
    key: `contrato.${f.suffix}`,
    label: f.label,
    group: "Contrato" as MergeFieldGroup,
    example: f.example,
  })),
  ...SALE_FIELDS.map((f) => ({
    key: `venda.${f.suffix}`,
    label: f.label,
    group: "Venda" as MergeFieldGroup,
    example: f.example,
  })),
  ...WITNESS_FIELDS.map((f) => ({
    key: f.key as string,
    label: f.label,
    group: "Testemunhas" as MergeFieldGroup,
    example: f.example,
  })),
];

const KEYS = new Set<string>(MERGE_FIELDS.map((f) => f.key));

/* ------------------------------------------------------- Parsing */

/** Regex das variáveis: `{{ chave }}` com espaços opcionais. */
const PLACEHOLDER = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Chaves `{{...}}` presentes no HTML, sem repetição e na ordem de aparição. */
export function extractVariables(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(PLACEHOLDER)) {
    const key = match[1]!;
    if (!found.includes(key)) found.push(key);
  }
  return found;
}

/** Variáveis usadas no HTML que não existem no catálogo (nunca seriam preenchidas). */
export function unknownVariables(html: string): string[] {
  return extractVariables(html).filter((key) => !KEYS.has(key));
}

/** Substitui `{{ chave }}` pelos valores do contexto. */
export function render(html: string, ctx: Record<MergeFieldKey, string>): string {
  return html.replace(PLACEHOLDER, (_, key: string) => (ctx as Record<string, string>)[key] ?? "");
}

/* ------------------------------------------------------ Contexto */

export interface MergeSources {
  contract: Contract;
  property: Property | null;
  /** Pessoa principal de cada papel (a 1ª vinculada ao contrato). */
  persons: Record<PersonPrefix, Person | null>;
  /** Nomes de todas as pessoas de cada papel, já formatados. */
  names: Record<PersonPrefix, string>;
  /** Testemunhas digitadas na emissão (ausentes = campo em branco). */
  witnesses?: WitnessNames;
  /**
   * Venda do imóvel, quando já registrada. Ausente nos documentos emitidos
   * antes do fechamento (a autorização de venda, por exemplo): os campos de
   * comprador e de venda saem em branco, para preencher no papel.
   */
  sale?: Sale | null;
}

/**
 * Monta o contexto completo de substituição. O tipo de retorno obriga a
 * cobertura de TODAS as chaves do catálogo.
 */
export function buildMergeContext(src: MergeSources): Record<MergeFieldKey, string> {
  const ctx = {} as Record<string, string>;

  for (const { prefix } of PERSON_ROLES) {
    const person = src.persons[prefix];
    for (const field of PERSON_FIELDS) {
      ctx[`${prefix}.${field.suffix}`] = field.value(person);
    }
  }

  ctx["locadores.nomes"] = src.names.locador;
  ctx["locatarios.nomes"] = src.names.locatario;
  ctx["fiadores.nomes"] = src.names.fiador;

  for (const field of PROPERTY_FIELDS) {
    ctx[`imovel.${field.suffix}`] = field.value(src.property);
  }

  for (const field of BUYER_FIELDS) {
    ctx[`comprador.${field.suffix}`] = field.value(src.sale ?? null);
  }

  for (const field of CONTRACT_FIELDS) {
    ctx[`contrato.${field.suffix}`] = field.value(src.contract, src.property);
  }

  for (const field of SALE_FIELDS) {
    ctx[`venda.${field.suffix}`] = field.value(src.sale ?? null);
  }

  ctx["testemunha1.nome"] = text(src.witnesses?.first);
  ctx["testemunha2.nome"] = text(src.witnesses?.second);

  return ctx as Record<MergeFieldKey, string>;
}
