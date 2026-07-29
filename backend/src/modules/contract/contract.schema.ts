import { z } from "zod";

/** Ciclo de vida do contrato (contratos_08 §6). */
export const contractStatus = z.enum([
  "RASCUNHO",
  "EM_ASSINATURA",
  "VIGENTE",
  "RENOVADO",
  "ENCERRADO",
  "DISTRATADO",
]);

/** Índice de reajuste — IPCA é o padrão (decisão de negócio). */
export const readjustIndex = z.enum(["IPCA", "IGP_M", "INPC", "FIXO"]);

/** Modalidade da garantia locatícia. */
export const guaranteeKind = z.enum(["FIADOR", "CAUCAO", "SEGURO_FIANCA", "TITULO_CAP"]);

/** Quem arca com o IPTU. */
export const iptuChargedTo = z.enum(["LOCATARIO", "LOCADOR"]);

/** Papel de uma parte no contrato. */
export const partyRole = z.enum(["LOCADOR", "LOCATARIO", "FIADOR"]);

const percent = z.number().min(0).max(100);
/**
 * Valor monetário em centavos (não-negativo).
 *
 * O teto não é burocracia: a coluna é BIGINT, então um valor como 9e18 era
 * aceito e gravado, e a leitura faz `Number(...)` — acima de 2^53 a precisão se
 * perde em silêncio e os totais do dashboard e do fluxo de caixa passam a
 * mentir. R$ 1 bilhão em centavos é folgado para imóvel, aluguel e despesa, e
 * mantém tudo dentro do inteiro seguro do JavaScript.
 */
const cents = z.number().int().nonnegative().max(100_000_000_000);
const shortText = z.string().max(200);
const longText = z.string().max(8000);
/** Dia do mês (1–31). */
const dayOfMonth = z.number().int().min(1).max(31);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Data inválida (YYYY-MM-DD)");

/**
 * Núcleo de campos editáveis do contrato (espelha a tela legada). `code` é
 * atribuído pelo backend (sequencial por tenant) e é somente leitura.
 */
const contractFields = {
  propertyId: z.string().uuid(),
  templateId: z.string().uuid(),
  status: contractStatus,

  startsAt: isoDate,
  endsAt: isoDate,
  // Alimenta `buildRentSchedule`: sem teto, `termMonths` grande monta
  // milhões de parcelas em memória e num INSERT só — DoS com um request.
  // 600 meses = 50 anos, acima de qualquer locação real.
  termMonths: z.number().int().nonnegative().max(600),
  readjustIndex: readjustIndex,
  readjustPeriodMonths: z.number().int().nonnegative().max(600),
  lastReadjustAt: isoDate,
  ownerPayDay: dayOfMonth,
  tenantPayDay: dayOfMonth,
  terminatedAt: isoDate,

  rentalValueCents: cents,
  interestPercent: percent,
  penaltyPercent: percent,
  adminFeePercent: percent,
  isAdministration: z.boolean(),
  incomeTaxDeclaration: z.boolean(),
  iptuChargedTo: iptuChargedTo,
  commissionType: shortText,
  hasCommission: z.boolean(),

  guaranteeKind: guaranteeKind,
  hasInsurance: z.boolean(),
  insuranceDescription: shortText,
  insuranceValueCents: cents,

  isSettled: z.boolean(),
  hasEvictionOrder: z.boolean(),
  hasJudicialExecution: z.boolean(),
  processNumber: shortText,
  court: shortText,

  specialClauses: longText,
  guarantorPropertyInfo: longText,
} as const;

/** Payload de criação — tudo opcional (contrato nasce RASCUNHO). */
export const createContractSchema = z.object({
  propertyId: contractFields.propertyId.optional(),
  templateId: contractFields.templateId.optional(),
  status: contractStatus.default("RASCUNHO"),

  startsAt: isoDate.optional(),
  endsAt: isoDate.optional(),
  termMonths: contractFields.termMonths.optional(),
  readjustIndex: readjustIndex.default("IPCA"),
  readjustPeriodMonths: contractFields.readjustPeriodMonths.optional(),
  lastReadjustAt: isoDate.optional(),
  ownerPayDay: dayOfMonth.optional(),
  tenantPayDay: dayOfMonth.optional(),
  terminatedAt: isoDate.optional(),

  rentalValueCents: cents.optional(),
  interestPercent: percent.optional(),
  penaltyPercent: percent.optional(),
  adminFeePercent: percent.optional(),
  isAdministration: z.boolean().default(false),
  incomeTaxDeclaration: z.boolean().default(false),
  iptuChargedTo: iptuChargedTo.optional(),
  commissionType: shortText.optional(),
  hasCommission: z.boolean().default(false),

  guaranteeKind: guaranteeKind.optional(),
  hasInsurance: z.boolean().default(false),
  insuranceDescription: shortText.optional(),
  insuranceValueCents: cents.optional(),

  isSettled: z.boolean().default(false),
  hasEvictionOrder: z.boolean().default(false),
  hasJudicialExecution: z.boolean().default(false),
  processNumber: shortText.optional(),
  court: shortText.optional(),

  specialClauses: longText.optional(),
  guarantorPropertyInfo: longText.optional(),
});
export type CreateContractInput = z.infer<typeof createContractSchema>;

/** Atualização parcial. Campos de texto/FK aceitam `null` para limpar. */
export const updateContractSchema = z
  .object({
    propertyId: contractFields.propertyId.nullable().optional(),
    templateId: contractFields.templateId.nullable().optional(),
    status: contractStatus.optional(),

    startsAt: isoDate.nullable().optional(),
    endsAt: isoDate.nullable().optional(),
    termMonths: contractFields.termMonths.nullable().optional(),
    readjustIndex: readjustIndex.optional(),
    readjustPeriodMonths: contractFields.readjustPeriodMonths.nullable().optional(),
    lastReadjustAt: isoDate.nullable().optional(),
    ownerPayDay: dayOfMonth.nullable().optional(),
    tenantPayDay: dayOfMonth.nullable().optional(),
    terminatedAt: isoDate.nullable().optional(),

    rentalValueCents: cents.nullable().optional(),
    interestPercent: percent.nullable().optional(),
    penaltyPercent: percent.nullable().optional(),
    adminFeePercent: percent.nullable().optional(),
    isAdministration: z.boolean().optional(),
    incomeTaxDeclaration: z.boolean().optional(),
    iptuChargedTo: iptuChargedTo.nullable().optional(),
    commissionType: shortText.nullable().optional(),
    hasCommission: z.boolean().optional(),

    guaranteeKind: guaranteeKind.nullable().optional(),
    hasInsurance: z.boolean().optional(),
    insuranceDescription: shortText.nullable().optional(),
    insuranceValueCents: cents.nullable().optional(),

    isSettled: z.boolean().optional(),
    hasEvictionOrder: z.boolean().optional(),
    hasJudicialExecution: z.boolean().optional(),
    processNumber: shortText.nullable().optional(),
    court: shortText.nullable().optional(),

    specialClauses: longText.nullable().optional(),
    guarantorPropertyInfo: longText.nullable().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });
export type UpdateContractInput = z.infer<typeof updateContractSchema>;

/** Vínculo de uma parte (pessoa) ao contrato. */
export const addPartySchema = z.object({
  role: partyRole,
  personId: z.string().uuid(),
});
export type AddPartyInput = z.infer<typeof addPartySchema>;

export interface ContractParty {
  id: string;
  contractId: string;
  role: string;
  personId: string;
  personName: string;
  signedAt: string | null;
}

/**
 * Template de contrato — **texto puro** com variáveis `{{ chave }}` (merge
 * fields); a formatação do documento é aplicada na geração (`document.ts`).
 * Modelos legados em HTML completo continuam aceitos.
 *
 * A lista `variables` NÃO vem do cliente: é derivada do conteúdo no service,
 * para não dessincronizar do documento.
 */
export const createContractTemplateSchema = z.object({
  name: z.string().min(2).max(120),
  content: z.string().min(10).max(200_000),
  active: z.boolean().default(true),
});
export type CreateContractTemplateInput = z.infer<typeof createContractTemplateSchema>;

export const updateContractTemplateSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    content: z.string().min(10).max(200_000).optional(),
    active: z.boolean().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "Nada para atualizar" });
export type UpdateContractTemplateInput = z.infer<typeof updateContractTemplateSchema>;

/**
 * Testemunhas do contrato de administração — informadas na emissão do PDF, não
 * cadastradas: quem assina como testemunha é quem está na sala naquele dia.
 */
export const administrationWitnessesSchema = z.object({
  testemunha1: z.string().trim().min(3).max(120),
  testemunha2: z.string().trim().min(3).max(120),
});
export type AdministrationWitnessesInput = z.infer<typeof administrationWitnessesSchema>;

/** Pré-visualização de um conteúdo ainda não salvo. */
export const previewTemplateSchema = z.object({
  content: z.string().max(200_000),
});

export interface ContractTemplate {
  id: string;
  name: string;
  /** Corpo do modelo (texto puro, ou HTML nos modelos legados). */
  content: string;
  variables: string[];
  active: boolean;
}

export interface Contract {
  id: string;
  tenantId: string;
  code: number | null;
  propertyId: string | null;
  templateId: string | null;
  status: string;

  startsAt: string | null;
  endsAt: string | null;
  termMonths: number | null;
  readjustIndex: string;
  readjustPeriodMonths: number | null;
  lastReadjustAt: string | null;
  ownerPayDay: number | null;
  tenantPayDay: number | null;
  terminatedAt: string | null;

  rentalValueCents: number | null;
  interestPercent: number | null;
  penaltyPercent: number | null;
  adminFeePercent: number | null;
  isAdministration: boolean;
  incomeTaxDeclaration: boolean;
  iptuChargedTo: string | null;
  commissionType: string | null;
  hasCommission: boolean;

  guaranteeKind: string | null;
  hasInsurance: boolean;
  insuranceDescription: string | null;
  insuranceValueCents: number | null;

  isSettled: boolean;
  hasEvictionOrder: boolean;
  hasJudicialExecution: boolean;
  processNumber: string | null;
  court: string | null;

  specialClauses: string | null;
  guarantorPropertyInfo: string | null;

  parties: ContractParty[];
  latestVersion: number | null;
  createdAt: string;
  updatedAt: string;
}
