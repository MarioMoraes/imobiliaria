import { z } from "zod";

export const propertyKind = z.enum([
  "sale",
  "rent",
  "season",
  "commercial",
  "rural",
  "land",
]);

export const propertyStatus = z.enum([
  "available",
  "reserved",
  "rented",
  "sold",
  "inactive",
]);

/** Finalidade do negócio — distinta do TIPO do imóvel (ver property_types). */
export const propertyPurpose = z.enum(["sale", "rent", "season"]);

/** Payload de criação de imóvel. */
export const createPropertySchema = z.object({
  title: z.string().min(3).max(200),
  kind: propertyKind.default("sale"),
  purpose: propertyPurpose.default("sale"),
  propertyTypeId: z.string().uuid().optional(),
  isDevelopment: z.boolean().default(false),
  status: propertyStatus.default("available"),
  priceCents: z.number().int().nonnegative().optional(),
  city: z.string().max(120).optional(),
  state: z.string().length(2).optional(),
  bedrooms: z.number().int().nonnegative().optional(),
});

export type CreatePropertyInput = z.infer<typeof createPropertySchema>;

export interface Property {
  id: string;
  tenantId: string;
  title: string;
  kind: string;
  purpose: string;
  propertyTypeId: string | null;
  isDevelopment: boolean;
  status: string;
  priceCents: number | null;
  city: string | null;
  state: string | null;
  bedrooms: number | null;
  createdAt: string;
  updatedAt: string;
}
