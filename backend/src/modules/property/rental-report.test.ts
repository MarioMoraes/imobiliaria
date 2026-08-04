import assert from "node:assert/strict";
import { test } from "node:test";
import { groupByDistrict, toRentalReportHtml } from "./rental-report.js";
import type { Property } from "./property.schema.js";

/**
 * O relatório é a relação que se entrega no balcão: o que importa é a quebra
 * por bairro e as quatro colunas (código, endereço, dependências, aluguel).
 * Testes do HTML puro — sem banco e sem Gotenberg.
 */

function property(over: Partial<Property> = {}): Property {
  return {
    id: "p1",
    tenantId: "t",
    code: 10,
    title: "Apartamento",
    kind: "apartment",
    purpose: "rent",
    propertyTypeId: null,
    isDevelopment: false,
    status: "available",
    priceCents: 150_000,

    contractNumber: null,
    condominiumId: null,
    isCommercial: false,

    streetType: "Rua",
    address: "das Flores",
    number: "120",
    district: "Centro",
    city: "Curitiba",
    state: "PR",
    zip: null,
    keysLocation: null,
    hasSign: false,
    positionFront: false,
    positionBack: false,

    bedrooms: 2,
    builtArea: null,
    landArea: null,
    floorInfo: null,
    ceilingInfo: null,
    electricityMeter: null,
    waterMeter: null,
    dependencies: "2 quartos, sala & cozinha",
    allowPets: false,
    allowStudents: false,

    condoFeeCents: null,
    iptuCents: null,
    iptuChargedTo: null,
    iptuReimburseOwner: false,
    iptuInstallments: null,
    iptuInstallmentCents: null,
    adminFeePercent: null,
    chargeAdminFee: false,
    isGuaranteed: false,

    leaseTermMonths: null,
    leaseStart: null,
    penaltyInfo: null,
    hasCommission: false,
    commissionType: null,
    entryDate: null,

    brokerId: null,
    capturerId: null,
    extraData: null,
    publishWeb: false,
    hasPhotos: false,
    notes: null,

    isAuthorized: false,
    isExclusive: false,
    authTerm: null,
    authDays: null,
    authExpiry: null,
    isRecorded: false,
    hasDeed: false,
    isRegistered: false,
    isSold: false,
    registryOffice: null,
    registrationNumber: null,

    topography: null,
    lotNumber: null,
    blockNumber: null,
    frontMeasure: null,
    backMeasure: null,
    leftMeasure: null,
    rightMeasure: null,

    owners: [],
    createdAt: "2026-01-10T10:00:00.000Z",
    updatedAt: "2026-01-10T10:00:00.000Z",
    ...over,
  };
}

const emitidoEm = new Date("2026-08-04T12:00:00.000Z");

test("agrupa por bairro em ordem alfabética, com os sem bairro por último", () => {
  const groups = groupByDistrict([
    property({ id: "a", district: "Água Verde" }),
    property({ id: "b", district: "  " }),
    property({ id: "c", district: "Batel" }),
    property({ id: "d", district: null }),
    property({ id: "e", district: "agua verde" }),
  ]);

  assert.deepEqual(
    groups.map((g) => g.district),
    ["Água Verde", "agua verde", "Batel", "Sem bairro informado"],
  );
  // Bairro em branco e nulo caem no MESMO grupo — senão a relação teria duas
  // seções vazias dizendo a mesma coisa.
  assert.equal(groups[3]!.properties.length, 2);
});

test("ordena cada bairro pelo código, com os sem código no fim", () => {
  const groups = groupByDistrict([
    property({ id: "a", code: 30 }),
    property({ id: "b", code: null }),
    property({ id: "c", code: 7 }),
  ]);

  assert.deepEqual(
    groups[0]!.properties.map((p) => p.id),
    ["c", "a", "b"],
  );
});

test("mostra código, endereço, dependências e aluguel de cada imóvel", () => {
  const html = toRentalReportHtml({
    tenantName: "Imobiliária Teste",
    properties: [property()],
    generatedAt: emitidoEm,
  });

  assert.match(html, />10</);
  assert.match(html, /Rua das Flores, 120/);
  // O bairro é o título do grupo; repeti-lo na linha do endereço só rouba
  // largura da coluna de dependências.
  assert.match(html, /<h2>Centro/);
  assert.doesNotMatch(html, /Rua das Flores, 120[^<]*Centro/);
  assert.match(html, /R\$\s*1\.500,00/);
  assert.match(html, /1 imóvel em 1 bairro/);
  assert.match(html, /emitido em 04\/08\/2026/);
});

test("escapa o texto livre do cadastro", () => {
  const html = toRentalReportHtml({
    tenantName: "Imóveis & Cia",
    properties: [property({ dependencies: "sala & <b>quarto</b>" })],
    generatedAt: emitidoEm,
  });

  assert.match(html, /Imóveis &amp; Cia/);
  assert.match(html, /sala &amp; &lt;b&gt;quarto&lt;\/b&gt;/);
});

test("imóvel sem preço não sai zerado", () => {
  const html = toRentalReportHtml({
    tenantName: "Imobiliária Teste",
    properties: [property({ priceCents: null })],
    generatedAt: emitidoEm,
  });

  // "R$ 0,00" seria lido como aluguel de graça; o cadastro sem valor é
  // justamente o que ainda não tem preço fechado.
  assert.match(html, /a combinar/);
  assert.doesNotMatch(html, /R\$\s*0,00/);
});

test("sem imóveis, o PDF explica o vazio em vez de sair com tabela em branco", () => {
  const html = toRentalReportHtml({
    tenantName: "Imobiliária Teste",
    properties: [],
    generatedAt: emitidoEm,
  });

  assert.match(html, /Nenhum imóvel disponível para locação/);
  assert.match(html, /0 imóveis em 0 bairros/);
});
