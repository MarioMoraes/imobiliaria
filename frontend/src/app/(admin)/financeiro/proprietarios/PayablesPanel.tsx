"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../../components/Icon";
import { StatusBadge } from "../../../../components/ui";
// Só o TIPO vem de lib/api (apagado na compilação). Importar um VALOR de lá
// puxaria o Clerk server para o bundle do client — ver lib/format.ts.
import type { Payable } from "../../../../lib/api";
import { formatDay as dateBr, formatPrice } from "../../../../lib/format";
import {
  cancelPayableAction,
  generatePayoutsAction,
  settlePayableAction,
  syncTransferAction,
  transferPayoutAction,
} from "../actions";

/** Repasse em aberto com vencimento passado é exibido como vencido. */
function displayStatus(p: Payable, today: string): string {
  return p.status === "ABERTO" && p.dueDate < today ? "VENCIDO" : p.status;
}

/**
 * Baixa em dois passos: o clique abre a **data do pagamento** (hoje por padrão)
 * e o ✓ confirma.
 *
 * O passo extra existe pelo mesmo motivo da baixa do aluguel: o repasse costuma
 * ser registrado depois de feito, e é essa data que decide em que mês a saída
 * entra no caixa. Sem ela, todo acerto retroativo viraria despesa do dia do
 * clique.
 */
function SettleButton({
  payable,
  today,
  disabled,
  onSettle,
}: {
  payable: Payable;
  today: string;
  disabled: boolean;
  onSettle: (id: string, paidAt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [paidAt, setPaidAt] = useState(today);

  if (!open) {
    return (
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        Dar baixa
      </button>
    );
  }

  return (
    <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
      <input
        className="input input-sm"
        type="date"
        value={paidAt}
        max={today}
        autoFocus
        onChange={(e) => setPaidAt(e.target.value)}
        aria-label={`Data do repasse a ${payable.payeeName ?? "proprietário"}`}
      />
      <button
        className="icon-btn"
        style={{ width: 30, height: 30 }}
        type="button"
        disabled={disabled || !paidAt}
        onClick={() => onSettle(payable.id, paidAt)}
        aria-label="Confirmar baixa"
        title="Confirmar o repasse nesta data"
      >
        <Icon name="check" size={15} />
      </button>
      <button
        className="icon-btn"
        style={{ width: 30, height: 30 }}
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Cancelar baixa"
      >
        <Icon name="x" size={15} />
      </button>
    </div>
  );
}

/**
 * Lista de repasses aos proprietários.
 *
 * Cada linha é o crédito de um dono por um aluguel recebido: bruto (a parte dele
 * no aluguel), taxa de administração retida e líquido a pagar. Imóvel com mais
 * de um dono rende uma linha por dono, rateada pela participação.
 */
export function PayablesPanel({
  payables,
  live,
  month,
}: {
  payables: Payable[];
  live: boolean;
  /** Competência exibida (YYYY-MM) — é a do relatório em PDF. */
  month: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  function settle(id: string, paidAt: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await settlePayableAction(id, paidAt);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível dar baixa no repasse.");
        return;
      }
      router.refresh();
    });
  }

  function cancel(id: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await cancelPayableAction(id);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível cancelar o repasse.");
        return;
      }
      router.refresh();
    });
  }

  function transfer(id: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await transferPayoutAction(id);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível enviar o pagamento.");
        return;
      }
      setNotice(
        "Pagamento enviado ao Asaas. O repasse fica em Processando até o banco confirmar.",
      );
      router.refresh();
    });
  }

  function syncTransfer(id: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await syncTransferAction(id);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível consultar o pagamento.");
        return;
      }
      router.refresh();
    });
  }

  function generate() {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await generatePayoutsAction();
      if (!res.ok) {
        setError(res.error ?? "Não foi possível gerar os repasses pendentes.");
        return;
      }
      setNotice(
        res.created
          ? `${res.created} repasse(s) gerado(s).`
          : "Nenhum repasse novo — todo aluguel pago já está lançado.",
      );
      router.refresh();
    });
  }

  const sum = (list: Payable[], pick: (p: Payable) => number): number =>
    list.reduce((total, p) => total + pick(p), 0);
  const abertos = payables.filter((p) => p.status === "ABERTO" || p.status === "VENCIDO");
  const pagos = payables.filter((p) => p.status === "PAGO");

  return (
    <div className="stack" style={{ gap: 14 }}>
      {/* Avisos ACIMA da tabela: no rodapé de uma lista longa a mensagem nasce
          fora da área visível e o clique parece não ter feito nada. */}
      {error && (
        <div
          className="badge badge-red"
          style={{ alignItems: "flex-start", whiteSpace: "normal", textAlign: "left" }}
        >
          <Icon name="x" size={13} /> {error}
        </div>
      )}
      {notice && (
        <div className="badge badge-green" style={{ whiteSpace: "normal", textAlign: "left" }}>
          <Icon name="check" size={13} /> {notice}
        </div>
      )}

      {payables.length === 0 ? (
        <p className="text-sm subtle" style={{ padding: "8px 0" }}>
          Os repasses nascem sozinhos quando um aluguel recebe baixa: o sistema
          identifica os donos do imóvel e credita o valor do aluguel menos a taxa
          de administração do contrato, vencendo no mês seguinte no dia do
          proprietário.
        </p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Proprietário</th>
                <th style={{ width: 90 }}>Imóvel</th>
                <th style={{ width: 110 }}>Competência</th>
                <th style={{ width: 120 }}>Líquido</th>
                <th style={{ width: 120 }}>Vencimento</th>
                <th style={{ width: 120 }}>Situação</th>
                <th style={{ width: 210 }} />
              </tr>
            </thead>
            <tbody>
              {payables.map((p) => (
                <tr key={p.id}>
                  <td className="strong">
                    {p.payeeName ?? "—"}
                    {/* A participação só informa quando o imóvel é dividido. */}
                    {p.sharePercent < 100 && (
                      <span className="text-xs subtle"> · {p.sharePercent}%</span>
                    )}
                  </td>
                  <td className="text-sm tabular">{p.propertyCode ?? "—"}</td>
                  <td className="text-sm tabular">{p.competence ?? "—"}</td>
                  <td className="strong tabular">{formatPrice(p.amountCents)}</td>
                  <td className="text-sm subtle tabular">{dateBr(p.dueDate)}</td>
                  <td>
                    <StatusBadge status={displayStatus(p, today)} />
                    {/* Recusa do banco: o repasse volta a "em aberto", então sem
                        o motivo aqui o operador reenviaria com a mesma chave. */}
                    {p.transferFailedReason && (
                      <div
                        className="text-xs"
                        style={{ color: "var(--danger)", marginTop: 4, whiteSpace: "normal" }}
                      >
                        {p.transferFailedReason}
                      </div>
                    )}
                  </td>
                  <td>
                    <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
                      {p.status === "PROCESSANDO" ? (
                        // Já enviado ao banco: a única ação é perguntar o desfecho.
                        <button
                          className="btn btn-ghost btn-sm"
                          type="button"
                          disabled={pending || !live}
                          onClick={() => syncTransfer(p.id)}
                          title="Consultar o Asaas e atualizar a situação deste pagamento"
                        >
                          <Icon
                            name={pending ? "loader" : "refresh"}
                            className={pending ? "spin" : undefined}
                            size={14}
                          />{" "}
                          Atualizar
                        </button>
                      ) : p.status === "ABERTO" || p.status === "VENCIDO" ? (
                        <>
                          <button
                            className="btn btn-primary btn-sm"
                            type="button"
                            disabled={pending || !live}
                            onClick={() => transfer(p.id)}
                            title="Enviar o repasse por PIX para a chave do proprietário (Asaas)"
                          >
                            <Icon name="banknote" size={14} /> Gerar pagamento
                          </button>
                          <SettleButton
                            payable={p}
                            today={today}
                            disabled={pending || !live}
                            onSettle={settle}
                          />
                          <button
                            className="icon-btn"
                            style={{ width: 30, height: 30 }}
                            type="button"
                            disabled={pending || !live}
                            onClick={() => cancel(p.id)}
                            aria-label={`Cancelar repasse a ${p.payeeName ?? "proprietário"}`}
                            title="Cancelar este repasse"
                          >
                            <Icon name="x" size={15} />
                          </button>
                        </>
                      ) : (
                        <span className="text-xs subtle">{p.paidAt ? dateBr(p.paidAt) : ""}</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Os colSpan têm que somar as 7 colunas do thead. */}
            <tfoot className="table-total">
              <tr>
                <td colSpan={3}>
                  {payables.length} repasse(s) · {pagos.length} pago(s) · {abertos.length} em aberto
                </td>
                <td className="tabular">{formatPrice(sum(payables, (p) => p.amountCents))}</td>
                <td colSpan={3} className="text-xs">
                  A pagar {formatPrice(sum(abertos, (p) => p.amountCents))} · pago{" "}
                  {formatPrice(sum(pagos, (p) => p.amountCents))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        {!live && (
          <span className="badge badge-red">
            <Icon name="x" size={13} /> Backend offline
          </span>
        )}
        <div className="row gap-8" style={{ marginLeft: "auto" }}>
          {/* Link, e não botão com fetch: o resultado é um ARQUIVO, então o PDF
              abre no visualizador nativo sem esbarrar no bloqueador de pop-up. */}
          <a
            className="btn btn-outline btn-sm"
            href={`/financeiro/proprietarios/relatorio?mes=${month}`}
            target="_blank"
            rel="noopener"
            title="Abre o relatório da competência em PDF, com bruto, taxa de administração e subtotal por proprietário."
          >
            <Icon name="printer" size={14} /> Relatório de Repasses
          </a>
          <button
            className="btn btn-outline btn-sm"
            type="button"
            onClick={generate}
            disabled={pending || !live}
            title="Gera os repasses de aluguéis já pagos que ficaram sem lançamento (não duplica)."
          >
            <Icon
              name={pending ? "loader" : "refresh"}
              className={pending ? "spin" : undefined}
              size={14}
            />
            {pending ? " Gerando…" : " Gerar repasses pendentes"}
          </button>
        </div>
      </div>
    </div>
  );
}
