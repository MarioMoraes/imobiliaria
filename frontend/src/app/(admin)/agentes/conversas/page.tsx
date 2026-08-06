import Link from "next/link";
import { PageHeader, Section } from "../../../../components/ui";
import { fetchAiConversations } from "../../../../lib/api";

/**
 * Histórico de conversas do copiloto. Exige `ai:read` no backend — um papel sem
 * ela recebe null e vê o aviso, em vez de uma lista vazia que pareceria "nunca
 * ninguém perguntou nada".
 */
export default async function ConversasPage() {
  const conversations = await fetchAiConversations();

  return (
    <>
      <PageHeader title="Conversas" backHref="/agentes" />

      <Section title="Histórico">
        {conversations === null ? (
          <p className="subtle text-sm card-pad">
            Não foi possível carregar as conversas. Verifique se o seu perfil tem acesso ao
            histórico do assistente.
          </p>
        ) : conversations.length === 0 ? (
          <p className="subtle text-sm card-pad">
            Nenhuma conversa ainda. Abra o Copiloto e faça a primeira pergunta.
          </p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Assunto</th>
                  <th>Canal</th>
                  <th>Situação</th>
                  <th>Última Atividade</th>
                </tr>
              </thead>
              <tbody>
                {conversations.map((c) => (
                  <tr key={c.id}>
                    <td className="strong">
                      <Link href={`/agentes/conversas/${c.id}`}>
                        {c.title ?? "(sem assunto)"}
                      </Link>
                    </td>
                    <td className="text-sm">{c.channel}</td>
                    <td>
                      {c.status === "HANDOFF" ? (
                        <span className="badge badge-red">Handoff</span>
                      ) : c.status === "ATIVA" ? (
                        <span className="badge badge-green">
                          <span className="dot" /> Ativa
                        </span>
                      ) : (
                        <span className="badge badge-slate">Encerrada</span>
                      )}
                    </td>
                    <td className="text-sm subtle">
                      {new Date(c.updatedAt).toLocaleString("pt-BR")}
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
