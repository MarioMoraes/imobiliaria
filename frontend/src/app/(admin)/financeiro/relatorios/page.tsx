import { PageHeader } from "../../../../components/ui";
import { ReportsGrid } from "./ReportsGrid";

/**
 * Relatórios do Financeiro — landing em cards (mesmo padrão de `/financeiro` e
 * `/tabelas`), um card por documento.
 *
 * Nenhuma leitura acontece aqui: os quatro relatórios são gerados sob demanda,
 * em PDF, e o único dado que falta é o recorte — que cada card pede no popup
 * antes de abrir o arquivo. Buscar totais só para enfeitar o card obrigaria a
 * escolher um mês arbitrário e mostraria um número que não é o do relatório que
 * o usuário vai emitir.
 */
export default function RelatoriosPage() {
  return (
    <>
      <PageHeader title="Relatórios" backHref="/financeiro" />
      <ReportsGrid />
    </>
  );
}
