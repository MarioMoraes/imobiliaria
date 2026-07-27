import { createHash } from "node:crypto";
import type { Property } from "../../property/property.schema.js";

/**
 * Converte um imóvel em texto corrido para o índice semântico.
 *
 * `properties` não tem campo de descrição longa — o cadastro é todo estruturado.
 * Embeddar o JSON cru funcionaria mal: um vetor de `{"bedrooms":2,"district":
 * "Centro"}` não se aproxima de "apartamento de dois quartos no Centro", que é
 * como a pergunta chega. Então montamos a prosa em PT-BR a partir dos campos,
 * usando as MESMAS palavras que um corretor usaria.
 *
 * O que fica de fora é tão importante quanto o que entra: nada de dado de dono,
 * inquilino ou contrato. O chunk vai literal para o prompt do modelo, e quem
 * pergunta pode não ter permissão para ver essas pessoas — a checagem de RBAC
 * acontece nas ferramentas, não aqui.
 */

const KIND_LABEL: Record<string, string> = {
  sale: "venda",
  rent: "locação",
  season: "temporada",
  commercial: "comercial",
  rural: "rural",
  land: "terreno",
};

const STATUS_LABEL: Record<string, string> = {
  available: "disponível",
  reserved: "reservado",
  rented: "alugado",
  sold: "vendido",
  inactive: "inativo",
};

const PURPOSE_LABEL: Record<string, string> = {
  sale: "para venda",
  rent: "para locação",
  season: "para temporada",
};

function money(cents: number | null): string | null {
  if (cents === null) return null;
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/**
 * `photoCount` é o número REAL de linhas em `property_photos`, e não o campo
 * `hasPhotos` do cadastro — aquele é uma marcação que alguém preenche no
 * formulário e envelhece sozinha. Entra no documento porque "tem foto?" é
 * pergunta de primeira linha, e sem isso o agente respondia que não havia
 * fotos: o documento não falava delas, e o prompt manda não inventar.
 *
 * Como o número entra no texto indexado, ele entra no `contentHash` — por isso
 * `property.photo_added` e `property.photo_removed` disparam reindexação.
 */
export function renderPropertyDocument(property: Property, photoCount = 0): string {
  const parts: string[] = [];

  const kind = KIND_LABEL[property.kind] ?? property.kind;
  const purpose = PURPOSE_LABEL[property.purpose] ?? property.purpose;
  const status = STATUS_LABEL[property.status] ?? property.status;

  parts.push(
    `Imóvel ${property.code ?? "sem código"}: ${property.title}. Tipo ${kind}, ${purpose}. Situação: ${status}.`,
  );

  const local = [
    property.address && `${property.streetType ?? ""} ${property.address}`.trim(),
    property.number && `nº ${property.number}`,
    property.district && `bairro ${property.district}`,
    property.city && property.state ? `${property.city}/${property.state}` : property.city,
  ].filter(Boolean);
  if (local.length > 0) parts.push(`Localização: ${local.join(", ")}.`);

  const caracteristicas = [
    property.bedrooms !== null && `${property.bedrooms} quarto(s)`,
    property.builtArea !== null && `${property.builtArea} m² de área construída`,
    property.landArea !== null && `${property.landArea} m² de terreno`,
    property.isCommercial && "uso comercial",
    property.dependencies,
  ].filter(Boolean);
  if (caracteristicas.length > 0) parts.push(`Características: ${caracteristicas.join(", ")}.`);

  const valores = [
    money(property.priceCents) && `valor ${money(property.priceCents)}`,
    money(property.condoFeeCents) && `condomínio ${money(property.condoFeeCents)}`,
    money(property.iptuCents) && `IPTU ${money(property.iptuCents)}`,
  ].filter(Boolean);
  if (valores.length > 0) parts.push(`Valores: ${valores.join(", ")}.`);

  // Frases inteiras, e não flags, porque a pergunta chega assim ("aceita
  // cachorro?"). "aceita animais" casa; `allowPets: true` não casa com nada.
  const regras = [
    property.allowPets ? "aceita animais de estimação" : "não aceita animais de estimação",
    property.allowStudents ? "aceita estudantes" : "não aceita estudantes",
  ];
  parts.push(`Regras: ${regras.join(", ")}.`);

  // Frase inteira pelo mesmo motivo das regras: a pergunta chega como "tem foto
  // desse apartamento?", e é com essas palavras que o trecho precisa casar.
  parts.push(
    photoCount > 0
      ? `Fotos: ${photoCount} foto(s) cadastrada(s), disponíveis para mostrar.`
      : "Fotos: nenhuma foto cadastrada.",
  );

  if (property.notes) parts.push(`Observações: ${property.notes}`);

  return parts.join(" ");
}

/**
 * Hash do texto indexado. É o que permite pular o reembedding (chamada paga)
 * quando o evento chega mas o conteúdo relevante não mudou — salvar o imóvel
 * para corrigir um campo que não entra no documento não deve custar nada.
 */
export function contentHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
