import { z } from "zod";

/**
 * Evento financeiro — lookup editável por tenant (ex.: "ÁGUA", "CONDOMÍNIO",
 * "MULTA"). Espelha a tela legada "Cadastro de Eventos": cada evento define o
 * tipo (débito/crédito) e os encargos por atraso (juros, juros de execução
 * judicial e multa), além de indicar se incide a taxa de administração. Usado
 * na composição de débitos/créditos da cobrança (condomínio, aluguel).
 */

/** Débito (cobrança do sacado) ou Crédito (a favor do sacado). */
export const eventKind = z.enum(["DEBITO", "CREDITO"]);
export type EventKind = z.infer<typeof eventKind>;

/** Percentual 0–100 com até 3 casas (juros, multa). */
const percent = z.number().min(0).max(100);

export const createEventSchema = z.object({
  name: z.string().min(1).max(120),
  kind: eventKind.default("DEBITO"),
  interestPercent: percent.default(0),
  judicialInterestPercent: percent.default(0),
  penaltyPercent: percent.default(0),
  appliesAdminFee: z.boolean().default(false),
});
export type CreateEventInput = z.infer<typeof createEventSchema>;

export interface Event {
  id: string;
  tenantId: string;
  name: string;
  kind: EventKind;
  interestPercent: number;
  judicialInterestPercent: number;
  penaltyPercent: number;
  appliesAdminFee: boolean;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
