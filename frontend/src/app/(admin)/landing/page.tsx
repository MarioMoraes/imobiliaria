import { PageHeader, StatCard, Section } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { tenantSubdomain } from "../../../lib/format";

const blocks = [
  { name: "Hero", desc: "Título, chamada e busca", icon: "sparkles", on: true },
  { name: "Catálogo de imóveis", desc: "Grade de imóveis disponíveis", icon: "building", on: true },
  { name: "Sobre / Equipe", desc: "Institucional e corretores", icon: "users", on: true },
  { name: "Depoimentos", desc: "Provas sociais de clientes", icon: "star", on: false },
  { name: "Contato / Lead", desc: "Formulário com honeypot", icon: "mail", on: true },
  { name: "Chat com IA", desc: "Widget de atendimento", icon: "bot", on: true },
];

export default function LandingPage() {
  return (
    <>
      <PageHeader
        title="Landing Page"
        actions={
          <>
            <button className="btn btn-outline btn-sm"><Icon name="eye" /> Pré-visualizar</button>
            <button className="btn btn-primary btn-sm"><Icon name="globe" /> Publicar</button>
          </>
        }
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="eye" label="Visitas (Mês)" value="8.240" trend="+18%" tone="blue" />
        <StatCard icon="target" label="Leads Capturados" value="132" tone="accent" />
        <StatCard icon="trendingUp" label="Conversão" value="1,6%" tone="success" />
        <StatCard icon="shield" label="Spam Bloqueado" value="41" tone="warning" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 340px" }}>
        <Section title="Editor por Blocos">
          <div className="card-pad stack" style={{ gap: 10 }}>
            {blocks.map((b) => (
              <div key={b.name} className="card card-pad row-between" style={{ padding: 14 }}>
                <div className="row gap-8">
                  <button className="icon-btn" style={{ width: 30, height: 30, cursor: "grab" }}><Icon name="list" size={15} /></button>
                  <span className="stat-icon" style={{ width: 34, height: 34, marginBottom: 0 }}><Icon name={b.icon} size={16} /></span>
                  <span>
                    <span className="strong text-sm" style={{ display: "block" }}>{b.name}</span>
                    <span className="text-xs subtle">{b.desc}</span>
                  </span>
                </div>
                <span className={`badge ${b.on ? "badge-green" : "badge-slate"}`}>{b.on ? "Ativo" : "Oculto"}</span>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Domínio & Branding" pad>
          <div className="field mb-4">
            <label>Subdomínio</label>
            <input className="input" defaultValue={tenantSubdomain("demo")} readOnly />
          </div>
          <div className="field mb-4">
            <label>Domínio Próprio</label>
            <input className="input" placeholder="www.suaimobiliaria.com.br" />
          </div>
          <div className="field">
            <label>Cor Primária</label>
            <div className="row gap-8">
              <span style={{ width: 34, height: 34, borderRadius: 8, background: "var(--primary)", border: "1px solid var(--border)" }} />
              <input className="input" defaultValue="#2563EB" />
            </div>
          </div>
          <button className="btn btn-primary btn-sm mt-4" style={{ width: "100%" }}>Salvar Branding</button>
        </Section>
      </div>
    </>
  );
}
