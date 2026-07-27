import { formatPrice } from "../lib/format";
import type { CashFlowPoint } from "../lib/api";

/**
 * Barras de recebido (caixa realizado) x previsto (o que vencia no mês), com a
 * série já agregada pelo backend (`GET /v1/receivables/cash-flow`).
 *
 * Mora aqui, e não dentro de uma página, porque **duas telas mostram este mesmo
 * gráfico**: o painel inicial e a Gestão Financeira. Enquanto cada uma tinha a
 * própria versão, elas divergiam — a do painel só desenhava a barra de recebido
 * e lia outra consulta do backend.
 *
 * As duas barras dividem a mesma escala — a do maior valor da janela — senão
 * meses de porte diferente pareceriam iguais.
 *
 * Não há série de saídas porque ainda não existe lançamento de despesa da
 * imobiliária: o que houvesse aqui seria invenção.
 */

const monthAbbr = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

/** "2026-07" → "Jul". Sem `new Date()` no meio: YYYY-MM não tem fuso. */
function monthLabel(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return monthAbbr[index] ?? month;
}

/** Altura da barra em % do maior valor da série (0 quando não houve movimento). */
function barHeight(value: number, max: number): string {
  return max > 0 ? `${Math.round((value / max) * 100)}%` : "0%";
}

export function CashFlowChart({ points }: { points: CashFlowPoint[] }) {
  const max = Math.max(0, ...points.flatMap((p) => [p.receivedCents, p.expectedCents]));

  if (points.length === 0 || max === 0) {
    return (
      <p className="text-sm subtle">
        Ainda não há movimento no período. O gráfico se preenche conforme as
        parcelas vencem e recebem baixa.
      </p>
    );
  }

  return (
    <>
      <div className="row gap-8 mb-4">
        <span className="badge badge-blue">
          <span className="dot" style={{ background: "var(--primary)" }} /> Recebido
        </span>
        <span className="badge badge-slate">
          <span className="dot" style={{ background: "var(--border-strong)" }} /> Previsto
        </span>
      </div>
      <div className="chart">
        {points.map((p) => (
          <div
            key={p.month}
            style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}
          >
            <div style={{ width: "100%", display: "flex", gap: 3, alignItems: "flex-end", height: 140 }}>
              <div
                className="chart-bar"
                style={{ height: barHeight(p.receivedCents, max) }}
                title={`Recebido em ${monthLabel(p.month)}: ${formatPrice(p.receivedCents)}`}
              />
              <div
                className="chart-bar muted"
                style={{ height: barHeight(p.expectedCents, max) }}
                title={`Previsto em ${monthLabel(p.month)}: ${formatPrice(p.expectedCents)}`}
              />
            </div>
            <span className="text-xs subtle">{monthLabel(p.month)}</span>
          </div>
        ))}
      </div>
    </>
  );
}
