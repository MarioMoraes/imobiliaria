import { notFound } from "next/navigation";
import { PageHeader, Section } from "../../../../../components/ui";
import { fetchAiConversation } from "../../../../../lib/api";

/**
 * Detalhe de uma conversa: o diálogo e a trilha de ferramentas.
 *
 * A trilha é o que responde "por que o agente disse isso" — cada consulta que
 * ele fez, com o filtro usado e se foi autorizada. Uma linha DENIED significa
 * que o agente tentou ler algo que o papel de quem perguntou não alcança, e o
 * RBAC barrou.
 */
export default async function ConversaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const conversation = await fetchAiConversation(id);
  if (!conversation) notFound();

  return (
    <>
      <PageHeader
        title={conversation.title ?? "Conversa"}
        backHref="/agentes/conversas"
      />

      <Section title="Diálogo">
        <div className="stack card-pad" style={{ gap: 12 }}>
          {conversation.messages.map((m) => (
            <div key={m.id} className={`chat-turn chat-turn-${m.role === "user" ? "user" : "assistant"}`}>
              <div className="chat-bubble">
                {m.content.split("\n").map((line, i) => (
                  <p key={i}>{line || " "}</p>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Consultas executadas">
        {conversation.toolCalls.length === 0 ? (
          <p className="subtle text-sm card-pad">
            O agente respondeu sem consultar o cadastro.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Ferramenta</th>
                  <th>Parâmetros</th>
                  <th>Resultado</th>
                  <th>Duração</th>
                </tr>
              </thead>
              <tbody>
                {conversation.toolCalls.map((t) => (
                  <tr key={t.id}>
                    <td className="strong text-sm">{t.tool}</td>
                    <td className="text-xs subtle" style={{ maxWidth: 260 }}>
                      {JSON.stringify(t.input)}
                    </td>
                    <td>
                      {t.status === "OK" ? (
                        <span className="badge badge-green">Ok</span>
                      ) : t.status === "DENIED" ? (
                        <span className="badge badge-red">Negada</span>
                      ) : (
                        <span className="badge badge-slate">Erro</span>
                      )}
                    </td>
                    <td className="text-sm subtle">
                      {t.durationMs === null ? "—" : `${t.durationMs} ms`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
