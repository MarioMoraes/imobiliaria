import { PageHeader, StatCard, Section, StatusBadge } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { sampleAppointments } from "../../../lib/sample";

const typeBadge: Record<string, string> = {
  Visita: "badge-blue",
  Vistoria: "badge-cyan",
  Reunião: "badge-slate",
};

export default function AgendaPage() {
  return (
    <>
      <PageHeader
        title="Agenda"
        actions={
          <>
            <button className="btn btn-outline btn-sm"><Icon name="calendar" /> Semana</button>
            <button className="btn btn-primary btn-sm"><Icon name="plus" /> Agendar</button>
          </>
        }
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="calendar" label="Eventos Hoje" value="5" tone="blue" />
        <StatCard icon="check" label="Confirmados" value="3" tone="success" />
        <StatCard icon="clock" label="Aguardando Confirmação" value="2" tone="warning" />
        <StatCard icon="x" label="No-show (Mês)" value="4%" tone="accent" />
      </div>

      <Section title="Hoje · Quinta, 10 de Julho">
        <div className="card-pad timeline">
          {sampleAppointments.map((a, i) => (
            <div className="timeline-item" key={i}>
              <div className="row-between wrap">
                <div className="row gap-8">
                  <span className="num" style={{ fontSize: "0.95rem", color: "var(--dark)" }}>{a.time}</span>
                  <span className={`badge ${typeBadge[a.type]}`}>{a.type}</span>
                  <span className="strong text-sm">{a.title}</span>
                </div>
                <div className="row gap-8">
                  <span className="text-xs subtle">{a.broker}</span>
                  <StatusBadge status={a.status === "confirmed" ? "vigente" : "pending"} label={a.status === "confirmed" ? "Confirmado" : "Pendente"} />
                </div>
              </div>
            </div>
          ))}
        </div>
      </Section>
    </>
  );
}
