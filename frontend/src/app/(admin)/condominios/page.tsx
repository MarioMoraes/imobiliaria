import Link from "next/link";
import { PageHeader, StatCard, Section, EmptyState } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { fetchCondominiums, formatPrice, type Condominium } from "../../../lib/api";
import { CondominiumFormButton } from "./CondominiumFormButton";
import { DeleteCondominiumButton } from "./DeleteCondominiumButton";

/** Formata percentual (0–100) no padrão pt-BR: 10 → "10,00%". */
function formatPercent(n: number): string {
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

export default async function CondominiosPage() {
  const live = await fetchCondominiums();
  const condominiums: Condominium[] = live ?? [];
  const isLive = live !== null;

  const totalBalance = condominiums.reduce((sum, c) => sum + c.balanceCents, 0);

  return (
    <>
      <PageHeader
        title="Condomínios"
        actions={isLive ? <CondominiumFormButton /> : undefined}
      />

      <div className="grid grid-3 mb-4">
        <StatCard icon="home" label="Condomínios" value={String(condominiums.length)} tone="blue" />
        <StatCard icon="wallet" label="Saldo consolidado" value={formatPrice(totalBalance)} tone="success" />
        <StatCard
          icon="receipt"
          label="Taxa adm. média"
          value={
            condominiums.length
              ? formatPercent(
                  condominiums.reduce((s, c) => s + c.adminFeePercent, 0) / condominiums.length,
                )
              : "—"
          }
          tone="accent"
        />
      </div>

      <div className="mt-4">
        <Section title="Cadastro de Condomínios">
          {condominiums.length === 0 ? (
            <div className="card-pad">
              <EmptyState
                icon="home"
                title={isLive ? "Nenhum condomínio cadastrado" : "Backend offline"}
                hint={
                  isLive
                    ? "Cadastre o primeiro condomínio administrado pela imobiliária."
                    : "Suba a infra (npm run dev) para carregar e gravar os condomínios."
                }
                action={isLive ? <CondominiumFormButton /> : undefined}
              />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Condomínio</th>
                    <th>Endereço</th>
                    <th>Cidade</th>
                    <th style={{ textAlign: "right" }}>Taxa Adm.</th>
                    <th style={{ textAlign: "right" }}>Juros / Multa</th>
                    <th style={{ textAlign: "right" }}>Saldo</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {condominiums.map((c) => (
                    <tr key={c.id}>
                      <td className="strong">{c.name}</td>
                      <td>
                        {c.address ? `${c.address}${c.number ? `, ${c.number}` : ""}` : "—"}
                        {c.district ? <span className="subtle text-xs"> · {c.district}</span> : null}
                      </td>
                      <td>{c.city ?? "—"}{c.state ? ` · ${c.state}` : ""}</td>
                      <td style={{ textAlign: "right" }}>
                        {formatPercent(c.adminFeePercent)}
                        {c.adminFeeFixedCents > 0 ? (
                          <span className="subtle text-xs"> + {formatPrice(c.adminFeeFixedCents)}</span>
                        ) : null}
                      </td>
                      <td style={{ textAlign: "right" }} className="text-sm">
                        {formatPercent(c.interestPercent)} / {formatPercent(c.penaltyPercent)}
                      </td>
                      <td style={{ textAlign: "right" }} className="strong">{formatPrice(c.balanceCents)}</td>
                      <td>
                        <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
                          <Link
                            href={`/condominios/${c.id}`}
                            className="icon-btn"
                            style={{ width: 30, height: 30 }}
                            title="Condôminos (imóveis do condomínio)"
                            aria-label={`Condôminos de ${c.name}`}
                          >
                            <Icon name="building" size={15} />
                          </Link>
                          <CondominiumFormButton condominium={c} />
                          <DeleteCondominiumButton id={c.id} name={c.name} disabled={!isLive} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      </div>

      {!isLive && (
        <p className="text-xs subtle mt-4">
          <Icon name="server" size={12} /> Backend offline — suba <code>npm run dev</code> para gravar.
        </p>
      )}
    </>
  );
}
