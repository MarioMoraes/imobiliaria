import Link from "next/link";
import { PageHeader, Section, EmptyState, FilterNotice } from "../../../../components/ui";
import { fetchAuditLogs, type AuditLog } from "../../../../lib/api";
import {
  actionLabel,
  actionTone,
  describePayload,
  ENTITY_LABEL,
  formatMoment,
} from "../../../../lib/audit";

/**
 * Trilha de auditoria do tenant (MOD-AUTH-07). Só leitura: o registro é
 * imutável, e quem escreve nele é o próprio sistema (gateway + `record()`).
 * Exige `audit:read` no backend — sem o papel, a lista volta vazia.
 */

const PAGE_SIZE = 30;

/** Um período em dias vira o `from` que o backend entende. */
const PERIODS = [
  { key: "1", label: "24 horas" },
  { key: "7", label: "7 dias" },
  { key: "30", label: "30 dias" },
  { key: "", label: "Tudo" },
] as const;

function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function hrefWith(current: Params, patch: Partial<Params>): string {
  const merged = { ...current, ...patch };
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value) qs.set(key, String(value));
  }
  return qs.size ? `/configuracoes/auditoria?${qs}` : "/configuracoes/auditoria";
}

interface Params {
  q?: string;
  dias?: string;
  status?: string;
  pagina?: string;
}

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value)?.trim() ?? "";
}

export default async function AuditoriaTenantPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = (await searchParams) ?? {};
  const params: Params = {
    q: first(raw["q"]),
    // Sem escolha na URL, os últimos 7 dias: é o recorte que responde
    // "o que aconteceu esta semana" sem varrer a trilha inteira.
    dias: raw["dias"] === undefined ? "7" : first(raw["dias"]),
    status: first(raw["status"]),
    pagina: first(raw["pagina"]),
  };

  const page = Math.max(1, Number(params.pagina) || 1);
  const days = Number(params.dias);
  const result = await fetchAuditLogs({
    ...(params.q ? { q: params.q } : {}),
    ...(days > 0 ? { from: daysAgo(days) } : {}),
    ...(params.status === "DENIED" ? { status: "DENIED" as const } : {}),
    page,
    limit: PAGE_SIZE,
  });

  const items = result?.items ?? [];
  const total = result?.total ?? 0;
  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <>
      <PageHeader title="Trilha de auditoria" backHref="/configuracoes" />

      <FilterNotice
        term={params.q ?? ""}
        count={items.length}
        clearHref={hrefWith(params, { q: "", pagina: "" })}
      />

      <div className="row gap-8 wrap mb-4">
        {PERIODS.map((period) => (
          <Link
            key={period.key || "all"}
            href={hrefWith(params, { dias: period.key, pagina: "" })}
            className={`btn btn-sm ${params.dias === period.key ? "btn-outline" : "btn-ghost"}`}
          >
            {period.label}
          </Link>
        ))}
        <span className="subtle">|</span>
        <Link
          href={hrefWith(params, { status: "", pagina: "" })}
          className={`btn btn-sm ${params.status ? "btn-ghost" : "btn-outline"}`}
        >
          Todas as ações
        </Link>
        <Link
          href={hrefWith(params, { status: "DENIED", pagina: "" })}
          className={`btn btn-sm ${params.status === "DENIED" ? "btn-outline" : "btn-ghost"}`}
        >
          Só as recusadas
        </Link>
      </div>

      <Section title={total ? `${total} registro${total > 1 ? "s" : ""}` : "Registros"}>
        {items.length === 0 ? (
          <EmptyState
            icon="shield"
            title="Nenhum registro no período"
            hint={
              result === null
                ? "A trilha é restrita ao administrador da imobiliária. Se você tem o papel, verifique se o backend está no ar."
                : "Cada cadastro, alteração ou exclusão feita no sistema aparece aqui, com autor, IP e horário."
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Ação</th>
                  <th>Autor</th>
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
            <Link
              href={hrefWith(params, { pagina: String(page - 1) })}
              className="btn btn-outline btn-sm"
            >
              Anterior
            </Link>
          )}
          {page < lastPage && (
            <Link
              href={hrefWith(params, { pagina: String(page + 1) })}
              className="btn btn-outline btn-sm"
            >
              Próxima
            </Link>
          )}
        </div>
      )}
    </>
  );
}
