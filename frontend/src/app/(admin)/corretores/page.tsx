import { PageHeader } from "../../../components/ui";
import { backendNotice, fetchBrokers } from "../../../lib/api";
import { CorretoresGrid } from "./CorretoresGrid";

/**
 * Corretores — landing em cards (mesmo padrão de /financeiro). "Cadastro de
 * Corretores" abre um popup gerenciador (lista + cadastro/edição/remoção) e
 * "Estatísticas" navega para o ranking em /corretores/estatisticas.
 */
export default async function CorretoresPage() {
  const brokers = await fetchBrokers();
  const notice = backendNotice();

  return (
    <>
      <PageHeader title="Corretores" />
      <CorretoresGrid brokers={brokers ?? []} live={brokers !== null} notice={notice} />
    </>
  );
}
