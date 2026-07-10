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

/** Payload de criação de imóvel. */
export const createPropertySchema = z.object({
  title: z.string().min(3).max(200),
  kind: propertyKind.default("sale"),
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
  status: string;
  priceCents: number | null;
  city: string | null;
  state: string | null;
  bedrooms: number | null;
  createdAt: string;
  updatedAt: string;
}
