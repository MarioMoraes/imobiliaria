import type { Property } from "./property.schema.js";

/**
 * HTML do Relatório de Imóveis a Alugar — função **pura** (sem banco, sem
 * tenant), para o layout poder ser testado sozinho. O `htmlToPdf`
 * (Gotenberg/Chromium) o converte; por isso é CSS de impressão, não a folha de
 * estilo do app.
 *
 * É a relação que se entrega a quem procura imóvel: código, endereço,
 * dependências e o valor do aluguel, **quebrada por bairro** — quem atende o
 * balcão procura pelo bairro primeiro, não pelo código.
 */

/** "1.500,00" → sempre em reais; o preço do imóvel é guardado em centavos. */
function brl(cents: number | null): string {
  if (cents === null) return "a combinar";
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

/** "2026-08-04" → "04/08/2026". Sem passar por `Date` (evita fuso). */
function dia(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Escapa o que vem do cadastro. Endereço e dependências são texto livre — sem
 * isso, um `&` ou `<` digitado no imóvel quebraria o documento.
 */
function esc(value: string | null | undefined): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * "Rua das Flores, 120". Sem bairro/cidade: o bairro já é o título do grupo e
 * repeti-lo em toda linha só rouba largura da coluna de dependências.
 */
function formatStreet(p: Property): string {
  const rua = [p.streetType, p.address].filter(Boolean).join(" ");
  return [rua, p.number].filter(Boolean).join(", ") || "(endereço não informado)";
}

/** Bairro em branco não some do relatório: vira um grupo próprio, no fim. */
const SEM_BAIRRO = "Sem bairro informado";

function districtOf(p: Property): string {
  return p.district?.trim() || SEM_BAIRRO;
}

export interface RentalReportGroup {
  district: string;
  properties: Property[];
}

/**
 * Agrupa por bairro em ordem alfabética (pt-BR, ignorando acento e caixa), com
 * o grupo "sem bairro" sempre por último, e ordena cada grupo pelo código.
 */
export function groupByDistrict(properties: Property[]): RentalReportGroup[] {
  const byDistrict = new Map<string, Property[]>();
  for (const p of properties) {
    const key = districtOf(p);
    const bucket = byDistrict.get(key);
    if (bucket) bucket.push(p);
    else byDistrict.set(key, [p]);
  }

  return [...byDistrict.entries()]
    .sort(([a], [b]) => {
      if (a === SEM_BAIRRO) return 1;
      if (b === SEM_BAIRRO) return -1;
      return a.localeCompare(b, "pt-BR", { sensitivity: "base" });
    })
    .map(([district, list]) => ({
      district,
      properties: [...list].sort((a, b) => (a.code ?? Infinity) - (b.code ?? Infinity)),
    }));
}

export interface RentalReportInput {
  tenantName: string;
  /** Imóveis de locação/temporada com situação disponível (ver `listForRentalReport`). */
  properties: Property[];
  /** Data de emissão (injetada para o teste ser determinístico). */
  generatedAt: Date;
}

export function toRentalReportHtml(input: RentalReportInput): string {
  const groups = groupByDistrict(input.properties);
  const total = input.properties.length;

  const imoveis = (n: number) => `${n} ${n === 1 ? "imóvel" : "imóveis"}`;

  const gruposHtml = groups.length
    ? groups
        .map(
          (g) => `
    <section>
      <h2>${esc(g.district)} <span class="conta">${imoveis(g.properties.length)}</span></h2>
      <table>
        <!-- Larguras fixas: sem elas o Chromium espalha as colunas pelo
             conteúdo e o valor alinhado à direita encosta na dependência. -->
        <colgroup>
          <col style="width:9%"><col style="width:40%">
          <col style="width:33%"><col style="width:18%">
        </colgroup>
        <thead>
          <tr>
            <th>Código</th><th>Endereço</th><th>Dependências</th>
            <th class="val">Aluguel</th>
          </tr>
        </thead>
        <tbody>
${g.properties
  .map(
    (p) => `          <tr>
            <td class="num">${p.code ?? "—"}</td>
            <td>${esc(formatStreet(p))}</td>
            <td>${esc(p.dependencies) || "—"}</td>
            <td class="val">${brl(p.priceCents)}</td>
          </tr>`,
  )
  .join("\n")}
        </tbody>
      </table>
    </section>`,
        )
        .join("")
    : `<p class="vazio">Nenhum imóvel disponível para locação no momento.</p>`;

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>Imóveis a Alugar — ${esc(input.tenantName)}</title>
<style>
  @page { size: A4; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
         font-size: 10px; color: #1e293b; margin: 0; }
  header { border-bottom: 2px solid #0f172a; padding-bottom: 8px; margin-bottom: 14px; }
  .marca { font-size: 15px; font-weight: 700; }
  h1 { font-size: 12px; font-weight: 600; margin: 2px 0 0; }
  .meta { color: #64748b; font-size: 9px; margin-top: 3px; }

  /* break-inside evita que o título do bairro fique órfão no pé da página. */
  section { margin-bottom: 16px; break-inside: avoid; }
  h2 { font-size: 10px; text-transform: uppercase; letter-spacing: .5px;
       color: #0f172a; margin: 0 0 5px; border-bottom: 1px solid #cbd5e1;
       padding-bottom: 3px; }
  h2 .conta { float: right; font-weight: 500; text-transform: none;
              letter-spacing: 0; color: #64748b; }

  table { width: 100%; border-collapse: collapse; }
  thead th { text-align: left; font-size: 8px; text-transform: uppercase;
             letter-spacing: .4px; color: #64748b; padding: 4px 6px; }
  td { padding: 4px 6px; border-bottom: 1px solid #f1f5f9; vertical-align: top; }
  .num { white-space: nowrap; }
  .val { text-align: right; white-space: nowrap; }
  .vazio { color: #64748b; padding: 20px 0; }
</style>
</head>
<body>
  <header>
    <div class="marca">${esc(input.tenantName)}</div>
    <h1>Imóveis a Alugar</h1>
    <div class="meta">
      ${imoveis(total)} em ${groups.length} ${groups.length === 1 ? "bairro" : "bairros"} ·
      emitido em ${dia(input.generatedAt.toISOString())}
    </div>
  </header>

  ${gruposHtml}
</body>
</html>`;
}
