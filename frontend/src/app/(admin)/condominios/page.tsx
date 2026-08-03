import Link from "next/link";
import { PageHeader, Section, EmptyState } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { BackendNotice } from "../../../components/BackendNotice";
import {
  backendNotice,
  fetchCondominiums,
  formatPrice,
  type Condominium,
} from "../../../lib/api";
import { CondominiumFormButton } from "./CondominiumFormButton";
import { DeleteCondominiumButton } from "./DeleteCondominiumButton";

/** Formata percentual (0–100) no padrão pt-BR: 10 → "10,00%". */
function formatPercent(n: number): string {
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/**
 * Listagem dos condomínios — só cadastro: criar, editar, excluir e ABRIR.
 *
 * Tudo que se faz *dentro* de um condomínio (condôminos, despesas, cobrança)
 * mora no condomínio aberto. Enquanto a cobrança tinha um card aqui, ela pedia
 * o condomínio de novo logo depois, e a tela dava a entender que existiam dois
 * módulos separados.
 */
export default async function CondominiosPage() {
  const live = await fetchCondominiums();
  const condominiums: Condominium[] = live ?? [];
  const notice = backendNotice();
  const isLive = live !== null;

  return (
    <>
      <PageHeader
        title="Condomínios"
        actions={isLive ? <CondominiumFormButton /> : undefined}
      />

      <div className="mt-4">
        <Section title="Cadastro de Condomínios">
          {condominiums.length === 0 ? (
            <div className="card-pad">
              <EmptyState
                icon="home"
                title={isLive ? "Nenhum condomínio cadastrado" : "Não foi possível carregar"}
                hint={
                  isLive
                    ? "Cadastre o primeiro condomínio administrado pela imobiliária."
                    : (notice ?? undefined)
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
                      <td style={{ textAlign: "right" }} className="strong">{formatPrice(c.balanceCents)}</td>
                      <td>
                        <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
                          {/* Botão com rótulo, não um ícone: o prédio dizia
                              "Condôminos" e escondia que dali também se lançam
                              despesas e se gera a cobrança. */}
                          <Link
                            href={`/condominios/${c.id}`}
                            className="btn btn-outline btn-sm"
                            title="Condôminos, despesas e cobrança deste condomínio"
                            aria-label={`Abrir ${c.name}`}
                          >
                            <span>Abrir</span> <Icon name="arrowRight" size={14} />
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
          <BackendNotice message={notice} />
        </p>
      )}
    </>
  );
}
