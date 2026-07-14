import { PageHeader, StatCard, Section, StatusBadge } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { fetchEmployees } from "../../../lib/api";
import { sampleEmployees } from "../../../lib/sample";
import { EmployeeInviteButton } from "./EmployeeInviteButton";

/** Linha de exibição unificada (dado real do backend ou amostra de fallback). */
interface Row {
  id: string;
  name: string;
  position: string;
  roles: string[];
  access: "active" | "suspended" | "revoked";
  /** Convite ainda não aceito (users.status === "invited"). */
  invited: boolean;
}

const accessLabel: Record<Row["access"], { status: string; label: string }> = {
  active: { status: "active", label: "Ativo" },
  suspended: { status: "suspended", label: "Suspenso" },
  revoked: { status: "canceled", label: "Revogado" },
};

export default async function FuncionariosPage() {
  const live = await fetchEmployees();
  const isLive = live !== null;

  const rows: Row[] = isLive
    ? live.map((e) => ({
        id: e.id,
        name: e.fullName,
        position: e.position,
        roles: e.roles,
        access:
          e.accessStatus === "ATIVO"
            ? "active"
            : e.accessStatus === "SUSPENSO"
              ? "suspended"
              : "revoked",
        invited: e.userStatus === "invited",
      }))
    : sampleEmployees.map((e) => ({
        id: e.id,
        name: e.name,
        position: e.role,
        roles: e.roles,
        access: e.access === "active" ? "active" : "suspended",
        invited: false,
      }));

  const has = (r: Row, role: string) => r.roles.includes(role);
  const active = rows.filter((r) => r.access === "active").length;
  const admins = rows.filter((r) => has(r, "ADMIN")).length;
  const financeiro = rows.filter((r) => has(r, "FINANCEIRO")).length;
  const suspended = rows.filter((r) => r.access !== "active").length;

  return (
    <>
      <PageHeader
        title="Funcionários"
        actions={<EmployeeInviteButton />}
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="users" label="Colaboradores ativos" value={String(active)} tone="blue" />
        <StatCard icon="shield" label="Administradores" value={String(admins)} tone="accent" />
        <StatCard icon="wallet" label="Financeiro" value={String(financeiro)} tone="success" />
        <StatCard icon="x" label="Acessos suspensos" value={String(suspended)} tone="warning" />
      </div>

      <Section
        title="Equipe interna"
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
                  <td><button className="icon-btn" style={{ width: 30, height: 30 }}><Icon name="ellipsis" size={15} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}
