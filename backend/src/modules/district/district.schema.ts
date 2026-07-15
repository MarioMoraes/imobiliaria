import { z } from "zod";

/**
 * Bairro — lookup editável por tenant (ex.: "Centro", "Jardins"). Espelha a
 * tela legada "Cadastro de Bairros": apenas o nome do bairro, reaproveitado nos
 * endereços de imóveis/pessoas/condomínios.
 */

export const createDistrictSchema = z.object({
  name: z.string().min(2).max(120),
});

export type CreateDistrictInput = z.infer<typeof createDistrictSchema>;

export interface District {
  id: string;
  tenantId: string;
  name: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}
