import { PageHeader, StatCard, Section, StatusBadge, BackendNote } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { samplePortals } from "../../../lib/sample";

export default function PublicacaoPage() {
  return (
    <>
      <PageHeader
        eyebrow="Presença Digital · Módulo 7.16"
        title="Publicação em portais"
        lead="Exportação de feed para Viva Real, ZAP, OLX e Imovelweb, com sincronização de status — imóveis alugados/vendidos saem automaticamente."
        actions={<button className="btn btn-primary btn-sm"><Icon name="megaphone" /> Publicar Imóveis</button>}
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="megaphone" label="Anúncios ativos" value="112" tone="blue" />
        <StatCard icon="globe" label="Portais conectados" value="3 / 4" tone="accent" />
        <StatCard icon="activity" label="Sincronizações hoje" value="86" tone="success" />
        <StatCard icon="x" label="Falhas de sync" value="2" tone="warning" />
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

      <div className="mt-4"><BackendNote endpoint="/v1/portal-integrations" /></div>
    </>
  );
}
