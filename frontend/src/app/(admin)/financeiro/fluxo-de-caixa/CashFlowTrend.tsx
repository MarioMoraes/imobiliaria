import { formatPrice } from "../../../../lib/format";
import type { CashFlowSeriesPoint } from "../../../../lib/api";

/**
 * Entradas × saídas do caixa por mês, com o resultado da imobiliária no rodapé
 * de cada barra.
 *
 * As barras desenham o CAIXA (que é sempre positivo dos dois lados) e não o
 * saldo líquido: um saldo com sinal precisaria de eixo divergente para não
 * mentir sobre a escala, e o número que importa quando ele é negativo já está
 * escrito embaixo. O resultado vai como texto pelo mesmo motivo — ele é uma
 * ordem de grandeza menor que o bruto do aluguel e sumiria numa barra na mesma
 * escala.
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

export function CashFlowTrend({ points }: { points: CashFlowSeriesPoint[] }) {
  // Escala única para as duas barras: séries com escalas próprias fariam um mês
  // de R$ 2 mil parecer igual a um de R$ 200 mil.
  const max = Math.max(0, ...points.flatMap((p) => [p.cashInCents, p.cashOutCents]));

  if (points.length === 0 || max === 0) {
    return (
      <p className="text-sm subtle">
        Ainda não há movimento no período. O gráfico se preenche conforme os
        aluguéis recebem baixa e os repasses são pagos.
      </p>
    );
  }

  return (
    <>
      <div className="row gap-8 mb-4">
        <span className="badge badge-blue">
          <span className="dot" style={{ background: "var(--primary)" }} /> Entradas
        </span>
        <span className="badge badge-slate">
          <span className="dot" style={{ background: "var(--border-strong)" }} /> Saídas
        </span>
      </div>
      <div className="chart">
        {points.map((p) => (
          <div
            key={p.month}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 6,
            }}
          >
            <div
              style={{
                width: "100%",
                display: "flex",
                gap: 3,
                alignItems: "flex-end",
                height: 140,
              }}
            >
              <div
                className="chart-bar"
                style={{ height: barHeight(p.cashInCents, max) }}
                title={`Entrou em ${monthLabel(p.month)}: ${formatPrice(p.cashInCents)}`}
              />
              <div
                className="chart-bar muted"
                style={{ height: barHeight(p.cashOutCents, max) }}
                title={`Saiu em ${monthLabel(p.month)}: ${formatPrice(p.cashOutCents)}`}
              />
            </div>
            <span className="text-xs subtle">{monthLabel(p.month)}</span>
            <span
              className="text-xs num strong"
              style={p.resultNetCents < 0 ? { color: "var(--danger)" } : undefined}
              title={`Resultado da imobiliária em ${monthLabel(p.month)}`}
            >
              {formatPrice(p.resultNetCents)}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
