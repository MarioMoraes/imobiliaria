import { formatPrice } from "../../../../lib/format";
import type { CashFlowSummary } from "../../../../lib/api";

/**
 * A composição do resultado da imobiliária no mês — o que substituiu o "DRE
 * simplificado" que era um array de números escritos à mão.
 *
 * Todas as linhas vêm da mesma apuração que alimenta o extrato, então elas
 * fecham com ele por construção. A nota do rodapé existe porque a pergunta
 * aparece toda vez: por que o saldo de caixa é maior que o resultado.
 */
export function ResultBreakdown({ summary }: { summary: CashFlowSummary | null }) {
  if (!summary) {
    return (
      <p className="text-sm subtle">
        Sem apuração para este mês. O resultado se forma quando um aluguel recebe
        baixa (taxa de administração) ou uma comissão é quitada.
      </p>
    );
  }

  const linhas: Array<[string, number, boolean]> = [
    ["Taxa de Administração", summary.adminFeeCents, false],
    ["Juros e Multa de Atraso", summary.lateFeeCents, false],
    ["Comissão de Venda", summary.commissionEarnedCents, false],
    ["Outras Receitas", summary.manualIncomeCents, false],
    ["(−) Comissão de Corretor", -summary.commissionPaidCents, false],
    ["(−) Despesas", -summary.manualExpenseCents, false],
    ["Resultado do Mês", summary.result.netCents, true],
  ];

  return (
    <div className="stack" style={{ gap: 12 }}>
      {linhas.map(([label, value, destaque], i) => (
        <div
          key={label}
          className="row-between"
          style={{
            paddingBottom: 8,
            borderBottom: i < linhas.length - 1 ? "1px solid var(--border)" : "none",
          }}
        >
          <span className={destaque ? "strong" : "subtle text-sm"}>{label}</span>
          <span
            className={destaque ? "num gradient-text" : "strong text-sm num"}
            style={destaque ? { fontSize: "1.05rem" } : undefined}
          >
            {formatPrice(value)}
          </span>
        </div>
      ))}

      <div className="stack" style={{ gap: 6 }}>
        <div className="row-between">
          <span className="subtle text-sm">Saldo de Caixa no Mês</span>
          <span className="strong text-sm num">{formatPrice(summary.cash.netCents)}</span>
        </div>
        <p className="text-xs subtle">
          O saldo de caixa inclui o aluguel que passou pela conta e ainda será
          repassado ({formatPrice(summary.pendingPayoutCents)} em aberto). Esse
          dinheiro não é receita — por isso ele não entra no resultado.
        </p>
      </div>
    </div>
  );
}
