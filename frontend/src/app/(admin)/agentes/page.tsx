import { PageHeader, StatCard, Section, BackendNote } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { sampleConversations } from "../../../lib/sample";

const channelIcon: Record<string, string> = {
  WhatsApp: "messageCircle",
  Instagram: "sparkles",
  Chat: "messageCircle",
  "E-mail": "mail",
};

const skills = [
  { name: "Atendimento multicanal", desc: "WhatsApp, Instagram, chat e e-mail com contexto unificado", on: true },
  { name: "Qualificação de leads", desc: "Triagem e registro no CRM por rodízio", on: true },
  { name: "Recomendação de imóveis", desc: "Cruza perfil de busca × inventário (RAG por tenant)", on: true },
  { name: "Geração de anúncios", desc: "Descrições otimizadas a partir dos dados do imóvel", on: true },
  { name: "OCR & análise documental", desc: "Extrai dados de RG, CPF e comprovantes", on: false },
  { name: "Relatórios inteligentes", desc: "Resumos em linguagem natural", on: true },
];

export default function AgentesPage() {
  return (
    <>
      <PageHeader
        eyebrow="Inteligência · Seção 8 (AaaS)"
        title="Agentes de IA"
        lead="A camada diferencial. Handoff para corretor quando há sentimento negativo ou 3 tentativas sem resolução. Toda ação do agente é auditada."
        actions={
          <>
            <span className="badge badge-cyan"><span className="pulse-dot"><span /><span /></span> online</span>
            <button className="btn btn-primary btn-sm"><Icon name="settings" /> Configurar Agentes</button>
          </>
        }
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="messageCircle" label="Conversas hoje" value="28" tone="blue" />
        <StatCard icon="check" label="Resolvidas sem humano" value="81%" tone="success" />
        <StatCard icon="broker" label="Handoffs" value="4" tone="warning" />
        <StatCard icon="sparkles" label="Créditos de IA" value="7.240" tone="accent" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Section title="Conversas ativas" action={<BackendNote endpoint="/v1/ai/conversations" />}>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Cliente</th><th>Canal</th><th>Última mensagem</th><th>Estado</th></tr></thead>
              <tbody>
                {sampleConversations.map((c, i) => (
                  <tr key={i}>
                    <td className="strong">{c.name}</td>
                    <td>
                      <span className="row gap-8 text-sm">
                        <Icon name={channelIcon[c.channel] ?? "messageCircle"} size={15} /> {c.channel}
                      </span>
                    </td>
                    <td className="text-sm subtle" style={{ maxWidth: 240 }}>{c.last}</td>
                    <td>
                      {c.status === "handoff"
                        ? <span className="badge badge-red">Handoff</span>
                        : c.status === "active"
                          ? <span className="badge badge-green"><span className="dot" /> Ativa</span>
                          : <span className="badge badge-slate">Encerrada</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Skills habilitadas" pad>
          <div className="stack" style={{ gap: 10 }}>
            {skills.map((s) => (
              <div key={s.name} className="card card-pad row-between" style={{ padding: 14 }}>
                <div className="row gap-8">
                  <span className="stat-icon accent" style={{ width: 34, height: 34, marginBottom: 0 }}><Icon name="bot" size={16} /></span>
                  <span>
                    <span className="strong text-sm" style={{ display: "block" }}>{s.name}</span>
                    <span className="text-xs subtle">{s.desc}</span>
                  </span>
                </div>
                <span className={`badge ${s.on ? "badge-green" : "badge-slate"}`}>{s.on ? "Ativa" : "Off"}</span>
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
