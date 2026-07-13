import { PageHeader, StatCard, Section, StatusBadge, BackendNote } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { sampleDocuments } from "../../../lib/sample";

export default function DocumentosPage() {
  return (
    <>
      <PageHeader
        eyebrow="Operação · Módulo 7.12"
        title="Documentos"
        lead="Repositório central por entidade, com versionamento, controle de expiração e extração de dados por OCR. Retenção alinhada à LGPD."
        actions={<button className="btn btn-primary btn-sm"><Icon name="plus" /> Enviar Documento</button>}
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="folder" label="Documentos" value="4.812" tone="blue" />
        <StatCard icon="clock" label="A vencer em 30 dias" value="12" tone="warning" />
        <StatCard icon="bot" label="Extraídos por OCR" value="1.204" tone="accent" />
        <StatCard icon="shield" label="Retenção LGPD ok" value="100%" tone="success" />
      </div>

      <Section title="Biblioteca documental" action={<BackendNote endpoint="/v1/documents" />}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Documento</th><th>Entidade</th><th>Tipo</th><th>Validade</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {sampleDocuments.map((d, i) => (
                <tr key={i}>
                  <td>
                    <div className="cell-main">
                      <span className="stat-icon" style={{ width: 34, height: 34, marginBottom: 0 }}><Icon name="contract" size={16} /></span>
                      <span className="strong">{d.name}</span>
                    </div>
                  </td>
                  <td><span className="badge badge-slate">{d.entity}</span></td>
                  <td>{d.kind}</td>
                  <td className="text-sm subtle">{d.expires}</td>
                  <td>
                    {d.status === "overdue"
                      ? <StatusBadge status="overdue" label="Expirado" />
                      : <StatusBadge status="active" label="Ativo" />}
                  </td>
                  <td>
                    <button className="icon-btn" style={{ width: 30, height: 30 }} aria-label="Baixar"><Icon name="arrowUpRight" size={15} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
