import { randomUUID } from "node:crypto";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import { htmlToPdf } from "../../shared/pdf.js";
import { presignGetUrl, putObject } from "../../shared/storage.js";
import * as repo from "./contract.repository.js";
import * as propertyService from "../property/property.service.js";
import * as personService from "../person/person.service.js";
import {
  MERGE_FIELDS,
  buildMergeContext,
  extractVariables,
  render,
  unknownVariables,
  type MergeFieldKey,
} from "./merge-fields.js";
import { toDocumentHtml } from "./document.js";
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
  const updated = await repo.updateContract(tenantId, id, input);
  if (!updated) throw AppError.notFound("Contrato não encontrado");
  await publish({
    type: "contract.updated",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { contractId: id },
  });
  // Trocar/definir o imóvel traz o proprietário como locador (se ainda não há um).
  return input.propertyId ? linkOwnersAsLocador(tenantId, id) : updated;
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
