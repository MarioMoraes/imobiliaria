import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import { logger } from "../../shared/logger.js";
import { htmlToPdf } from "../../shared/pdf.js";
import { presignGetUrl, putObject } from "../../shared/storage.js";
import * as repo from "./contract.repository.js";
import * as propertyService from "../property/property.service.js";
import * as personService from "../person/person.service.js";
import * as receivableService from "../receivable/receivable.service.js";
import {
  MERGE_FIELDS,
  buildMergeContext,
  extractVariables,
  render,
  unknownVariables,
  type MergeFieldKey,
  type WitnessNames,
} from "./merge-fields.js";
import { appendWitnessBlock, hasWitnessPlaceholder, toDocumentHtml } from "./document.js";
import type { Property } from "../property/property.schema.js";
import type {
  Contract,
  ContractParty,
  ContractTemplate,
  CreateContractInput,
  CreateContractTemplateInput,
  UpdateContractInput,
  UpdateContractTemplateInput,
} from "./contract.schema.js";

/**
 * Regras de negócio de contratos. O service é a fronteira do módulo: routes
 * chamam o service, nunca o repository direto; a integração com outros módulos
 * (imóvel, pessoa) é feita pelo service público deles.
 */

export function list(tenantId: string): Promise<Contract[]> {
  return repo.listContracts(tenantId);
}

/** Busca livre (barra global): número do contrato ou nome de uma das partes. */
export function search(tenantId: string, term: string, limit?: number): Promise<Contract[]> {
  return repo.searchContracts(tenantId, term, limit);
}

export async function getById(tenantId: string, id: string): Promise<Contract> {
  const contract = await repo.findContract(tenantId, id);
  if (!contract) throw AppError.notFound("Contrato não encontrado");
  return contract;
}

export async function create(
  tenantId: string,
  input: CreateContractInput,
): Promise<Contract> {
  const contract = await repo.insertContract(tenantId, input);
  await publish({
    type: "contract.created",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { contractId: contract.id },
  });
  // Escolher o imóvel já traz o proprietário como locador.
  return linkOwnersAsLocador(tenantId, contract.id);
}

export async function update(
  tenantId: string,
  id: string,
  input: UpdateContractInput,
): Promise<Contract> {
  const before = await getById(tenantId, id);
  const updated = await repo.updateContract(tenantId, id, input);
  if (!updated) throw AppError.notFound("Contrato não encontrado");
  await publish({
    type: "contract.updated",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { contractId: id },
  });

  // Entrou em vigência (assinaturas concluídas): imóvel alugado + aluguéis.
  if (updated.status === "VIGENTE" && before.status !== "VIGENTE") {
    await activate(tenantId, updated);
  }
  // Fim da locação: libera o imóvel e cancela o que ainda não venceu. Só nos
  // status terminais — voltar para EM_ASSINATURA (correção de um envio) ou
  // RENOVADO mantém o imóvel ocupado e as parcelas de pé.
  if (
    before.status === "VIGENTE" &&
    (updated.status === "ENCERRADO" || updated.status === "DISTRATADO")
  ) {
    await deactivate(tenantId, updated);
  }

  // Trocar/definir o imóvel traz o proprietário como locador (se ainda não há um).
  return input.propertyId ? linkOwnersAsLocador(tenantId, id) : updated;
}

/**
 * Efeitos da entrada em vigência do contrato (contratos_08 §7): o imóvel passa
 * a ALUGADO e os aluguéis do período viram contas a receber.
 *
 * Chamado pela transição de status em `update` — vale tanto para o webhook de
 * assinatura quanto para uma mudança manual. Idempotente: reprocessar não
 * duplica parcela (unique por contrato+competência no MOD-FIN).
 *
 * Nenhum dos dois efeitos derruba a transição: um imóvel apagado ou um contrato
 * sem valor não podem impedir o contrato de ficar VIGENTE — o erro é logado e o
 * financeiro regenera depois de completar o cadastro.
 */
async function activate(tenantId: string, contract: Contract): Promise<void> {
  if (contract.propertyId) {
    try {
      await propertyService.update(tenantId, contract.propertyId, { status: "rented" });
    } catch (err) {
      logger.error(
        { err, tenantId, contractId: contract.id, propertyId: contract.propertyId },
        "não foi possível marcar o imóvel como alugado",
      );
    }
  }

  try {
    await receivableService.generateRentSchedule(tenantId, {
      contractId: contract.id,
      propertyId: contract.propertyId,
      // Quem paga o aluguel é o locatário (o primeiro, quando há vários).
      payerPersonId: contract.parties.find((p) => p.role === "LOCATARIO")?.personId ?? null,
      startsAt: contract.startsAt,
      endsAt: contract.endsAt,
      termMonths: contract.termMonths,
      tenantPayDay: contract.tenantPayDay,
      rentalValueCents: contract.rentalValueCents,
    });
  } catch (err) {
    logger.error(
      { err, tenantId, contractId: contract.id },
      "não foi possível gerar os aluguéis do contrato",
    );
  }
}

/** Fim da vigência: imóvel volta a Disponível e as parcelas abertas caem. */
async function deactivate(tenantId: string, contract: Contract): Promise<void> {
  if (contract.propertyId) {
    try {
      await propertyService.update(tenantId, contract.propertyId, { status: "available" });
    } catch (err) {
      logger.error(
        { err, tenantId, propertyId: contract.propertyId },
        "não foi possível liberar o imóvel",
      );
    }
  }

  try {
    await receivableService.cancelOpenByContract(
      tenantId,
      contract.id,
      contract.terminatedAt ?? undefined,
    );
  } catch (err) {
    logger.error({ err, tenantId, contractId: contract.id }, "não foi possível cancelar as parcelas");
  }
}

/**
 * Regeração manual dos aluguéis — usada quando o contrato foi assinado com o
 * valor/prazo ainda em branco e o financeiro completou depois.
 */
export async function generateReceivables(
  tenantId: string,
  id: string,
): Promise<{ created: number }> {
  const contract = await getById(tenantId, id);
  if (contract.status !== "VIGENTE") {
    throw AppError.badRequest(
      "Os aluguéis só são gerados para contratos vigentes (com todas as assinaturas confirmadas).",
    );
  }
  const created = await receivableService.generateRentSchedule(tenantId, {
    contractId: contract.id,
    propertyId: contract.propertyId,
    payerPersonId: contract.parties.find((p) => p.role === "LOCATARIO")?.personId ?? null,
    startsAt: contract.startsAt,
    endsAt: contract.endsAt,
    termMonths: contract.termMonths,
    tenantPayDay: contract.tenantPayDay,
    rentalValueCents: contract.rentalValueCents,
  });
  return { created };
}

export async function remove(tenantId: string, id: string): Promise<void> {
  const removed = await repo.deleteContract(tenantId, id);
  if (!removed) throw AppError.notFound("Contrato não encontrado");
}

/* ---------------------------------------------------------- Partes */

export async function listParties(tenantId: string, contractId: string): Promise<ContractParty[]> {
  const contract = await getById(tenantId, contractId);
  return contract.parties;
}

/**
 * Vincula uma parte (pessoa) ao contrato. Valida que a pessoa existe no tenant
 * via o service público de MOD-PESSOA (nunca acessa o repository de outro módulo).
 */
export async function addParty(
  tenantId: string,
  contractId: string,
  role: string,
  personId: string,
): Promise<Contract> {
  await getById(tenantId, contractId); // 404 se o contrato não existir
  await personService.getById(tenantId, personId); // 404 ERR_PESSOA_001 se não existir
  return repo.addParty(tenantId, contractId, role, personId);
}

export async function removeParty(
  tenantId: string,
  contractId: string,
  partyId: string,
): Promise<Contract> {
  await getById(tenantId, contractId);
  return repo.removeParty(tenantId, contractId, partyId);
}

/**
 * Vincula o(s) proprietário(s) do imóvel como LOCADOR do contrato — quem aluga
 * é o dono, então escolher o imóvel já define o locador.
 *
 * Idempotente e **não destrutivo**: só age quando o contrato ainda não tem
 * nenhum LOCADOR, para nunca sobrescrever uma escolha manual (ex.: procurador
 * ou espólio no lugar do proprietário registrado). Imóvel sem dono cadastrado
 * simplesmente não vincula nada.
 */
export async function linkOwnersAsLocador(
  tenantId: string,
  contractId: string,
): Promise<Contract> {
  const contract = await getById(tenantId, contractId);
  if (!contract.propertyId) return contract;
  if (contract.parties.some((p) => p.role === "LOCADOR")) return contract;

  const property = await propertyService
    .getById(tenantId, contract.propertyId)
    .catch(() => null);
  const owners = property?.owners ?? [];
  if (owners.length === 0) return contract;

  let updated = contract;
  // Vários donos = todos assinam como locadores (coproprietários).
  for (const owner of owners) {
    updated = await repo.addParty(tenantId, contractId, "LOCADOR", owner.personId);
  }
  return updated;
}

/* ------------------------------------------------------- Templates */

export function listTemplates(
  tenantId: string,
  includeInactive = false,
): Promise<ContractTemplate[]> {
  return repo.listTemplates(tenantId, includeInactive);
}

export async function getTemplate(tenantId: string, id: string): Promise<ContractTemplate> {
  const template = await repo.findTemplateById(tenantId, id);
  if (!template) throw AppError.notFound("Modelo de contrato não encontrado");
  return template;
}

/**
 * Rejeita `{{variaveis}}` fora do catálogo: elas seriam renderizadas como vazio
 * no PDF, e o erro só apareceria no documento final.
 */
function assertKnownVariables(content: string): void {
  const unknown = unknownVariables(content);
  if (unknown.length > 0) {
    throw AppError.badRequest(
      `Variáveis desconhecidas no modelo: ${unknown.map((v) => `{{${v}}}`).join(", ")}`,
      { unknown },
    );
  }
}

export async function createTemplate(
  tenantId: string,
  input: CreateContractTemplateInput,
): Promise<ContractTemplate> {
  assertKnownVariables(input.content);
  return repo.insertTemplate(tenantId, {
    ...input,
    variables: extractVariables(input.content),
  });
}

export async function updateTemplate(
  tenantId: string,
  id: string,
  input: UpdateContractTemplateInput,
): Promise<ContractTemplate> {
  if (input.content !== undefined) assertKnownVariables(input.content);
  const updated = await repo.updateTemplate(tenantId, id, {
    ...input,
    // `variables` é derivada do conteúdo — só muda quando o conteúdo muda.
    variables: input.content === undefined ? undefined : extractVariables(input.content),
  });
  if (!updated) throw AppError.notFound("Modelo de contrato não encontrado");
  return updated;
}

/**
 * Pré-visualização do modelo com os valores de EXEMPLO do catálogo. Passa pelo
 * mesmo `toDocumentHtml` + `render` da geração real, então o que o usuário vê
 * no editor é o que sai no PDF (fora os dados).
 */
export function previewTemplate(content: string): string {
  const examples = Object.fromEntries(
    MERGE_FIELDS.map((f) => [f.key, f.example]),
  ) as Record<MergeFieldKey, string>;
  return render(toDocumentHtml(content), examples);
}

/**
 * Remove um modelo. Contratos guardam `template_id`; apagar um modelo em uso
 * deixaria esses contratos sem como regerar o PDF — por isso o 409.
 */
export async function removeTemplate(tenantId: string, id: string): Promise<void> {
  const inUse = await repo.countContractsUsingTemplate(tenantId, id);
  if (inUse > 0) {
    throw new AppError("CONFLICT", 409, `Modelo em uso por ${inUse} contrato(s). Desative-o em vez de excluir.`, {
      contracts: inUse,
    });
  }
  const removed = await repo.deleteTemplate(tenantId, id);
  if (!removed) throw AppError.notFound("Modelo de contrato não encontrado");
}

/* --------------------------------------------- Geração do documento */

/** Escapa o que quebraria o HTML (usado só nas listas de nomes). */
const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Reúne contrato + imóvel + pessoas e delega a montagem do contexto ao catálogo
 * (`merge-fields.ts`), que sabe extrair cada campo. Papéis com várias pessoas
 * expõem a ficha completa da PRIMEIRA parte e a lista de nomes de todas; o
 * LOCADOR cai para os donos do imóvel quando não há parte LOCADOR explícita.
 */
async function buildContext(
  tenantId: string,
  contract: Contract,
  witnesses?: WitnessNames,
): Promise<Record<MergeFieldKey, string>> {
  const property = contract.propertyId
    ? await propertyService.getById(tenantId, contract.propertyId).catch(() => null)
    : null;

  const byRole = (role: string) => contract.parties.filter((p) => p.role === role);
  const nameList = (parties: { personName: string }[]): string =>
    parties.length ? parties.map((p) => esc(p.personName)).join("; ") : "____________";

  const locadores = byRole("LOCADOR");
  const locatarios = byRole("LOCATARIO");
  const fiadores = byRole("FIADOR");

  // LOCADOR: parte explícita ou, na falta, o dono do imóvel.
  const locadorId = locadores[0]?.personId ?? property?.owners?.[0]?.personId ?? null;
  const load = (id: string | null | undefined) =>
    id ? personService.getById(tenantId, id).catch(() => null) : Promise.resolve(null);

  const [locador, locatario, fiador] = await Promise.all([
    load(locadorId),
    load(locatarios[0]?.personId),
    load(fiadores[0]?.personId),
  ]);

  const ownerName = property?.owners?.[0]?.personName;
  return buildMergeContext({
    contract,
    property,
    persons: { locador, locatario, fiador },
    names: {
      locador: locadores.length ? nameList(locadores) : ownerName ? esc(ownerName) : "____________",
      locatario: nameList(locatarios),
      fiador: nameList(fiadores),
    },
    witnesses,
  });
}

/**
 * Gera o PDF do contrato: renderiza o template, converte via Gotenberg, guarda o
 * binário no object storage e grava a versão (imutável).
 *
 * Devolve também o **buffer**: o MOD-ASSINATURA precisa dos bytes para mandar o
 * documento em base64 ao provedor (a URL presignada aponta para o storage
 * interno, que a ZapSign não alcança).
 */
export async function generateAndStore(
  tenantId: string,
  contractId: string,
): Promise<{ url: string; version: number; pdf: Buffer; storageKey: string }> {
  const contract = await getById(tenantId, contractId);
  const template = await repo.findTemplate(tenantId, contract.templateId);
  if (!template) {
    throw AppError.badRequest("Nenhum modelo de contrato disponível para gerar o documento.");
  }

  const ctx = await buildContext(tenantId, contract);
  const html = render(toDocumentHtml(template.content), ctx);
  const pdf = await htmlToPdf(html);

  const storageKey = `${tenantId}/contracts/${contractId}/${randomUUID()}.pdf`;
  await putObject(storageKey, pdf, "application/pdf");

  const { version } = await repo.insertVersion(tenantId, contractId, storageKey, {
    templateId: template.id,
    context: ctx,
    generatedAt: new Date().toISOString(),
  });

  await publish({
    type: "contract.document_generated",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { contractId, version },
  });

  return { url: await presignGetUrl(storageKey), version, pdf, storageKey };
}

/** Geração do documento pela API (só a URL interessa a quem chama a rota). */
export async function generateDocument(
  tenantId: string,
  contractId: string,
): Promise<{ url: string; version: number }> {
  const { url, version } = await generateAndStore(tenantId, contractId);
  return { url, version };
}

/* ------------------------------- Contrato de administração (imóvel) */

/** Minúsculas sem acento — para casar o nome do modelo como o usuário digitou. */
const fold = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Localiza o modelo do contrato de administração entre os modelos ATIVOS do
 * tenant. O nome é escolhido por quem cadastra ("Administração Com Garantia",
 * "Contrato de Administração de Imóvel"…), então a busca é por palavra-chave:
 * primeiro o modelo COM garantia, e só na falta dele um de administração
 * qualquer — melhor emitir o documento de administração disponível do que
 * recusar por diferença de nome.
 */
async function findAdministrationTemplate(tenantId: string): Promise<ContractTemplate | null> {
  const templates = await repo.listTemplates(tenantId);
  const administration = templates.filter((t) => fold(t.name).includes("administra"));
  return administration.find((t) => fold(t.name).includes("garantia")) ?? administration[0] ?? null;
}

/**
 * Contrato "de papel" para o contrato de ADMINISTRAÇÃO: ele é firmado entre a
 * imobiliária e o proprietário ANTES de existir locação, então não há registro
 * em `contracts` para pendurar o documento — nem faria sentido criar um.
 *
 * Os campos que o modelo aproveita saem do cadastro do imóvel (aluguel, taxa de
 * administração); o resto fica nulo e o catálogo renderiza o placeholder, do
 * mesmo jeito que num contrato ainda incompleto.
 */
function administrationDraft(
  tenantId: string,
  property: Property,
  templateId: string,
): Contract {
  const now = new Date().toISOString();
  return {
    id: "",
    tenantId,
    code: null,
    propertyId: property.id,
    templateId,
    status: "RASCUNHO",

    startsAt: null,
    endsAt: null,
    termMonths: null,
    readjustIndex: "IPCA",
    readjustPeriodMonths: null,
    lastReadjustAt: null,
    ownerPayDay: null,
    tenantPayDay: null,
    terminatedAt: null,

    // O aluguel só existe como preço do cadastro quando o imóvel é de locação.
    rentalValueCents:
      property.purpose === "rent" || property.purpose === "season" ? property.priceCents : null,
    interestPercent: null,
    penaltyPercent: null,
    adminFeePercent: property.adminFeePercent,
    isAdministration: true,
    incomeTaxDeclaration: false,
    iptuChargedTo: null,
    commissionType: null,
    hasCommission: false,

    guaranteeKind: null,
    hasInsurance: false,
    insuranceDescription: null,
    insuranceValueCents: null,

    isSettled: false,
    hasEvictionOrder: false,
    hasJudicialExecution: false,
    processNumber: null,
    court: null,

    specialClauses: null,
    guarantorPropertyInfo: null,

    // Sem partes: o LOCADOR cai para os proprietários do imóvel (`buildContext`).
    parties: [],
    latestVersion: null,
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Contrato de administração do imóvel em PDF, emitido direto do cadastro do
 * imóvel: responde os BYTES (como o laudo de vistoria) e **não** guarda versão —
 * não há contrato ao qual versionar.
 *
 * As testemunhas vêm do popup, e não do banco: são quem estava na sala na
 * assinatura.
 */
export async function generateAdministrationDocument(
  tenantId: string,
  propertyId: string,
  witnesses: WitnessNames,
): Promise<{ pdf: Buffer; fileName: string }> {
  const property = await propertyService.getById(tenantId, propertyId);

  const template = await findAdministrationTemplate(tenantId);
  if (!template) {
    throw AppError.badRequest(
      'Nenhum modelo de contrato de administração ativo. Cadastre-o em Tabelas › Modelos de Contrato (com "administração" no nome).',
    );
  }

  const draft = administrationDraft(tenantId, property, template.id);
  const ctx = await buildContext(tenantId, draft, witnesses);

  let html = render(toDocumentHtml(template.content), ctx);
  if (!hasWitnessPlaceholder(template.content)) {
    html = appendWitnessBlock(html, witnesses.first, witnesses.second);
  }

  const pdf = await htmlToPdf(html);
  return { pdf, fileName: `contrato-administracao-${property.code ?? "imovel"}.pdf` };
}

/**
 * Registra o PDF **assinado** como nova versão imutável do contrato. Chamado
 * pelo MOD-ASSINATURA quando todas as partes assinam; o binário já está no
 * nosso storage (a URL do provedor expira em 60 min).
 */
export async function registerSignedVersion(
  tenantId: string,
  contractId: string,
  storageKey: string,
  snapshot: unknown,
): Promise<number> {
  const { version } = await repo.insertVersion(tenantId, contractId, storageKey, snapshot);
  return version;
}

/** URL presignada do PDF da versão vigente (404 se nada foi gerado ainda). */
export async function getPdfUrl(tenantId: string, contractId: string): Promise<string> {
  await getById(tenantId, contractId);
  const key = await repo.findLatestVersionKey(tenantId, contractId);
  if (!key) throw AppError.notFound("Nenhum documento gerado para este contrato ainda");
  return presignGetUrl(key);
}
