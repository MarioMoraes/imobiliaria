import { z } from "zod";

/**
 * Cláusula contratual — lookup editável por tenant (ex.: "Cláusula de 1 ano").
 * Espelha a tela legada "Cadastro de Cláusulas": Nome + Descrição (texto longo)
 * reaproveitados na montagem de contratos.
 */

export const createClauseSchema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().min(2).max(4000),
});

export type CreateClauseInput = z.infer<typeof createClauseSchema>;

export interface Clause {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
