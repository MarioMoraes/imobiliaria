import { PageHeader } from "../../../components/ui";
import { backendNotice, fetchBanks, fetchPayableSummary } from "../../../lib/api";
import { FinanceiroGrid } from "./FinanceiroGrid";

/**
 * Financeiro — landing em cards (mesmo padrão de /tabelas). Cada card leva a uma
 * área do módulo: "Bancos" abre um popup gerenciador (cadastro de contas
 * bancárias); "Gestão Financeira" e "Pagamento de Proprietários" navegam para as
 * subpáginas.
 */
export default async function FinanceiroPage() {
  const [banks, payouts] = await Promise.all([fetchBanks(), fetchPayableSummary()]);
  const notice = backendNotice();

  return (
    <>
      <PageHeader title="Financeiro" />
      <FinanceiroGrid
        banks={banks ?? []}
        live={banks !== null}
        notice={notice}
        pendingPayouts={payouts?.pendingCount ?? 0}
      />
    </>
  );
}
