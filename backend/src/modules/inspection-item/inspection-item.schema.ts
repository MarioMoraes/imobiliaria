import { z } from "zod";

/**
 * Item de Vistoria — lookup editável por tenant (ex.: "Pintura externa",
 * "Instalações elétricas"). Espelha a tela legada "Cadastro de Itens de
 * Vistoria": itens conferidos na vistoria de entrada/saída do imóvel.
 */

export const createInspectionItemSchema = z.object({
  description: z.string().min(2).max(200),
});

export type CreateInspectionItemInput = z.infer<typeof createInspectionItemSchema>;

export interface InspectionItem {
  id: string;
  tenantId: string;
  description: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
