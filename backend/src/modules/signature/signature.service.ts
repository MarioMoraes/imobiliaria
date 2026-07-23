import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import { decrypt, encrypt, randomSecret, secretEquals } from "../../shared/crypto.js";
import { AppError } from "../../shared/errors.js";
import { publish } from "../../shared/events.js";
import { logger } from "../../shared/logger.js";
import { putObject } from "../../shared/storage.js";
import * as contractService from "../contract/contract.service.js";
import * as personService from "../person/person.service.js";
import * as repo from "./signature.repository.js";
import * as zapsign from "./zapsign.client.js";
import type { ZapSignDoc } from "./zapsign.client.js";
import type {
  SaveSettingsInput,
  SignatureCredentials,
  SignatureEnvelope,
  SignatureSettingsView,
} from "./signature.schema.js";

/**
 * Regras da assinatura eletrônica. O provedor é a ZapSign, mas o service fala
 * em "envelope/signatário" e traduz os status na fronteira — trocar de provedor
 * mexe em `zapsign.client.ts` e nos dois mapeamentos abaixo, não no fluxo.
 *
 * Dependências: este módulo chama `contract.service` (público). O contrário não
 * acontece — o módulo de contrato não conhece assinatura.
 */

/* ---------------------------------------------- Configuração do tenant */

/** Endereço que a ZapSign chama de volta. O tenant vai na URL (ver routes). */
export function webhookUrlFor(tenantId: string): string {
  return `${env.PUBLIC_BASE_URL.replace(/\/$/, "")}/webhooks/zapsign/${tenantId}`;
}

/** Localhost não é alcançável pela ZapSign — nesse caso pulamos o registro. */
function isPubliclyReachable(url: string): boolean {
  return !/localhost|127\.0\.0\.1|0\.0\.0\.0|\.local(\b|\/)/i.test(url);
}

export async function getSettings(tenantId: string): Promise<SignatureSettingsView> {
  const row = await repo.findSettings(tenantId);
  return {
    connected: Boolean(row?.apiTokenEnc),
    provider: row?.provider ?? "ZAPSIGN",
    sandbox: row?.sandbox ?? true,
    authMode: row?.authMode ?? "assinaturaTela-tokenEmail",
    tokenHint: row?.apiTokenHint ?? null,
    webhookUrl: webhookUrlFor(tenantId),
    webhookRegisteredAt: row?.webhookRegisteredAt ?? null,
    updatedAt: row?.updatedAt ?? null,
  };
}

/**
 * Conecta (ou reconfigura) a conta ZapSign do tenant. O token é validado contra
 * a API ANTES de ser gravado — salvar uma credencial inválida só apareceria na
 * hora de enviar um contrato real para assinatura.
 */
export async function saveSettings(
  tenantId: string,
  input: SaveSettingsInput,
): Promise<SignatureSettingsView> {
  const current = await repo.findSettings(tenantId);
  const token = input.apiToken ?? (current?.apiTokenEnc ? decrypt(current.apiTokenEnc) : null);
  if (!token) {
    throw new AppError("ERR_ASSINATURA_001", 400, "Informe o token da API da ZapSign.");
  }

  // Valida a credencial ANTES de gravar: um token errado só apareceria na hora
  // de enviar um contrato real para assinatura.
  await zapsign.validateToken({ token, sandbox: input.sandbox });

  await repo.upsertSettings(tenantId, {
    apiTokenEnc: input.apiToken ? encrypt(input.apiToken) : undefined,
    apiTokenHint: input.apiToken ? input.apiToken.slice(-4) : undefined,
    sandbox: input.sandbox,
    authMode: input.authMode,
    webhookSecret: current?.webhookSecret ?? randomSecret(),
  });

  const saved = await repo.findSettings(tenantId);
  const url = webhookUrlFor(tenantId);
  if (isPubliclyReachable(url) && saved?.webhookSecret) {
    try {
      await zapsign.registerWebhook({ token, sandbox: input.sandbox }, url, {
        name: "x-officesai-signature-secret",
        value: saved.webhookSecret,
      });
      await repo.markWebhookRegistered(tenantId);
    } catch (err) {
      // Webhook é conveniência: sem ele o operador ainda sincroniza na mão.
      logger.warn({ err, tenantId }, "não foi possível registrar o webhook na ZapSign");
    }
  }

  return getSettings(tenantId);
}

export async function disconnect(tenantId: string): Promise<void> {
  const removed = await repo.clearCredentials(tenantId);
  if (!removed) throw AppError.notFound("Integração de assinatura não configurada");
}

/** Credenciais decifradas do tenant. Erra cedo se ninguém conectou a conta. */
async function credentials(tenantId: string): Promise<SignatureCredentials> {
  const row = await repo.findSettings(tenantId);
  if (!row?.apiTokenEnc || !row.webhookSecret) {
    throw new AppError(
      "ERR_ASSINATURA_001",
      422,
      "Assinatura eletrônica não configurada. Conecte a conta ZapSign em Configurações.",
    );
  }

  // O token guardado pode ser ilegível: APP_ENCRYPTION_KEY trocada, valor
  // corrompido ou gravado por outro ambiente. Sem este guard o erro do node
  // sobe cru e vira "Erro interno do servidor", sem dizer o que fazer.
  let token: string;
  try {
    token = decrypt(row.apiTokenEnc);
  } catch (err) {
    logger.error({ err, tenantId }, "credencial de assinatura ilegível");
    throw new AppError(
      "ERR_ASSINATURA_001",
      422,
      "Não foi possível ler as credenciais da ZapSign (chave de criptografia diferente da usada ao salvar). Reconecte a conta em Configurações.",
    );
  }

  return {
    token,
    sandbox: row.sandbox,
    authMode: row.authMode,
    webhookSecret: row.webhookSecret,
  };
}

/* --------------------------------------------------- Envio à assinatura */

/** O modo de autenticação define qual contato é obrigatório em cada parte. */
function requiredContact(authMode: string): "email" | "phone" | "none" {
  if (authMode.includes("tokenEmail")) return "email";
  if (authMode.includes("tokenSms") || authMode.includes("tokenWhatsApp")) return "phone";
  return "none";
}

/** "11990001111" → { country: "55", number: "11990001111" } */
function splitPhone(raw: string | null): { country: string; number: string } | null {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? { country: "55", number: digits } : null;
}

/**
 * Envia o contrato para assinatura: gera o PDF vigente, cria o documento na
 * ZapSign e move o contrato para EM_ASSINATURA.
 */
export async function sendToSign(
  tenantId: string,
  contractId: string,
): Promise<SignatureEnvelope> {
  const creds = await credentials(tenantId);
  // Devolve o contrato já com o proprietário do imóvel vinculado como locador
  // (idempotente). Cobre contratos criados antes desse vínculo automático.
  const contract = await contractService.linkOwnersAsLocador(tenantId, contractId);

  if (contract.status !== "RASCUNHO" && contract.status !== "EM_ASSINATURA") {
    throw AppError.badRequest(
      `Contrato em ${contract.status} não pode ser enviado para assinatura.`,
    );
  }

  // RN-06 / AC-02 (contratos_08): locação sem garantia não vai a assinatura.
  if (!contract.guaranteeKind) {
    throw new AppError(
      "ERR_CONTRATO_002",
      422,
      "Garantia obrigatória para locação. Defina a garantia antes de enviar para assinatura.",
    );
  }

  // Mensagens separadas: cada caso tem uma ação diferente para o usuário.
  const locadores = contract.parties.filter((p) => p.role === "LOCADOR");
  if (locadores.length === 0) {
    throw new AppError(
      "ERR_ASSINATURA_003",
      422,
      contract.propertyId
        ? "O imóvel deste contrato não tem proprietário cadastrado. Cadastre o dono na ficha do imóvel (aba Donos) para que ele assine como locador."
        : "Selecione o imóvel do contrato — o proprietário dele entra como locador.",
    );
  }

  const locatarios = contract.parties.filter((p) => p.role === "LOCATARIO");
  if (locatarios.length === 0) {
    throw new AppError(
      "ERR_ASSINATURA_003",
      422,
      "Vincule ao menos um locatário ao contrato (aba Locatários).",
    );
  }

  // Monta os signatários com os dados de contato do cadastro de pessoas.
  const contact = requiredContact(creds.authMode);
  const signers: zapsign.CreateDocInput["signers"] = [];
  const parties: { partyId: string; role: string }[] = [];
  const missing: string[] = [];

  for (const party of contract.parties) {
    const person = await personService.getById(tenantId, party.personId).catch(() => null);
    const phone = splitPhone(person?.mobile ?? person?.phone ?? null);
    if (contact === "email" && !person?.email) {
      missing.push(`${party.personName} (e-mail)`);
      continue;
    }
    if (contact === "phone" && !phone) {
      missing.push(`${party.personName} (celular)`);
      continue;
    }
    signers.push({
      name: party.personName,
      email: person?.email ?? undefined,
      phoneCountry: phone?.country,
      phoneNumber: phone?.number,
      cpf: person?.cpfCnpj?.replace(/\D/g, "").length === 11 ? person.cpfCnpj : undefined,
      authMode: creds.authMode,
    });
    parties.push({ partyId: party.id, role: party.role });
  }

  if (missing.length > 0) {
    throw new AppError(
      "ERR_ASSINATURA_002",
      422,
      `Cadastro incompleto para o modo de assinatura escolhido: ${missing.join(", ")}.`,
      { missing },
    );
  }

  // Gera a versão que será assinada. O PDF vai em base64: a URL presignada do
  // nosso storage aponta para a rede interna, inalcançável pela ZapSign.
  const generated = await contractService.generateAndStore(tenantId, contractId);

  const doc = await zapsign.createDoc(creds, {
    name: `Contrato ${contract.code ?? ""} — ${contract.propertyId ? "Locação" : "Offices AI"}`.trim(),
    base64Pdf: generated.pdf.toString("base64"),
    externalId: contractId,
    signers,
  });

  const envelope = await repo.insertEnvelope(tenantId, {
    contractId,
    version: generated.version,
    providerDocToken: doc.token,
    authMode: creds.authMode,
    sandbox: creds.sandbox,
    snapshot: doc,
    // A ZapSign devolve os signatários na MESMA ordem em que foram enviados.
    signers: doc.signers.map((s, i) => ({
      partyId: parties[i]?.partyId ?? null,
      providerSignerToken: s.token,
      role: parties[i]?.role ?? null,
      name: s.name,
      email: s.email ?? null,
      signUrl: s.sign_url ?? null,
      status: mapSignerStatus(s.status),
    })),
  });

  if (contract.status !== "EM_ASSINATURA") {
    await contractService.update(tenantId, contractId, { status: "EM_ASSINATURA" });
  }

  await publish({
    type: "contract.sent_to_sign",
    tenantId,
    eventId: randomUUID(),
    occurredAt: new Date().toISOString(),
    payload: { contractId, docToken: doc.token, signers: signers.length },
  });

  return envelope;
}

/* ------------------------------------------- Sincronização / webhook */

function mapDocStatus(status: string): string {
  switch (status) {
    case "signed":
      return "ASSINADO";
    case "refused":
      return "RECUSADO";
    case "canceled":
    case "deleted":
      return "CANCELADO";
    case "expired":
      return "EXPIRADO";
    default:
      return "PENDENTE";
  }
}

function mapSignerStatus(status: string): string {
  if (status === "signed") return "ASSINADO";
  if (status === "refused") return "RECUSADO";
  return "PENDENTE";
}

export async function getEnvelope(
  tenantId: string,
  contractId: string,
): Promise<SignatureEnvelope | null> {
  await contractService.getById(tenantId, contractId); // 404 se o contrato não existe
  return repo.findLatestEnvelope(tenantId, contractId);
}

/**
 * Traz o estado do provedor e o aplica — ponto ÚNICO usado tanto pelo webhook
 * quanto pelo botão "Sincronizar". Sempre consulta a ZapSign em vez de confiar
 * no corpo do webhook: o payload pode chegar fora de ordem e o `signed_file`
 * dele expira em 60 minutos.
 *
 * Idempotente: a conclusão (download do PDF + versão + evento) só acontece na
 * transição para ASSINADO, garantida pelo `justCompleted` do repository.
 */
export async function applyProviderState(
  tenantId: string,
  envelope: SignatureEnvelope,
): Promise<SignatureEnvelope> {
  const creds = await credentials(tenantId);
  const doc: ZapSignDoc = await zapsign.getDoc(creds, envelope.providerDocToken);
  const status = mapDocStatus(doc.status);

  // Baixa o PDF assinado antes de fechar o envelope: se o download falhar,
  // nada é marcado como concluído e a próxima sincronização tenta de novo.
  let signedStorageKey: string | null = null;
  if (status === "ASSINADO" && doc.signed_file && !envelope.hasSignedPdf) {
    const pdf = await zapsign.downloadSignedFile(doc.signed_file);
    signedStorageKey = `${tenantId}/contracts/${envelope.contractId}/signed/${randomUUID()}.pdf`;
    await putObject(signedStorageKey, pdf, "application/pdf");
  }

  const { justCompleted, envelope: updated } = await repo.applyEnvelopeState(tenantId, {
    envelopeId: envelope.id,
    status,
    snapshot: doc,
    signedStorageKey,
    signers: doc.signers.map((s) => ({
      providerSignerToken: s.token,
      status: mapSignerStatus(s.status),
      signedAt: s.signed_at ?? null,
    })),
  });

  if (justCompleted) {
    // Versão imutável do documento assinado (a trilha de auditoria da ZapSign
    // vem embutida no próprio PDF) + contrato vigente.
    if (signedStorageKey) {
      await contractService.registerSignedVersion(tenantId, envelope.contractId, signedStorageKey, {
        source: "zapsign",
        docToken: envelope.providerDocToken,
        sandbox: envelope.sandbox,
        authMode: envelope.authMode,
        signers: doc.signers.map((s) => ({
          name: s.name,
          email: s.email,
          status: s.status,
          signedAt: s.signed_at,
        })),
        completedAt: new Date().toISOString(),
      });
    }
    await publish({
      type: "contract.signed",
      tenantId,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
      payload: { contractId: envelope.contractId, docToken: envelope.providerDocToken },
    });
  }

  // A vigência é reafirmada a CADA sincronização com o envelope assinado, não
  // só na transição: se algo devolveu o contrato para EM_ASSINATURA depois da
  // conclusão, o botão "Sincronizar" conserta. Preso ao `justCompleted`, o
  // estado divergente seria irrecuperável pela tela.
  // Não ressuscita contrato encerrado/distratado — só sai de rascunho/assinatura.
  if (status === "ASSINADO") {
    const contract = await contractService.getById(tenantId, envelope.contractId);
    if (contract.status === "RASCUNHO" || contract.status === "EM_ASSINATURA") {
      await contractService.update(tenantId, envelope.contractId, { status: "VIGENTE" });
    }
  }

  return updated;
}

/** "Sincronizar status" — o caminho manual, indispensável em desenvolvimento. */
export async function syncFromProvider(
  tenantId: string,
  contractId: string,
): Promise<SignatureEnvelope> {
  const envelope = await repo.findLatestEnvelope(tenantId, contractId);
  if (!envelope) {
    throw new AppError(
      "ERR_ASSINATURA_004",
      404,
      "Este contrato ainda não foi enviado para assinatura.",
    );
  }
  return applyProviderState(tenantId, envelope);
}

/**
 * Trata um callback da ZapSign. Retorna `false` quando o segredo não confere —
 * a rota traduz isso em 401 sem revelar se o tenant existe.
 */
export async function handleWebhook(
  tenantId: string,
  secret: string | undefined,
  docToken: string,
): Promise<boolean> {
  const row = await repo.findSettings(tenantId);
  if (!row?.webhookSecret || !secret || !secretEquals(secret, row.webhookSecret)) {
    return false;
  }

  const envelope = await repo.findEnvelopeByDocToken(tenantId, docToken);
  if (!envelope) {
    // Documento de outra origem na mesma conta ZapSign: ignorar é o correto.
    logger.info({ tenantId, docToken }, "webhook de documento desconhecido — ignorado");
    return true;
  }

  await applyProviderState(tenantId, envelope);
  return true;
}
