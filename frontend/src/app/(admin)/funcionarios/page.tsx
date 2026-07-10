import { PageHeader, StatCard, Section, StatusBadge, BackendNote } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { sampleEmployees } from "../../../lib/sample";

export default function FuncionariosPage() {
  return (
    <>
      <PageHeader
        eyebrow="Cadastros · Módulo 7.5"
        title="Funcionários"
        lead="Colaboradores internos, cargos e permissões (RBAC). Foco em identidade e acesso — não folha de pagamento."
        actions={<button className="btn btn-primary btn-sm"><Icon name="plus" /> Convidar membro</button>}
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="users" label="Colaboradores ativos" value="11" tone="blue" />
        <StatCard icon="shield" label="Administradores" value="2" tone="accent" />
        <StatCard icon="wallet" label="Financeiro" value="3" tone="success" />
        <StatCard icon="x" label="Acessos suspensos" value="1" tone="warning" />
      </div>

      <Section title="Equipe interna" action={<BackendNote endpoint="/v1/employees" />}>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Colaborador</th><th>Cargo</th><th>Papéis (RBAC)</th><th>Acesso</th><th></th></tr>
            </thead>
            <tbody>
              {sampleEmployees.map((e) => (
                <tr key={e.id}>
                  <td>
                    <div className="cell-main">
                      <span className="avatar" style={{ width: 34, height: 34, fontSize: "0.72rem" }}>
                        {e.name.slice(0, 2).toUpperCase()}
                      </span>
                      <span className="strong">{e.name}</span>
                    </div>
                  </td>
                  <td>{e.role}</td>
                  <td>
                    <div className="row gap-8 wrap">
                      {e.roles.map((r) => <span key={r} className="badge badge-blue">{r}</span>)}
                    </div>
                  </td>
                  <td>
                    <StatusBadge status={e.access === "active" ? "active" : "suspended"} />
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
