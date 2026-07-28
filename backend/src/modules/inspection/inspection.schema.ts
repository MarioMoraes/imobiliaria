import { z } from "zod";

/**
 * Vistoria do imóvel — espelha a tela legada "Cadastro de Vistoria": para cada
 * item do catálogo (`inspection-item`), o vistoriador informa a quantidade, o
 * estado (Bom/Médio/Ruim) e uma observação.
 *
 * É **uma vistoria por imóvel** (no legado, "Número" e "Imóvel" coincidem). As
 * linhas não são criadas pelo usuário: nascem do catálogo do tenant na primeira
 * abertura. Por isso o input de escrita só carrega o que é preenchível.
 */

/** Bom/Médio/Ruim são 3 caixas na tela, mas mutuamente exclusivas — uma coluna. */
export const inspectionConditionSchema = z.enum(["BOM", "MEDIO", "RUIM"]);

export type InspectionCondition = z.infer<typeof inspectionConditionSchema>;

const entryInputSchema = z.object({
  id: z.string().uuid(),
  quantity: z.number().int().min(0).max(9999),
  condition: inspectionConditionSchema.nullable(),
  notes: z.string().max(500).nullable(),
});

export const saveInspectionSchema = z.object({
  notes: z.string().max(2000).nullable().optional(),
  entries: z.array(entryInputSchema).max(500),
});

export type SaveInspectionInput = z.infer<typeof saveInspectionSchema>;
export type SaveInspectionEntryInput = z.infer<typeof entryInputSchema>;

export interface InspectionEntry {
  id: string;
  inspectionId: string;
  inspectionItemId: string | null;
  description: string;
  position: number;
  quantity: number;
  condition: InspectionCondition | null;
  notes: string | null;
}

export interface Inspection {
  id: string;
  tenantId: string;
  propertyId: string;
  seq: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** O que a tela precisa numa chamada só: cabeçalho, linhas e dados do imóvel. */
export interface InspectionView {
  inspection: Inspection;
  entries: InspectionEntry[];
  property: {
    id: string;
    code: number | null;
    title: string;
    address: string;
  };
}
