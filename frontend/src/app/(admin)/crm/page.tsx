import { PageHeader, StatCard } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { dealStages, sampleDeals } from "../../../lib/sample";

export default function CrmPage() {
  return (
    <>
      <PageHeader
        title="CRM — Funil de negócios"
        actions={
          <>
            <button className="btn btn-outline btn-sm"><Icon name="settings" /> Configurar Funil</button>
            <button className="btn btn-primary btn-sm"><Icon name="plus" /> Novo Negócio</button>
          </>
        }
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="target" label="Negócios abertos" value="41" tone="blue" />
        <StatCard icon="clock" label="1ª resposta média" value="9 min" trend="-3 min" tone="success" />
        <StatCard icon="trendingUp" label="Conversão do funil" value="18%" tone="accent" />
        <StatCard icon="bot" label="Leads via IA" value="62%" tone="blue" />
      </div>

      <div className="row-between mb-4">
        <h2 className="section-title">Pipeline · Vendas &amp; Locação</h2>
      </div>

      <div className="kanban">
        {dealStages.map((stage) => {
          const deals = sampleDeals[stage.key] ?? [];
          return (
            <div className="kanban-col" key={stage.key}>
              <div className="kanban-col-head">
                <span className="row gap-8">
                  <span className="dot" style={{ width: 8, height: 8, borderRadius: 999, background: stage.color, display: "inline-block" }} />
                  {stage.label}
                </span>
                <span className="badge badge-slate">{deals.length}</span>
              </div>
              {deals.map((d, i) => (
                <div className="kanban-card" key={i}>
                  <div className="row-between mb-2">
                    <span className="strong text-sm">{d.name}</span>
                    {d.sla && <span className="badge badge-amber text-xs">{d.sla}</span>}
                  </div>
                  <div className="text-xs subtle" style={{ marginBottom: 8 }}>
                    <Icon name="building" size={12} style={{ verticalAlign: "-2px" }} /> {d.prop}
                  </div>
                  <div className="row-between">
                    <span className="text-sm strong gradient-text">{d.value}</span>
                    <span className="text-xs subtle">{d.broker}</span>
                  </div>
                </div>
              ))}
              <button className="btn btn-ghost btn-sm" style={{ width: "100%" }}>
                <Icon name="plus" size={14} /> Adicionar
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
}
