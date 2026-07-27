import assert from "node:assert/strict";
import { test } from "node:test";
import {
  MERGE_FIELDS,
  buildMergeContext,
  extractVariables,
  render,
  unknownVariables,
} from "./merge-fields.js";
import type { Person } from "../person/person.schema.js";
import type { Property } from "../property/property.schema.js";
import type { Contract } from "./contract.schema.js";

/** Puro (sem infra): parsing das variáveis dinâmicas dos templates. */

test("extrai as variáveis do HTML sem repetir e tolerando espaços", () => {
  const html = "<p>{{locador.nome}} e {{ locatarios.nomes }}, {{locador.nome}}</p>";
  assert.deepEqual(extractVariables(html), ["locador.nome", "locatarios.nomes"]);
});

test("aponta variáveis fora do catálogo", () => {
  const html = "<p>{{contrato.valor}} {{locador.signo}}</p>";
  assert.deepEqual(unknownVariables(html), ["locador.signo"]);
});

test("todo campo do catálogo é aceito pelo validador", () => {
  const html = MERGE_FIELDS.map((f) => `{{${f.key}}}`).join(" ");
  assert.deepEqual(unknownVariables(html), []);
});

test("as chaves do catálogo são únicas", () => {
  const keys = MERGE_FIELDS.map((f) => f.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("as variáveis dos templates já existentes continuam válidas", () => {
  // Chaves do seed (init.sql) e de qualquer modelo criado antes da expansão do
  // catálogo. Removê-las quebraria templates em produção na hora de salvar.
  const legacy = [
    "locador.nome",
    "locador.cpf_cnpj",
    "locatarios.nomes",
    "fiadores.nomes",
    "imovel.endereco",
    "imovel.cidade",
    "imovel.uf",
    "contrato.meses",
    "contrato.inicio",
    "contrato.vencimento",
    "contrato.valor",
    "contrato.dia_pagamento",
    "contrato.indice_reajuste",
    "contrato.multa",
    "contrato.juros",
    "contrato.clausulas_especiais",
    "contrato.data_hoje",
  ];
  assert.deepEqual(unknownVariables(legacy.map((k) => `{{${k}}}`).join(" ")), []);
});

test("cada papel de pessoa expõe a mesma ficha completa", () => {
  const suffixes = (prefix: string) =>
    MERGE_FIELDS.filter((f) => f.key.startsWith(`${prefix}.`))
      .map((f) => f.key.slice(prefix.length + 1))
      .sort();

  assert.deepEqual(suffixes("locatario"), suffixes("locador"));
  assert.deepEqual(suffixes("fiador"), suffixes("locador"));
  assert.ok(suffixes("locador").includes("cpf_cnpj"));
  assert.ok(suffixes("locador").includes("rg"));
});

/* ------------------------------------------- Extração dos valores */

// Fixtures parciais: só os campos que os extratores leem (o cast evita repetir
// as ~40 colunas das interfaces completas).
const person = {
  fullName: "João da Silva",
  cpfCnpj: "123.456.789-00",
  rg: "12.345.678-9",
  rgIssuer: "SSP/SP",
  nationality: "brasileira",
  maritalStatus: "CASADO",
  occupation: "engenheiro",
  birthDate: "1985-03-05",
  email: "joao@example.com",
  phone: "1133334444",
  mobile: "11990001111",
  spouseName: "Maria da Silva",
  spouseCpf: "987.654.321-00",
  addresses: [
    { id: "1", kind: "COMERCIAL", street: "Av. Paulista", number: "900", city: "Campinas" },
    { id: "2", kind: "RESIDENCIAL", street: "Rua das Flores", number: "100", district: "Centro", city: "São Paulo", state: "SP", zip: "01234-567" },
  ],
} as unknown as Person;

const property = {
  code: 1042,
  purpose: "rent",
  streetType: "Rua",
  address: "das Acácias",
  number: "55",
  district: "Jardins",
  city: "São Paulo",
  state: "SP",
  bedrooms: 2,
  condoFeeCents: 45000,
  priceCents: 250000,
} as unknown as Property;

const contract = {
  code: 128,
  termMonths: 30,
  startsAt: "2026-08-01",
  endsAt: "2029-02-01",
  rentalValueCents: 250000,
  tenantPayDay: 10,
  readjustIndex: "IPCA",
  penaltyPercent: 10,
  interestPercent: 1,
  guaranteeKind: "FIADOR",
  iptuChargedTo: "LOCATARIO",
  specialClauses: "Sem animais.",
} as unknown as Contract;

const ctx = buildMergeContext({
  contract,
  property,
  persons: { locador: person, locatario: null, fiador: null },
  names: { locador: "João da Silva", locatario: "Ana Lima; Pedro N.", fiador: "____________" },
});

test("a ficha da pessoa é extraída dos campos certos", () => {
  assert.equal(ctx["locador.nome"], "João da Silva");
  assert.equal(ctx["locador.rg_orgao"], "SSP/SP");
  assert.equal(ctx["locador.estado_civil"], "casado(a)", "o enum vira texto legível");
  assert.equal(ctx["locador.data_nascimento"], "05/03/1985", "data em dd/mm/aaaa");
  assert.equal(ctx["locador.telefone"], "11990001111", "celular tem precedência sobre o fixo");
  assert.equal(ctx["locador.conjuge_cpf"], "987.654.321-00");
});

test("o endereço da pessoa usa o RESIDENCIAL, não o primeiro da lista", () => {
  assert.equal(ctx["locador.endereco"], "Rua das Flores, 100, Centro");
  assert.equal(ctx["locador.cidade"], "São Paulo");
  assert.equal(ctx["locador.cep"], "01234-567");
});

test("campos sem dado viram lacuna visível em vez de string vazia", () => {
  assert.equal(ctx["locatario.nome"], "____________");
  assert.equal(ctx["fiador.cpf_cnpj"], "____________");
  assert.equal(ctx["locatarios.nomes"], "Ana Lima; Pedro N.", "a lista independe da ficha");
});

test("imóvel e contrato são formatados para o texto do contrato", () => {
  assert.equal(ctx["imovel.endereco"], "Rua das Acácias, nº 55, Jardins");
  assert.equal(ctx["imovel.valor_condominio"], "450,00");
  assert.equal(ctx["contrato.valor"], "2.500,00");
  assert.equal(ctx["contrato.inicio"], "01/08/2026");
  assert.equal(ctx["contrato.garantia"], "fiador");
  assert.equal(ctx["contrato.iptu_responsavel"], "locatário");
  assert.equal(ctx["contrato.numero"], "128");
});

test("todo campo monetário tem o par por extenso", () => {
  const keys = new Set(MERGE_FIELDS.map((f) => f.key));
  for (const key of keys) {
    if (!key.includes("valor") || key.endsWith("_extenso")) continue;
    assert.ok(keys.has(`${key}_extenso`), `campo de dinheiro sem par por extenso: ${key}`);
  }
});

test("valores em dinheiro saem também por extenso", () => {
  assert.equal(ctx["contrato.valor_extenso"], "dois mil e quinhentos reais");
  assert.equal(ctx["imovel.valor_condominio_extenso"], "quatrocentos e cinquenta reais");
  assert.equal(ctx["contrato.valor_seguro_extenso"], "____________", "sem valor, lacuna visível");
});

test("preço de venda e de aluguel seguem a finalidade do imóvel", () => {
  // O cadastro guarda um preço só; a finalidade diz o que ele é.
  assert.equal(ctx["imovel.valor_aluguel"], "2.500,00");
  assert.equal(ctx["imovel.valor_aluguel_extenso"], "dois mil e quinhentos reais");
  assert.equal(ctx["imovel.valor_venda"], "____________", "imóvel de locação não tem preço de venda");

  const sale = buildMergeContext({
    contract,
    property: { ...property, purpose: "sale", priceCents: 25_000_000 } as Property,
    persons: { locador: null, locatario: null, fiador: null },
    names: { locador: "x", locatario: "x", fiador: "x" },
  });
  assert.equal(sale["imovel.valor_venda"], "250.000,00");
  assert.equal(sale["imovel.valor_venda_extenso"], "duzentos e cinquenta mil reais");
  assert.equal(sale["imovel.valor_aluguel"], "____________");
});

test("o contexto cobre todas as chaves do catálogo (nada renderiza vazio por engano)", () => {
  for (const field of MERGE_FIELDS) {
    assert.notEqual(
      (ctx as Record<string, string>)[field.key],
      undefined,
      `campo do catálogo sem valor no contexto: ${field.key}`,
    );
  }
});

test("render substitui as variáveis e escapa HTML dos dados", () => {
  const malicious = buildMergeContext({
    contract,
    property,
    persons: { locador: { ...person, fullName: "<script>alert(1)</script>" } as Person, locatario: null, fiador: null },
    names: { locador: "x", locatario: "x", fiador: "x" },
  });
  const out = render("<p>{{ locador.nome }} — {{contrato.numero}}</p>", malicious);
  assert.ok(!out.includes("<script>"), "o nome não pode injetar HTML no documento");
  assert.ok(out.includes("&lt;script&gt;"));
  assert.ok(out.includes("128"));
});

test("os grupos da paleta são exatamente os dropdowns da tela", () => {
  const groups = [...new Set(MERGE_FIELDS.map((f) => f.group))];
  assert.deepEqual(groups, ["Locador", "Locatário", "Fiador", "Imóvel", "Contrato"]);
});
