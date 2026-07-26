import { PageHeader } from "../../../../components/ui";
import { Chat } from "./Chat";

/**
 * Copiloto — subpágina de /agentes. Server Component fino: a conversa toda é
 * estado de cliente (mensagens vão e voltam pela Server Action), então não há o
 * que buscar aqui.
 *
 * `backHref` no PageHeader é o botão Voltar padronizado — subpágina precisa
 * dele, card que abre modal não (ver o Grid de /agentes).
 */
export default function CopilotoPage() {
  return (
    <>
      <PageHeader title="Copiloto" backHref="/agentes" />
      <Chat />
    </>
  );
}
