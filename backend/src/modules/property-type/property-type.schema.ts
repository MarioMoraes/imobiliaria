import { z } from "zod";

/**
 * Tipo de Imóvel — lookup editável por tenant (Apartamento, Casa, Sala,
 * Terreno…). Distinto da FINALIDADE (venda/locação) do imóvel.
 * Espelha a tela legada "Cadastro de Tipo de Imóveis".
 */

export const createPropertyTypeSchema = z.object({
  name: z.string().min(2).max(80),
});

export type CreatePropertyTypeInput = z.infer<typeof createPropertyTypeSchema>;

export interface PropertyType {
  id: string;
  tenantId: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
