import Link from "next/link";
import { PageHeader, StatCard, Section, EmptyState } from "../../../components/ui";
import { fetchAuditSummary, fetchGlobalAuditLogs, type AuditLog } from "../../../lib/api";
import {
  actionLabel,
  actionTone,
  describePayload,
  ENTITY_LABEL,
  formatMoment,
} from "../../../lib/audit";

/**
 * Auditoria global (MOD-SADMIN-04 / SPEC 9.4): a mesma trilha, atravessando
 * tenants. É a exceção controlada ao isolamento — só a identidade de plataforma
 * (`platformAdminHook`) alcança /admin/audit.
 */

const PAGE_SIZE = 40;

function hrefWith(page: number, status: string): string {
  const qs = new URLSearchParams();
  if (page > 1) qs.set("pagina", String(page));
  if (status) qs.set("status", status);
  return qs.size ? `/superadmin/auditoria?${qs}` : "/superadmin/auditoria";
}

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams) ?? {};
  const read = (key: string) => {
    const value = raw[key];
    return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
  };
  const page = Math.max(1, Number(read("pagina")) || 1);
  const status = read("status") === "DENIED" ? "DENIED" : "";

  const [summary, result] = await Promise.all([
    fetchAuditSummary(),
    fetchGlobalAuditLogs({
      page,
      limit: PAGE_SIZE,
      ...(status ? { status: "DENIED" as const } : {}),
    }),
  ]);

  const items = result?.items ?? [];
  const total = result?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader title="Auditoria global" />

      <div className="grid grid-4 mb-4">
        <StatCard
          icon="list"
          label="Eventos (24h)"
          value={String(summary?.last24h ?? 0)}
          tone="blue"
        />
        <StatCard
          icon="shield"
          label="Ações sensíveis (24h)"
          value={String(summary?.sensitive24h ?? 0)}
          tone="accent"
        />
        <StatCard
          icon="bot"
          label="Ações de IA (24h)"
          value={String(summary?.ai24h ?? 0)}
          tone="success"
        />
        <StatCard
          icon="flag"
          label="Recusadas (24h)"
          value={String(summary?.denied24h ?? 0)}
          tone="warning"
        />
      </div>

      <div className="row gap-8 wrap mb-4">
        <Link
          href={hrefWith(1, "")}
          className={`btn btn-sm ${status ? "btn-ghost" : "btn-outline"}`}
        >
          Todas as ações
        </Link>
        <Link
          href={hrefWith(1, "DENIED")}
          className={`btn btn-sm ${status ? "btn-outline" : "btn-ghost"}`}
        >
          Só as recusadas
        </Link>
      </div>

      <Section title={total ? `Trilha de auditoria — ${total} registros` : "Trilha de auditoria"}>
        {items.length === 0 ? (
          <EmptyState
            icon="shield"
            title="Nenhum registro"
            hint={
              result === null
                ? "A área exige identidade de plataforma (PLATFORM_ADMIN_CLERK_IDS) e o backend no ar."
                : "As ações dos tenants aparecem aqui assim que acontecem."
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Ação</th>
                  <th>Imobiliária</th>
                  <th>Ator</th>
                  <th>Alvo</th>
                  <th>Origem</th>
                  <th>Quando</th>
                </tr>
              </thead>
              <tbody>
                {items.map((log: AuditLog) => (
                  <tr key={log.id}>
                    <td>
                      <span className={`badge ${actionTone(log)}`}>{actionLabel(log.action)}</span>
                      {log.status === "DENIED" && (
                        <span className="badge badge-red" style={{ marginLeft: 6 }}>
                          recusada
                        </span>
                      )}
                    </td>
                    <td className="text-sm">{log.tenantName ?? log.tenantId}</td>
                    <td className="text-sm">{log.actorLabel ?? "—"}</td>
                    <td className="text-sm">
                      <span className="strong">{ENTITY_LABEL[log.entity] ?? log.entity}</span>
                      {describePayload(log) && (
                        <span className="subtle text-xs" style={{ display: "block" }}>
                          {describePayload(log)}
                        </span>
                      )}
                    </td>
                    <td className="text-xs subtle">{log.ipAddress ?? "—"}</td>
                    <td className="text-sm subtle">{formatMoment(log.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {lastPage > 1 && (
        <div className="row gap-8 mb-4" style={{ justifyContent: "flex-end" }}>
          <span className="text-sm subtle">
            Página {page} de {lastPage}
          </span>
          {page > 1 && (
            <Link href={hrefWith(page - 1, status)} className="btn btn-outline btn-sm">
              Anterior
            </Link>
          )}
          {page < lastPage && (
            <Link href={hrefWith(page + 1, status)} className="btn btn-outline btn-sm">
              Próxima
            </Link>
          )}
        </div>
      )}
    </>
  );
}
