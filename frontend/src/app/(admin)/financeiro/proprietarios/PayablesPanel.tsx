"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GENERIC_BACKEND_NOTICE } from "../../../../components/BackendNotice";
import { Icon } from "../../../../components/Icon";
import { StatusBadge } from "../../../../components/ui";
// Só o TIPO vem de lib/api (apagado na compilação). Importar um VALOR de lá
// puxaria o Clerk server para o bundle do client — ver lib/format.ts.
import type { Payable } from "../../../../lib/api";
import { formatDay as dateBr, formatPrice } from "../../../../lib/format";
import {
  generatePayoutsAction,
  settlePayableAction,
  syncTransferAction,
  transferPayoutAction,
  transferPayoutBatchAction,
} from "../actions";

/** Repasse em aberto com vencimento passado é exibido como vencido. */
function displayStatus(p: Payable, today: string): string {
  return p.status === "ABERTO" && p.dueDate < today ? "VENCIDO" : p.status;
}

/** URL do recibo em PDF (Route Handler que faz proxy autenticado do backend). */
const receiptHref = (ids: string[]): string =>
  `/financeiro/proprietarios/recibo?ids=${ids.join(",")}`;

/**
 * O que dá para fazer em lote com este lançamento — e é por isso que a seleção
 * é homogênea: `PAGAVEL` vira um PIX, `PAGO` vira um recibo. Repasse em trânsito
 * ou cancelado não entra em lote nenhum.
 */
function batchKind(p: Payable): "PAGAVEL" | "PAGO" | null {
  if (p.status === "ABERTO" || p.status === "VENCIDO") return "PAGAVEL";
  if (p.status === "PAGO") return "PAGO";
  return null;
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
        Dar Baixa
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
        aria-label="Confirmar Baixa"
        title="Confirmar o repasse nesta data"
      >
        <Icon name="check" size={15} />
      </button>
      <button
        className="icon-btn"
        style={{ width: 30, height: 30 }}
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Cancelar Baixa"
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
  failureNotice,
  month,
  elsewhere,
}: {
  payables: Payable[];
  live: boolean;
  /**
   * Por que não está `live` — vem do `backendNotice()` de quem renderiza.
   * Prefixado para não colidir com o `notice` de retorno das ações abaixo.
   */
  failureNotice?: string | null;
  /** Competência exibida (YYYY-MM) — é a do relatório em PDF. */
  month: string;
  /**
   * Repasses em aberto que existem FORA do mês exibido (o mais próximo). O mês
   * do repasse é o seguinte ao do pagamento, então a lista vazia é o caso comum
   * logo após uma baixa — e sem este ponteiro ela se lê como "não foi gerado".
   */
  elsewhere?: { month: string; label: string; count: number } | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const today = new Date().toISOString().slice(0, 10);

  /* ---------------------------------------------------------- Seleção */

  // A seleção é derivada da lista a cada render: um repasse que mudou de estado
  // (baixa, cancelamento) ou saiu do mês sai dela sozinho, sem estado órfão.
  const selected = payables.filter((p) => selectedIds.includes(p.id));
  // O primeiro escolhido define o grupo — proprietário e natureza do lote. É o
  // que impede um PIX para a chave errada e um recibo com dois donos.
  const anchor = selected[0] ?? null;
  const anchorKind = anchor ? batchKind(anchor) : null;

  function selectable(p: Payable): boolean {
    const kind = batchKind(p);
    if (!kind) return false;
    if (!anchor) return true;
    return p.payeePersonId === anchor.payeePersonId && kind === anchorKind;
  }

  function toggle(id: string): void {
    setError(null);
    setSelectedIds((current) =>
      current.includes(id) ? current.filter((x) => x !== id) : [...current, id],
    );
  }

  const clearSelection = (): void => setSelectedIds([]);
  const selectedTotal = selected.reduce((sum, p) => sum + p.amountCents, 0);

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

  /** Um PIX só para todos os selecionados (mesmo proprietário). */
  function transferSelected() {
    setError(null);
    setNotice(null);
    const ids = selected.map((p) => p.id);
    startTransition(async () => {
      const res = await transferPayoutBatchAction(ids);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível enviar o pagamento.");
        return;
      }
      setNotice(
        `Pagamento único de ${formatPrice(selectedTotal)} enviado ao Asaas para ${
          anchor?.payeeName ?? "o proprietário"
        }. Os ${ids.length} repasses ficam em Processando até o banco confirmar.`,
      );
      clearSelection();
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

      {/* Barra da seleção. Só aparece com algo marcado — a tela de quem não usa
          lote continua idêntica à de antes. */}
      {anchor && (
        <div
          className="row gap-8"
          style={{
            alignItems: "center",
            flexWrap: "wrap",
            border: "1px solid var(--border)",
            borderRadius: 8,
            padding: "8px 12px",
          }}
        >
          <span className="text-sm">
            <span className="strong">{selected.length} selecionado(s)</span> ·{" "}
            {anchor.payeeName ?? "proprietário"} ·{" "}
            <span className="strong tabular">{formatPrice(selectedTotal)}</span>
          </span>
          <div className="row gap-8" style={{ marginLeft: "auto" }}>
            {anchorKind === "PAGAVEL" ? (
              <button
                className="btn btn-primary btn-sm"
                type="button"
                disabled={pending || !live}
                onClick={transferSelected}
                title={
                  selected.length > 1
                    ? "Envia UM PIX com a soma dos repasses selecionados para a chave do proprietário"
                    : "Envia o repasse por PIX para a chave do proprietário (Asaas)"
                }
              >
                <Icon name="banknote" size={14} />{" "}
                {selected.length > 1 ? "Gerar um PIX único" : "Gerar pagamento"}
              </button>
            ) : (
              // Link, e não fetch: o resultado é um ARQUIVO — mesmo motivo do
              // relatório (abre no visualizador, sem bloqueador de pop-up).
              <a
                className="btn btn-primary btn-sm"
                href={receiptHref(selected.map((p) => p.id))}
                target="_blank"
                rel="noopener"
                title="Recibo em PDF com os lançamentos selecionados, para o proprietário assinar"
              >
                <Icon name="printer" size={14} /> Emitir Recibo
              </a>
            )}
            <button className="btn btn-ghost btn-sm" type="button" onClick={clearSelection}>
              Limpar
            </button>
          </div>
        </div>
      )}

      {payables.length === 0 ? (
        <div className="stack" style={{ gap: 8, padding: "8px 0" }}>
          <p className="text-sm subtle" style={{ margin: 0 }}>
            Os repasses nascem sozinhos quando um aluguel recebe baixa: o sistema
            identifica os donos do imóvel e credita o valor do aluguel menos a taxa
            de administração do contrato, vencendo no mês seguinte no dia do
            proprietário.
          </p>
          {elsewhere && (
            <div className="row gap-8" style={{ alignItems: "center" }}>
              <span className="text-sm">
                Há {elsewhere.count} repasse(s) em aberto vencendo em {elsewhere.label}.
              </span>
              <Link className="btn btn-outline btn-sm" href={`/financeiro/proprietarios?mes=${elsewhere.month}`}>
                Ver {elsewhere.label}
              </Link>
            </div>
          )}
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 34 }} />
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
                  <td>
                    {/* Marcar um lançamento trava o grupo: os de outro
                        proprietário (ou de outra natureza) ficam indisponíveis,
                        porque um PIX vai para uma chave e um recibo dá quitação
                        em nome de uma pessoa. */}
                    <input
                      type="checkbox"
                      checked={selectedIds.includes(p.id)}
                      disabled={!selectable(p)}
                      onChange={() => toggle(p.id)}
                      aria-label={`Selecionar repasse de ${p.payeeName ?? "proprietário"}${
                        p.competence ? ` · ${p.competence}` : ""
                      }`}
                      title={
                        selectable(p)
                          ? undefined
                          : anchor
                            ? "Só é possível agrupar repasses do mesmo proprietário e na mesma situação"
                            : "Repasse em processamento ou cancelado não entra em lote"
                      }
                    />
                  </td>
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
                            <Icon name="banknote" size={14} /> Gerar Pagamento
                          </button>
                          {/* O cancelar (X) saiu da linha por ora — a decisão de
                              se ele volta é para depois. A rota
                              `POST /v1/payables/:id/cancel` e a action continuam
                              de pé, então religar é devolver o botão. */}
                          <SettleButton
                            payable={p}
                            today={today}
                            disabled={pending || !live}
                            onSettle={settle}
                          />
                        </>
                      ) : p.status === "PAGO" ? (
                        <>
                          <span className="text-xs subtle">{p.paidAt ? dateBr(p.paidAt) : ""}</span>
                          {/* O recibo vale inclusive no PIX: o comprovante do
                              banco prova que saiu dinheiro, não de que ele é. */}
                          <a
                            className="btn btn-ghost btn-sm"
                            href={receiptHref([p.id])}
                            target="_blank"
                            rel="noopener"
                            title="Recibo em PDF deste repasse, para o proprietário assinar"
                          >
                            <Icon name="printer" size={14} /> Recibo
                          </a>
                        </>
                      ) : (
                        <span className="text-xs subtle">{p.paidAt ? dateBr(p.paidAt) : ""}</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Os colSpan têm que somar as 8 colunas do thead. */}
            <tfoot className="table-total">
              <tr>
                <td colSpan={4}>
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
            <Icon name="x" size={13} /> {failureNotice ?? GENERIC_BACKEND_NOTICE}
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
