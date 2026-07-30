import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import {
  fetchAuditLogs,
  fetchCurrentUser,
  fetchDocumentCounts,
} from "../../../lib/api";
import { AUDIT_ROLES } from "../../../lib/audit";

/**
 * Auditoria — landing em cards (mesmo padrão de /tabelas e /financeiro). Reúne
 * o que serve para prestar contas do que aconteceu: a trilha de ações e o
 * acervo documental.
 *
 * Os cards são recortados pelo papel: a trilha é de quem responde pelo tenant
 * (`AUDIT_ROLES`), enquanto os documentos seguem a permissão `document:read`,
 * bem mais ampla. Sem nenhum card visível, a página nem existe (404) — é o
 * mesmo critério que esconde o item no menu (`visibleNav`).
 */
export default async function AuditoriaPage() {
  const me = await fetchCurrentUser();
  const roles = me?.roles ?? [];
  const canReadTrail = roles.some((role) => AUDIT_ROLES.includes(role));

  // Contadores só para quem vai ver o respectivo card (uma chamada a menos, e
  // nenhuma leitura que o papel não autoriza).
  const [trail, documents] = await Promise.all([
    canReadTrail ? fetchAuditLogs({ limit: 1 }) : null,
    fetchDocumentCounts(),
  ]);

  const canReadDocuments = documents !== null;
  if (!canReadTrail && !canReadDocuments) notFound();

  return (
    <>
      <PageHeader title="Auditoria" />

      <div className="grid grid-3">
        {canReadTrail && (
          <Link href="/auditoria/trilha" className="lookup-card reveal">
            <span className="stat-icon accent">
              <Icon name="list" />
            </span>
            <div className="stack" style={{ gap: 4 }}>
              <span className="lookup-card-title">Trilha de auditoria</span>
              <span className="subtle text-sm">
                Quem fez o quê no sistema, com autor, IP e horário. Registro imutável.
              </span>
            </div>
            <div className="lookup-card-foot">
              <span className="badge badge-slate">
                {trail?.total ?? 0} {trail?.total === 1 ? "registro" : "registros"}
              </span>
              <span className="row gap-8 text-sm strong">
                Abrir <Icon name="arrowRight" size={15} />
              </span>
            </div>
          </Link>
        )}

        {canReadDocuments && (
          <Link href="/auditoria/documentos" className="lookup-card reveal">
            <span className="stat-icon success">
              <Icon name="folder" />
            </span>
            <div className="stack" style={{ gap: 4 }}>
              <span className="lookup-card-title">Documentos</span>
              <span className="subtle text-sm">
                Acervo do tenant: RG, comprovantes, matrículas e contratos, com versões.
              </span>
            </div>
            <div className="lookup-card-foot">
              <span className="badge badge-slate">
                {documents.total} {documents.total === 1 ? "documento" : "documentos"}
              </span>
              <span className="row gap-8 text-sm strong">
                Abrir <Icon name="arrowRight" size={15} />
              </span>
            </div>
          </Link>
        )}
      </div>
    </>
  );
}
