import { PageHeader, Section, StatCard } from "../../../../components/ui";
import { BackendNotice } from "../../../../components/BackendNotice";
import {
  backendNotice,
  fetchBanks,
  fetchCashFlowCategories,
  fetchCashFlowSeries,
  fetchCashFlowStatement,
  formatMonth,
  formatPrice,
} from "../../../../lib/api";
import { CashFlowToolbar } from "./CashFlowToolbar";
import { MovementsTable } from "./MovementsTable";
import { ResultBreakdown } from "./ResultBreakdown";
import { CashFlowTrend } from "./CashFlowTrend";

/** Janela do gráfico: 6 meses para trás, incluindo o corrente. */
const TREND_MONTHS = 6;

/**
 * Fluxo de Caixa (MOD-FIN).
 *
 * A tela mostra DOIS totais porque somar um só mentiria: a taxa de administração
 * já está DENTRO do aluguel recebido (ela é a diferença entre o que o inquilino
 * pagou e o que o proprietário recebe). Então:
 *
 * - **Saldo de caixa** é o extrato do banco, com o dinheiro de terceiros que
 *   passa por ele.
 * - **Resultado da imobiliária** é o que fica: taxa de administração, juros e
 *   multa, comissões e as despesas próprias.
 *
 * A diferença entre os dois é o que ainda está para repassar — daí o terceiro
 * indicador.
 */
export default async function FluxoDeCaixaPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const params = await searchParams;
  const month = /^\d{4}-\d{2}$/.test(params.mes ?? "")
    ? params.mes!
    : new Date().toISOString().slice(0, 7);

  const [statement, trend, categories, banks] = await Promise.all([
    fetchCashFlowStatement(month),
    fetchCashFlowSeries(TREND_MONTHS).then((s) => s ?? []),
    fetchCashFlowCategories().then((c) => c ?? []),
    fetchBanks().then((b) => b ?? []),
  ]);

  // `backendNotice()` DEPOIS das leituras, na mesma request: ele classifica a
  // causa (offline / sem permissão / sem tenant) em vez de cravar "backend fora
  // do ar" numa tela que só está vazia.
  const notice = backendNotice();
  const summary = statement?.summary;

  return (
    <>
      <PageHeader
        title="Fluxo de Caixa"
        backHref="/financeiro"
        actions={
          <CashFlowToolbar
            month={month}
            categories={categories}
            banks={banks}
            disabled={statement === null}
          />
        }
      />

      <div className="grid grid-3 mb-4">
        <StatCard
          icon="wallet"
          label="Saldo de Caixa"
          value={formatPrice(summary?.cash.netCents ?? 0)}
          trend={`Entrou ${formatPrice(summary?.cash.inflowCents ?? 0)}`}
          trendDir={(summary?.cash.netCents ?? 0) >= 0 ? "up" : "down"}
          feature
        />
        <StatCard
          icon="trendingUp"
          label="Resultado da Imobiliária"
          value={formatPrice(summary?.result.netCents ?? 0)}
          tone={(summary?.result.netCents ?? 0) >= 0 ? "success" : "warning"}
          trend={`Taxa de Adm. ${formatPrice(summary?.adminFeeCents ?? 0)}`}
          trendDir={(summary?.result.netCents ?? 0) >= 0 ? "up" : "down"}
        />
        <StatCard
          icon="banknote"
          label="A Repassar (de Terceiros)"
          value={formatPrice(summary?.pendingPayoutCents ?? 0)}
          tone="accent"
        />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1.5fr 1fr" }}>
        <div className="stack">
          <Section
            title="Caixa X Resultado"
            action={<span className="badge badge-blue">{TREND_MONTHS} meses</span>}
            pad
          >
            <CashFlowTrend points={trend} />
          </Section>

          <Section
            title="Movimentos"
            action={<span className="badge badge-blue">{formatMonth(month)}</span>}
          >
            <MovementsTable
              movements={statement?.movements ?? []}
              monthLabel={formatMonth(month)}
            />
          </Section>
        </div>

        <div className="stack">
          <Section title={`Resultado · ${formatMonth(month)}`} pad>
            <ResultBreakdown summary={summary ?? null} />
          </Section>

          <Section title="Por Categoria">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th style={{ textAlign: "right" }}>Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {(statement?.byCategory ?? []).map((row) => (
                    <tr key={`${row.direction}:${row.categoryName}`}>
                      <td className="text-sm">
                        <span className="row gap-8">
                          <span
                            className={`badge ${
                              row.direction === "ENTRADA" ? "badge-green" : "badge-amber"
                            }`}
                          >
                            {row.direction === "ENTRADA" ? "Receita" : "Despesa"}
                          </span>
                          {row.categoryName}
                        </span>
                      </td>
                      <td className="strong num" style={{ textAlign: "right" }}>
                        {formatPrice(row.amountCents)}
                      </td>
                    </tr>
                  ))}
                  {(statement?.byCategory ?? []).length === 0 && (
                    <tr>
                      <td colSpan={2} className="text-sm subtle">
                        Nada apurado em {formatMonth(month)}. A taxa de administração
                        aparece quando um aluguel recebe baixa.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Section>
        </div>
      </div>

      {statement === null && notice && <BackendNotice message={notice} />}
    </>
  );
}
