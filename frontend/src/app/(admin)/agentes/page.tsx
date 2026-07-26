import { PageHeader } from "../../../components/ui";
import { fetchAiConversations, fetchAiCredits } from "../../../lib/api";
import { AgentesGrid } from "./AgentesGrid";

/**
 * Agentes de IA — landing em cards (mesmo padrão de /financeiro e /corretores).
 * "Copiloto" e "Conversas" navegam para subpáginas; "Créditos" abre um popup
 * com o saldo.
 *
 * Substituiu o mock estático que lia de lib/sample.ts: os números aqui são do
 * backend (MOD-AI). `null` significa que a rota falhou ou o papel não tem
 * permissão — a UI mostra o card sem contagem em vez de inventar zero.
 */
export default async function AgentesPage() {
  const [credits, conversations] = await Promise.all([
    fetchAiCredits(),
    fetchAiConversations(),
  ]);

  return (
    <>
      <PageHeader title="Agentes de IA" />
      <AgentesGrid credits={credits} conversationCount={conversations?.length ?? null} />
    </>
  );
}
