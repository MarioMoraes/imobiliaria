import { PageHeader } from "../../../components/ui";
import {
  backendNotice,
  fetchBanks,
  fetchCashFlowStatement,
  fetchCommissionSummary,
  fetchPayableSummary,
} from "../../../lib/api";
import { FinanceiroGrid } from "./FinanceiroGrid";

const monthAbbr = [
  "Jan", "Fev", "Mar", "Abr", "Mai", "Jun",
  "Jul", "Ago", "Set", "Out", "Nov", "Dez",
];

/** "2026-07" → "Jul". Sem `new Date()` no meio: YYYY-MM não tem fuso. */
function monthLabel(month: string): string {
  return monthAbbr[Number(month.slice(5, 7)) - 1] ?? month;
}

/**
 * Financeiro — landing em cards (mesmo padrão de /tabelas). Cada card leva a uma
 * área do módulo: "Bancos" abre um popup gerenciador (cadastro de contas
 * bancárias); os demais navegam para as subpáginas.
 */
export default async function FinanceiroPage() {
  const month = new Date().toISOString().slice(0, 7);

  const [banks, payouts, cashFlow, commissions] = await Promise.all([
    fetchBanks(),
    fetchPayableSummary(),
    fetchCashFlowStatement(month),
    fetchCommissionSummary(month),
  ]);
  const notice = backendNotice();

  return (
    <>
      <PageHeader title="Financeiro" />
      <FinanceiroGrid
        banks={banks ?? []}
        live={banks !== null}
        notice={notice}
        pendingPayouts={payouts?.pendingCount ?? 0}
        monthLabel={monthLabel(month)}
        resultCents={cashFlow?.summary.result.netCents ?? 0}
        pendingCommissions={commissions?.pendingCount ?? 0}
      />
    </>
  );
}
