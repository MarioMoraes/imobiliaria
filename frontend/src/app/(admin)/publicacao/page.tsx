import { PageHeader, StatCard, Section, StatusBadge } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { samplePortals } from "../../../lib/sample";

export default function PublicacaoPage() {
  return (
    <>
      <PageHeader
        title="Publicação em Portais"
        actions={<button className="btn btn-primary btn-sm"><Icon name="megaphone" /> Publicar Imóveis</button>}
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="megaphone" label="Anúncios Ativos" value="112" tone="blue" />
        <StatCard icon="globe" label="Portais Conectados" value="3 / 4" tone="accent" />
        <StatCard icon="activity" label="Sincronizações Hoje" value="86" tone="success" />
        <StatCard icon="x" label="Falhas de Sync" value="2" tone="warning" />
      </div>

      <div className="grid grid-2">
        {samplePortals.map((p) => (
          <div className="card card-pad card-hover" key={p.name}>
            <div className="row-between mb-4">
              <div className="row gap-8">
                <span className="stat-icon" style={{ marginBottom: 0 }}><Icon name="globe" /></span>
                <span>
                  <span className="section-title" style={{ display: "block" }}>{p.name}</span>
                  <span className="text-xs subtle">última sync: {p.sync}</span>
                </span>
              </div>
              <StatusBadge status={p.status} />
            </div>
            <div className="row-between">
              <span className="text-sm subtle">{p.listings} anúncios publicados</span>
              <button className="btn btn-ghost btn-sm">Configurar <Icon name="chevronRight" size={14} /></button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
