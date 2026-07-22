import { PageHeader } from "../../../components/ui";
import { fetchBanks } from "../../../lib/api";
import { FinanceiroGrid } from "./FinanceiroGrid";

/**
 * Financeiro — landing em cards (mesmo padrão de /tabelas). Cada card leva a uma
 * área do módulo: "Bancos" abre um popup gerenciador (cadastro de contas
 * bancárias) e "Gestão Financeira" navega para o dashboard em /financeiro/gestao.
 */
export default async function FinanceiroPage() {
  const banks = await fetchBanks();

  return (
    <>
      <PageHeader title="Financeiro" />
      <FinanceiroGrid banks={banks ?? []} live={banks !== null} />
    </>
  );
}
