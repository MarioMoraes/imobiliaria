"use client";

import { useState, useTransition } from "react";
import { Section, EmptyState, StatCard } from "../../../../../components/ui";
import { Icon } from "../../../../../components/Icon";
import { BackendNotice } from "../../../../../components/BackendNotice";
import { useConfirm } from "../../../../../components/ConfirmDialog";
import { useToast } from "../../../../../components/Toast";
import { formatDay, formatPrice } from "../../../../../lib/format";
import {
  firstDayOfMonth,
  lastDayOfMonth,
  payerLabel,
  payerTone,
} from "../../../../../lib/condo-billing";
import type { CondoBillingPreview } from "../../../../../lib/api";
import {
  generateBillingAction,
  previewBillingAction,
  type BillingFormInput,
} from "./actions";

/** Vencimento sugerido: dia 10 do mês seguinte ao início do período. */
function suggestedDueDate(periodStart: string): string {
  const [y, m] = periodStart.split("-").map(Number) as [number, number];
  const next = new Date(y, m, 10); // mês é 0-based: `m` já é o mês SEGUINTE
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-10`;
}

function emptyForm(condominiumId: string): BillingFormInput {
  const periodStart = firstDayOfMonth();
  return {
    condominiumId,
    periodStart,
    periodEnd: lastDayOfMonth(),
    dueDate: suggestedDueDate(periodStart),
  };
}

/**
 * Formulário + prévia da cobrança. Dois passos de propósito: Calcular mostra o
 * que seria gerado (quem paga, quanto, o que já foi cobrado) e só então Gerar
 * grava. Um lote de contas a receber emitido no período errado dá muito mais
 * trabalho para desfazer do que uma conferência dá para fazer.
 *
 * Só importa TIPO de `lib/api` (`import type`): aquele módulo é server-only.
 */
export function CobrancaPanel({
  condominiumId,
  notice,
}: {
  /** Vem do caminho — o condomínio não se escolhe aqui. */
  condominiumId: string;
  notice: string | null;
}) {
  const confirm = useConfirm();
  const toast = useToast();
  const [, startTransition] = useTransition();
  const [form, setForm] = useState<BillingFormInput>(() => emptyForm(condominiumId));
  const [preview, setPreview] = useState<CondoBillingPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Qual ação está rodando. Um `pending` só faria os dois botões anunciarem
  // trabalho ao mesmo tempo ("Calculando…" e "Gerando…" juntos).
  const [busy, setBusy] = useState<"preview" | "generate" | null>(null);

  // Qualquer mexida nos filtros invalida a prévia: deixá-la na tela permitiria
  // clicar em Gerar achando que o lote é o do período que está sendo lido.
  const set = (patch: Partial<BillingFormInput>) => {
    setForm((f) => ({ ...f, ...patch }));
    setPreview(null);
    setError(null);
  };

  const pendentes = preview?.lines.filter((l) => !l.alreadyBilled && l.payerPersonId) ?? [];
  const semPagador = preview?.lines.filter((l) => !l.payerPersonId) ?? [];

  function calcular() {
    setError(null);
    setBusy("preview");
    startTransition(async () => {
      const res = await previewBillingAction(form);
      setBusy(null);
      if (!res.ok) {
        setPreview(null);
        setError(res.error);
        return;
      }
      setPreview(res.preview);
    });
  }

  async function gerar() {
    if (!preview) return;

    const ok = await confirm({
      title: `Gerar ${pendentes.length} ${pendentes.length === 1 ? "conta" : "contas"} a receber?`,
      message:
        `Competência ${preview.competence}, vencimento em ${formatDay(form.dueDate)}, ` +
        `no total de ${formatPrice(pendentes.reduce((s, l) => s + l.totalCents, 0))}. ` +
        `As contas passam a aparecer na Gestão Financeira.`,
      confirmLabel: "Gerar",
      tone: "brand",
    });
    if (!ok) return;

    setError(null);
    setBusy("generate");
    startTransition(async () => {
      const res = await generateBillingAction(form);
      if (!res.ok) {
        setBusy(null);
        setError(res.error);
        toast.error(res.error);
        return;
      }
      const criadas = res.preview.created ?? 0;
      const existiam = res.preview.lines.filter((l) => l.alreadyBilled).length;

      // A resposta do POST traz a prévia de ANTES da gravação (é dela que sai o
      // que gravar), então nela nada aparece como "já gerada". Recalcular deixa
      // a tabela e o botão coerentes com o que passou a existir no banco.
      const atualizada = await previewBillingAction(form);
      setPreview(atualizada.ok ? atualizada.preview : res.preview);
      setBusy(null);

      toast.success(
        criadas === 0
          ? "Nenhuma conta nova — todas já haviam sido geradas nesta competência."
          : `${criadas} ${criadas === 1 ? "conta gerada" : "contas geradas"}` +
              (existiam > 0 ? ` · ${existiam} já existiam` : ""),
      );
    });
  }

  return (
    <>
      <Section title="Período da cobrança">
        <div className="card-pad stack" style={{ gap: 14 }}>
          <div className="grid grid-3" style={{ gap: 12 }}>
            <div className="field">
              <label>Início do período</label>
              <input
                className="input"
                type="date"
                value={form.periodStart}
                onChange={(e) => set({ periodStart: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Fim do período</label>
              <input
                className="input"
                type="date"
                value={form.periodEnd}
                onChange={(e) => set({ periodEnd: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Vencimento</label>
              <input
                className="input"
                type="date"
                value={form.dueDate}
                onChange={(e) => set({ dueDate: e.target.value })}
              />
            </div>
          </div>

          {error && (
            <span className="text-sm" style={{ color: "var(--danger, #dc2626)" }}>
              {error}
            </span>
          )}

          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={calcular}
              disabled={busy !== null}
            >
              {busy === "preview" ? "Calculando…" : "Calcular"}
            </button>
          </div>
        </div>
      </Section>

      {preview && (
        <>
          <div className="grid grid-3 mt-4">
            <StatCard
              icon="building"
              label="Unidades"
              value={String(preview.unitCount)}
              tone="blue"
            />
            <StatCard
              icon="receipt"
              label={`Despesas do período (${preview.expensesCount})`}
              value={formatPrice(preview.expensesTotalCents)}
              tone="accent"
            />
            <StatCard
              icon="wallet"
              label="Total a cobrar"
              value={formatPrice(preview.totalCents)}
              tone="success"
            />
          </div>

          <div className="mt-4">
            <Section
              title={`Cobrança ${preview.competence} · ${formatDay(preview.periodStart)} a ${formatDay(preview.periodEnd)}`}
            >
              {preview.lines.length === 0 ? (
                <div className="card-pad">
                  <EmptyState
                    icon="building"
                    title="Nenhum imóvel neste condomínio"
                    hint="Vincule imóveis a este condomínio pelo cadastro de Imóveis."
                  />
                </div>
              ) : (
                <>
                  <div className="table-wrap">
                    <table className="table">
                      <thead>
                        <tr>
                          <th style={{ textAlign: "right" }}>Imóvel</th>
                          <th>Endereço</th>
                          <th>Pagador</th>
                          <th style={{ textAlign: "right" }}>Condomínio</th>
                          <th style={{ textAlign: "right" }}>Rateio</th>
                          <th style={{ textAlign: "right" }}>Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {preview.lines.map((l) => (
                          <tr key={l.propertyId}>
                            <td style={{ textAlign: "right" }} className="strong num">
                              {l.propertyCode ?? "—"}
                            </td>
                            <td>{l.propertyAddress}</td>
                            <td>
                              <div className="row gap-8">
                                <span className={`badge ${payerTone(l.payerKind)}`}>
                                  {payerLabel(l.payerKind)}
                                </span>
                                <span>{l.payerName ?? "—"}</span>
                                {l.alreadyBilled && (
                                  <span className="badge badge-slate">já gerada</span>
                                )}
                              </div>
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {formatPrice(l.condoTotalCents)}
                              {l.months > 1 && (
                                <span className="subtle text-xs"> · {l.months} meses</span>
                              )}
                            </td>
                            <td style={{ textAlign: "right" }}>
                              {formatPrice(l.expenseShareCents)}
                            </td>
                            <td style={{ textAlign: "right" }} className="strong">
                              {formatPrice(l.totalCents)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div
                    className="card-pad row"
                    style={{ justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}
                  >
                    <span className="text-sm subtle">
                      {pendentes.length === 0
                        ? "Nada a gerar neste período."
                        : `${pendentes.length} ${pendentes.length === 1 ? "conta" : "contas"} a gerar · ${formatPrice(
                            pendentes.reduce((s, l) => s + l.totalCents, 0),
                          )}`}
                      {semPagador.length > 0 &&
                        ` · ${semPagador.length} sem pagador (imóvel sem contrato e sem proprietário)`}
                    </span>
                    <div className="row gap-8">
                      {/* `<a>` e não botão: o alvo é um PDF servido por Route
                          Handler, então o visualizador nativo abre com imprimir
                          e salvar. Um fetch teria de trafegar o binário à toa. */}
                      <a
                        className="btn btn-ghost btn-sm"
                        href={`/condominios/${condominiumId}/cobranca/relatorio?de=${form.periodStart}&ate=${form.periodEnd}&vencimento=${form.dueDate}`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Icon name="printer" size={15} /> <span>Imprimir conferência</span>
                      </a>
                      <button
                        className="btn btn-premium btn-sm"
                        type="button"
                        onClick={gerar}
                        disabled={busy !== null || pendentes.length === 0}
                      >
                        {busy === "generate" ? "Gerando…" : "Gerar contas a receber"}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </Section>
          </div>
        </>
      )}

      {notice && (
        <p className="text-xs subtle mt-4">
          <BackendNotice message={notice} />
        </p>
      )}
    </>
  );
}
