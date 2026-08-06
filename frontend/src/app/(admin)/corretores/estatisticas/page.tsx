import { PageHeader, StatCard, Section, EmptyState } from "../../../../components/ui";
import { BackendNotice } from "../../../../components/BackendNotice";
import { backendNotice, fetchBrokers, type Broker } from "../../../../lib/api";
import { formatPhone } from "../../../../lib/br-doc";

/** Percentual pt-BR: 10 → "10,00%". */
function pct(n: number): string {
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/**
 * Estatísticas de Corretores — indicadores derivados do cadastro real de
 * corretores parceiros (/v1/brokers). Métricas de performance (negócios,
 * conversão, comissão paga) virão quando os corretores forem vinculados a
 * imóveis/contratos; por ora, os números refletem só o cadastro.
 */
export default async function CorretoresEstatisticasPage() {
  const live = await fetchBrokers();
  const brokers: Broker[] = live ?? [];
  const notice = backendNotice();
  const isLive = live !== null;

  const count = brokers.length;
  const avgCommission = count ? brokers.reduce((s, b) => s + b.commissionPercent, 0) / count : 0;
  const maxCommission = count ? Math.max(...brokers.map((b) => b.commissionPercent)) : 0;
  const cities = new Set(brokers.map((b) => b.city).filter(Boolean)).size;

  // Ordena por comissão (maior primeiro); empate mantém a ordem alfabética do backend.
  const ranked = [...brokers].sort((a, b) => b.commissionPercent - a.commissionPercent);

  return (
    <>
      <PageHeader title="Estatísticas de Corretores" backHref="/corretores" />

      <div className="grid grid-4 mb-4">
        <StatCard icon="broker" label="Corretores Cadastrados" value={String(count)} tone="blue" />
        <StatCard icon="receipt" label="Comissão Média" value={count ? pct(avgCommission) : "—"} tone="accent" />
        <StatCard icon="trendingUp" label="Maior Comissão" value={count ? pct(maxCommission) : "—"} tone="success" />
        <StatCard icon="mapPin" label="Cidades Atendidas" value={String(cities)} tone="warning" />
      </div>

      <Section title="Corretores · por Comissão">
        {ranked.length === 0 ? (
          <EmptyState
            icon="broker"
            title={isLive ? "Nenhum corretor cadastrado" : "Não foi possível carregar"}
            hint={
              isLive
                ? "Cadastre corretores no card “Cadastro de Corretores” para ver os indicadores."
                : (notice ?? undefined)
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Corretor</th>
                  <th>Cidade</th>
                  <th>Celular</th>
                  <th style={{ textAlign: "right" }}>Comissão</th>
                </tr>
              </thead>
              <tbody>
                {ranked.map((b, i) => (
                  <tr key={b.id}>
                    <td>
                      <span className="num" style={{ color: i === 0 ? "var(--primary)" : "var(--muted)" }}>
                        {i + 1}º
                      </span>
                    </td>
                    <td className="strong">{b.name}</td>
                    <td className="text-sm subtle">
                      {b.city ?? "—"}{b.state ? ` · ${b.state}` : ""}
                    </td>
                    <td className="text-sm tabular">{b.mobile ? formatPhone(b.mobile) : "—"}</td>
                    <td className="strong num" style={{ textAlign: "right" }}>{pct(b.commissionPercent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {!isLive && (
        <p className="text-xs subtle mt-4">
          <BackendNotice message={notice} />
        </p>
      )}
    </>
  );
}
