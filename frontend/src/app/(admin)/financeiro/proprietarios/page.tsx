import Link from "next/link";
import { Icon } from "../../../../components/Icon";
import { PageHeader, Section, StatCard } from "../../../../components/ui";
import {
  backendNotice,
  fetchPayableSummary,
  fetchPayables,
  formatPrice,
} from "../../../../lib/api";
import { PayablesPanel } from "./PayablesPanel";

const monthNames = [
  "janeiro", "fevereiro", "março", "abril", "maio", "junho",
  "julho", "agosto", "setembro", "outubro", "novembro", "dezembro",
];

/** "2026-07" → "julho/2026". */
function monthTitle(month: string): string {
  const index = Number(month.slice(5, 7)) - 1;
  return `${monthNames[index] ?? month}/${month.slice(0, 4)}`;
}

/** "2026-12" + 1 → "2027-01". Vira o ano sozinho. */
function shiftMonth(month: string, delta: number): string {
  const year = Number(month.slice(0, 4));
  const index = Number(month.slice(5, 7)) - 1 + delta;
  return new Date(Date.UTC(year, index, 1)).toISOString().slice(0, 7);
}

/**
 * Navegação de mês. Sem ela o filtro `?mes=` só se alcançava digitando a URL —
 * e como o repasse vence no mês SEGUINTE ao pagamento, quem dava a baixa ficava
 * olhando um mês vazio, sem caminho até o mês em que o repasse existe.
 */
function MonthNav({ month }: { month: string }) {
  return (
    <div className="row gap-8" style={{ alignItems: "center" }}>
      <Link
        className="icon-btn"
        style={{ width: 28, height: 28 }}
        href={`/financeiro/proprietarios?mes=${shiftMonth(month, -1)}`}
        aria-label={`Ver ${monthTitle(shiftMonth(month, -1))}`}
        title={monthTitle(shiftMonth(month, -1))}
      >
        <Icon name="arrowLeft" size={14} />
      </Link>
      {/* "Vencem em" e não só o mês: a coluna Competência mostra outro mês
          (o do aluguel de origem), e sem o rótulo os dois se confundem. */}
      <span className="badge badge-blue">Vencem em {monthTitle(month)}</span>
      <Link
        className="icon-btn"
        style={{ width: 28, height: 28 }}
        href={`/financeiro/proprietarios?mes=${shiftMonth(month, 1)}`}
        aria-label={`Ver ${monthTitle(shiftMonth(month, 1))}`}
        title={monthTitle(shiftMonth(month, 1))}
      >
        <Icon name="arrowRight" size={14} />
      </Link>
    </div>
  );
}

/**
 * Pagamento de proprietários (repasse).
 *
 * Cada aluguel baixado credita os donos do imóvel com o valor da parcela menos a
 * taxa de administração do contrato; a taxa retida é a receita da imobiliária.
 * O vencimento cai no mês seguinte ao pagamento, no "Dia Prop" do contrato.
 *
 * O mês da tela é o de **VENCIMENTO**, não o da competência do aluguel: quem
 * abre esta página quer saber o que tem a pagar no mês. Um aluguel de julho pago
 * em julho vira repasse vencendo em agosto, e é em agosto que ele aparece aqui.
 *
 * O filtro vem da URL (`?mes=`) e não de estado no client — é o padrão das
 * listagens do projeto, e mantém o link compartilhável.
 */
export default async function PagamentoProprietariosPage({
  searchParams,
}: {
  searchParams: Promise<{ mes?: string }>;
}) {
  const { mes } = await searchParams;
  const currentMonth = new Date().toISOString().slice(0, 7);
  const month = /^\d{4}-\d{2}$/.test(mes ?? "") ? mes! : currentMonth;

  // O resumo é agregado no backend (a listagem tem limite; somar a página faria
  // os cards mentirem conforme a carteira cresce). `null` = backend fora do ar.
  const [payables, summary] = await Promise.all([
    fetchPayables({ dueMonth: month }),
    fetchPayableSummary(month),
  ]);
  const live = payables !== null && summary !== null;

  // Mês vazio não quer dizer "não há repasse": o vencimento cai no mês seguinte
  // ao pagamento, então a baixa de hoje aparece só na virada. Sem este ponteiro
  // o operador dá a baixa, não vê nada e conclui que o repasse não foi gerado —
  // foi o que motivou o achado. A busca só roda quando a lista veio vazia.
  const elsewhere =
    payables?.length === 0
      ? ((await fetchPayables({ status: "ABERTO", limit: 500 })) ?? [])
      : [];
  // Já vem ordenado por vencimento, então o primeiro é o mês mais próximo.
  const nextMonth = elsewhere.find((p) => p.dueDate.slice(0, 7) !== month)?.dueDate.slice(0, 7);
  const nextCount = nextMonth
    ? elsewhere.filter((p) => p.dueDate.slice(0, 7) === nextMonth).length
    : 0;

  return (
    <>
      <PageHeader title="Pagamento de Proprietários" backHref="/financeiro" />

      <div className="grid grid-4 mb-4">
        <StatCard
          icon="banknote"
          label="A pagar no mês"
          value={formatPrice(summary?.openCents ?? 0)}
          tone="accent"
        />
        <StatCard
          icon="wallet"
          label="Repassado no mês"
          value={formatPrice(summary?.paidCents ?? 0)}
          feature
        />
        <StatCard
          icon="receipt"
          label="Taxa de administração"
          value={formatPrice(summary?.adminFeeCents ?? 0)}
          tone="success"
        />
        <StatCard
          icon="trendingDown"
          label="Em atraso"
          value={formatPrice(summary?.overdueCents ?? 0)}
          trend={
            summary?.overdueCount
              ? `${summary.overdueCount} repasse(s)`
              : undefined
          }
          tone={summary?.overdueCents ? "warning" : "success"}
        />
      </div>

      <Section title="Repasses" action={<MonthNav month={month} />}>
        <div className="card-pad">
          <PayablesPanel
            payables={payables ?? []}
            live={live}
            failureNotice={backendNotice()}
            month={month}
            elsewhere={
              nextMonth ? { month: nextMonth, label: monthTitle(nextMonth), count: nextCount } : null
            }
          />
        </div>
      </Section>
    </>
  );
}
