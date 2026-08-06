import { PageHeader, StatCard, Section, StatusBadge } from "../../../components/ui";
import { fetchEmployees } from "../../../lib/api";
import { sampleEmployees } from "../../../lib/sample";
import { EmployeeInviteButton } from "./EmployeeInviteButton";
import { EmployeeInviteActions } from "./EmployeeInviteActions";
import { EmployeeRowActions } from "./EmployeeRowActions";
import type { EmployeeAccessStatus, EmployeeRole } from "./actions";

/** Linha de exibição unificada (dado real do backend ou amostra de fallback). */
interface Row {
  id: string;
  name: string;
  position: string;
  hiredAt: string;
  roles: string[];
  access: EmployeeAccessStatus;
  /** Convite ainda não aceito (users.status === "invited"). */
  invited: boolean;
}

const accessLabel: Record<EmployeeAccessStatus, { status: string; label: string }> = {
  ATIVO: { status: "active", label: "Ativo" },
  SUSPENSO: { status: "suspended", label: "Suspenso" },
  REVOGADO: { status: "canceled", label: "Revogado" },
};

/** Papéis do backend restritos aos atribuíveis na UI (os demais só se exibem). */
const editableRoles = (roles: string[]): EmployeeRole[] =>
  roles.filter(
    (r): r is EmployeeRole =>
      r === "ADMIN" || r === "GESTOR" || r === "FINANCEIRO" || r === "AUXILIAR",
  );

export default async function FuncionariosPage() {
  const live = await fetchEmployees();
  const isLive = live !== null;

  const rows: Row[] = isLive
    ? live.map((e) => ({
        id: e.id,
        name: e.fullName,
        position: e.position,
        hiredAt: e.hiredAt ?? "",
        roles: e.roles,
        access: e.accessStatus,
        invited: e.userStatus === "invited",
      }))
    : sampleEmployees.map((e) => ({
        id: e.id,
        name: e.name,
        position: e.role,
        hiredAt: "",
        roles: e.roles,
        access: e.access === "active" ? ("ATIVO" as const) : ("SUSPENSO" as const),
        invited: false,
      }));

  const has = (r: Row, role: string) => r.roles.includes(role);
  const active = rows.filter((r) => r.access === "ATIVO").length;
  const admins = rows.filter((r) => has(r, "ADMIN")).length;
  const gestores = rows.filter((r) => has(r, "GESTOR")).length;
  const financeiro = rows.filter((r) => has(r, "FINANCEIRO")).length;
  const suspended = rows.filter((r) => r.access !== "ATIVO").length;

  return (
    <>
      <PageHeader
        title="Funcionários"
        actions={<EmployeeInviteButton />}
      />

      <div className="grid grid-5 mb-4">
        <StatCard icon="users" label="Colaboradores Ativos" value={String(active)} tone="blue" />
        <StatCard icon="shield" label="Administradores" value={String(admins)} tone="accent" />
        <StatCard icon="gauge" label="Gestores" value={String(gestores)} tone="accent" />
        <StatCard icon="wallet" label="Financeiro" value={String(financeiro)} tone="success" />
        <StatCard icon="x" label="Acessos Suspensos" value={String(suspended)} tone="warning" />
      </div>

      <Section
        title="Equipe Interna"
      >
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Colaborador</th><th>Cargo</th><th>Papéis (RBAC)</th><th>Acesso</th><th></th></tr>
            </thead>
            <tbody>
              {rows.map((e) => (
                <tr key={e.id}>
                  <td>
                    <div className="cell-main">
                      <span className="avatar" style={{ width: 34, height: 34, fontSize: "0.72rem" }}>
                        {e.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="strong">{e.name}</span>
                    </div>
                  </td>
                  <td>{e.position}</td>
                  <td>
                    <div className="row gap-8 wrap">
                      {e.roles.map((r) => <span key={r} className="badge badge-blue">{r}</span>)}
                    </div>
                  </td>
                  <td>
                    <div className="row gap-8 wrap">
                      <StatusBadge status={accessLabel[e.access].status} label={accessLabel[e.access].label} />
                      {e.invited && <span className="badge badge-amber">Convite pendente</span>}
                    </div>
                  </td>
                  <td style={{ width: 130 }}>
                    <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
                      {e.invited && <EmployeeInviteActions id={e.id} name={e.name} />}
                      <EmployeeRowActions
                        disabled={!isLive}
                        employee={{
                          id: e.id,
                          name: e.name,
                          position: e.position,
                          hiredAt: e.hiredAt,
                          roles: editableRoles(e.roles),
                          access: e.access,
                        }}
                      />
                    </div>
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
