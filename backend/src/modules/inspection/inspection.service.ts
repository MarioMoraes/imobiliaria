import { AppError } from "../../shared/errors.js";
import { htmlToPdf } from "../../shared/pdf.js";
import * as propertyService from "../property/property.service.js";
import * as tenantService from "../tenant/tenant.service.js";
import * as repo from "./inspection.repository.js";
import { toInspectionReportHtml } from "./report.js";
import type { Property } from "../property/property.schema.js";
import type { InspectionView, SaveInspectionInput } from "./inspection.schema.js";

/**
 * Fronteira do módulo Vistoria. Depende de `property` (e de `tenant`, para o
 * cabeçalho do PDF) pelo **service** do outro módulo, nunca pelo repository —
 * é o que mantém o acoplamento no contrato público (ver modules/README.md).
 */

/** "Rua das Flores, 120 — Centro, Curitiba/PR" a partir dos campos soltos. */
export function formatAddress(property: Property): string {
  const rua = [property.streetType, property.address].filter(Boolean).join(" ");
  const linha = [rua, property.number].filter(Boolean).join(", ");
  const cidade = [property.city, property.state].filter(Boolean).join("/");
  const bairro = [property.district, cidade].filter(Boolean).join(", ");
  return [linha, bairro].filter(Boolean).join(" — ") || "(endereço não informado)";
}

/**
 * Vistoria do imóvel. Cria na primeira abertura e materializa as linhas do
 * catálogo — por isso um GET escreve: sem isso a tela abriria vazia e obrigaria
 * o usuário a um passo manual que não existe na tela legada.
 */
export async function getByProperty(
  tenantId: string,
  propertyId: string,
): Promise<InspectionView> {
  // Dá o 404 claro quando o imóvel não é do tenant (ou não existe).
  const property = await propertyService.getById(tenantId, propertyId);
  const { inspection, entries } = await repo.getOrCreateByProperty(tenantId, propertyId);

  return {
    inspection,
    entries,
    property: {
      id: property.id,
      code: property.code,
      title: property.title,
      address: formatAddress(property),
    },
  };
}

export async function save(
  tenantId: string,
  propertyId: string,
  input: SaveInspectionInput,
): Promise<InspectionView> {
  const inspection = await repo.findByProperty(tenantId, propertyId);
  if (!inspection) {
    throw AppError.notFound("Vistoria não encontrada para este imóvel");
  }

  await repo.saveEntries(tenantId, inspection.id, input.entries, input.notes);
  return getByProperty(tenantId, propertyId);
}

/**
 * Documento da vistoria em PDF — o que vai impresso para o vistoriador assinar.
 * Devolve o nome do arquivo junto para a rota não precisar reconsultar o imóvel.
 */
export async function report(
  tenantId: string,
  propertyId: string,
): Promise<{ pdf: Buffer; fileName: string }> {
  const [view, tenant] = await Promise.all([
    getByProperty(tenantId, propertyId),
    tenantService.getById(tenantId),
  ]);

  const html = toInspectionReportHtml({
    tenantName: tenant.name,
    inspection: view.inspection,
    entries: view.entries,
    property: view.property,
    generatedAt: new Date(),
  });

  const identificador = view.property.code ?? view.inspection.seq ?? "imovel";
  return { pdf: await htmlToPdf(html), fileName: `vistoria-${identificador}.pdf` };
}
