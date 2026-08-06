import { PageHeader, StatCard, Section, StatusBadge } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { sampleHealth } from "../../../lib/sample";

const jobs = [
  { name: "rental.generate-cycles", schedule: "0 6 1 * *", last: "há 2 d", ok: true, dur: "12s" },
  { name: "dunning.run", schedule: "0 9 * * *", last: "hoje 09:00", ok: true, dur: "4s" },
  { name: "reservation.expire", schedule: "*/30 * * * *", last: "há 12 min", ok: true, dur: "1s" },
  { name: "publishing.audit", schedule: "0 * * * *", last: "há 40 min", ok: false, dur: "timeout" },
];

export default function SaudePage() {
  const allOk = sampleHealth.every((h) => h.status === "ok");
  return (
    <>
      <PageHeader
        title="Saúde da Plataforma"
        actions={
          allOk
            ? <span className="badge badge-green"><span className="dot" /> tudo operacional</span>
            : <span className="badge badge-amber">degradação parcial</span>
        }
      />

      <div className="grid grid-4 mb-4">
        <StatCard icon="activity" label="Uptime (30d)" value="99,96%" tone="success" />
        <StatCard icon="server" label="Componentes OK" value="5 / 6" tone="blue" />
        <StatCard icon="gauge" label="Latência p95" value="180 ms" tone="accent" />
        <StatCard icon="clock" label="Jobs com Falha (24h)" value="1" tone="warning" />
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Section title="Dependências" pad>
          <div className="stack" style={{ gap: 12 }}>
            {sampleHealth.map((h) => (
              <div key={h.name} className="row-between" style={{ paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
                <span className="row gap-8">
                  <span className="stat-icon" style={{ width: 32, height: 32, marginBottom: 0 }}><Icon name="server" size={15} /></span>
                  <span className="strong text-sm">{h.name}</span>
                </span>
                <div className="row gap-8">
                  <span className="text-xs subtle">{h.latency}</span>
                  <StatusBadge status={h.status} />
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Jobs Agendados (Cron)" pad>
          <div className="stack" style={{ gap: 12 }}>
            {jobs.map((j) => (
              <div key={j.name} className="row-between" style={{ paddingBottom: 10, borderBottom: "1px solid var(--border)" }}>
                <span>
                  <span className="strong text-sm" style={{ display: "block", fontFamily: "var(--font-inter)" }}>{j.name}</span>
                  <span className="text-xs subtle">{j.schedule} · última: {j.last} · {j.dur}</span>
                </span>
                {j.ok
                  ? <span className="badge badge-green"><Icon name="check" size={12} /> ok</span>
                  : <span className="badge badge-red"><Icon name="x" size={12} /> falha</span>}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
