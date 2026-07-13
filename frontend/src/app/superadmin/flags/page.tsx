import { PageHeader, Section, BackendNote } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { sampleFlags } from "../../../lib/sample";

export default function FlagsPage() {
  return (
    <>
      <PageHeader
        eyebrow="Plataforma · Configuração"
        title="Feature Flags"
        lead="Ligue ou desligue funcionalidades por escopo (global, plano ou tenant). A resolução mais específica vence."
        actions={<button className="btn btn-primary btn-sm"><Icon name="plus" /> Nova Flag</button>}
      />

      <Section title="Flags da plataforma" action={<BackendNote endpoint="/admin/feature-flags" />}>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Funcionalidade</th><th>Chave</th><th>Escopo</th><th>Estado</th></tr></thead>
            <tbody>
              {sampleFlags.map((f) => (
                <tr key={f.flag}>
                  <td className="strong">{f.label}</td>
                  <td><code className="text-xs subtle">{f.flag}</code></td>
                  <td><span className="badge badge-slate">{f.scope}</span></td>
                  <td>
                    <span
                      role="switch"
                      aria-checked={f.enabled}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        width: 42,
                        height: 24,
                        borderRadius: 999,
                        padding: 3,
                        background: f.enabled ? "var(--primary)" : "var(--border-strong)",
                        justifyContent: f.enabled ? "flex-end" : "flex-start",
                        transition: "all .2s ease",
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ width: 18, height: 18, borderRadius: 999, background: "#fff" }} />
                    </span>
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
