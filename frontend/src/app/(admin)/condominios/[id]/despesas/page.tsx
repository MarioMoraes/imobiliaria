import { notFound } from "next/navigation";
import { PageHeader, StatCard, Section, EmptyState } from "../../../../../components/ui";
import { BackendNotice } from "../../../../../components/BackendNotice";
import {
  backendNotice,
  fetchCondominium,
  fetchCondominiumExpenses,
  fetchEvents,
  formatDay,
  formatPrice,
  type CondominiumExpense,
} from "../../../../../lib/api";
import { ExpenseFormButton } from "./ExpenseFormButton";
import { DeleteExpenseButton } from "./DeleteExpenseButton";

export default async function DespesasPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [condominium, live, events] = await Promise.all([
    fetchCondominium(id),
    fetchCondominiumExpenses(id),
    fetchEvents(),
  ]);

  // Condomínio inexistente (ou id inválido) com backend no ar → 404.
  if (condominium === null && live !== null) notFound();

  const expenses: CondominiumExpense[] = live ?? [];
  const notice = backendNotice();
  const isLive = live !== null;
  const total = expenses.reduce((sum, e) => sum + e.amountCents, 0);

  const addButton =
    isLive && condominium ? (
      <ExpenseFormButton
        condominiumId={id}
        condominiumName={condominium.name}
        events={events ?? []}
      />
    ) : undefined;

  return (
    <>
      <PageHeader
        title={condominium ? `Despesas · ${condominium.name}` : "Despesas"}
        backHref={`/condominios/${id}`}
        actions={addButton}
      />

      <div className="grid grid-2 mb-4">
        <StatCard icon="receipt" label="Lançamentos" value={String(expenses.length)} tone="blue" />
        <StatCard icon="wallet" label="Total lançado" value={formatPrice(total)} tone="accent" />
      </div>

      <div className="mt-4">
        <Section title="Despesas">
          {expenses.length === 0 ? (
            <div className="card-pad">
              <EmptyState
                icon="receipt"
                title={isLive ? "Nenhuma despesa lançada" : "Não foi possível carregar"}
                hint={
                  isLive
                    ? "Lance a primeira despesa deste condomínio."
                    : (notice ?? undefined)
                }
                action={addButton}
              />
            </div>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ textAlign: "right" }}>Lancto nº</th>
                    <th>Data</th>
                    <th>Evento</th>
                    <th>Histórico</th>
                    <th style={{ textAlign: "right" }}>Valor</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e) => (
                    <tr key={e.id}>
                      <td style={{ textAlign: "right" }} className="strong num">
                        {e.seq ?? "—"}
                      </td>
                      <td className="text-sm subtle">{formatDay(e.entryDate)}</td>
                      <td>{e.eventName ?? "—"}</td>
                      <td className="text-sm">{e.notes ?? "—"}</td>
                      <td style={{ textAlign: "right" }} className="strong">
                        {formatPrice(e.amountCents)}
                      </td>
                      <td>
                        <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
                          <ExpenseFormButton
                            condominiumId={id}
                            condominiumName={condominium?.name ?? ""}
                            events={events ?? []}
                            expense={e}
                          />
                          <DeleteExpenseButton
                            condominiumId={id}
                            expenseId={e.id}
                            label={`nº ${e.seq ?? ""}`.trim()}
                          />
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
