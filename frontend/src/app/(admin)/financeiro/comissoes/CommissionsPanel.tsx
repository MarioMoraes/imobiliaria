"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../../components/Icon";
import { Modal } from "../../../../components/Modal";
import { StatusBadge } from "../../../../components/ui";
import { useConfirm } from "../../../../components/ConfirmDialog";
import { useToast } from "../../../../components/Toast";
// Só o TIPO vem de lib/api (apagado na compilação) — ver lib/format.ts.
import type { Broker, Commission, Property } from "../../../../lib/api";
import { formatDay, formatPrice } from "../../../../lib/format";
import {
  cancelCommissionAction,
  createCommissionAction,
  deleteCommissionAction,
  settleCommissionAction,
  type CommissionFormInput,
} from "../actions";

const EMPTY: CommissionFormInput = {
  party: "IMOBILIARIA",
  propertyId: "",
  brokerId: "",
  description: "",
  baseReais: "",
  percent: "",
  amountReais: "",
  dueDate: "",
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Comissão em aberto com vencimento passado é exibida como vencida. */
function displayStatus(c: Commission, today: string): string {
  return c.status === "ABERTO" && c.dueDate < today ? "VENCIDO" : c.status;
}

export function CommissionsPanel({
  commissions,
  brokers,
  properties,
  status,
  live,
}: {
  commissions: Commission[];
  brokers: Broker[];
  properties: Property[];
  status: string;
  live: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const today = todayIso();
  const [pending, startAction] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  function run(id: string, fn: () => Promise<{ ok: boolean; error?: string }>, done: string) {
    setBusyId(id);
    startAction(async () => {
      try {
        const res = await fn();
        if (!res.ok) {
          toast.error(res.error ?? "Não foi possível concluir.");
          return;
        }
        toast.success(done);
        router.refresh();
      } finally {
        setBusyId(null);
      }
    });
  }

  async function handleCancel(c: Commission) {
    const ok = await confirm({
      title: "Cancelar esta comissão?",
      message: `${formatPrice(c.amountCents)} deixa de constar como ${
        c.party === "IMOBILIARIA" ? "receita a receber" : "valor a pagar ao corretor"
      }. O lançamento continua na lista, marcado como cancelado.`,
      eyebrow: "Cancelamento",
      confirmLabel: "Cancelar comissão",
    });
    if (ok) run(c.id, () => cancelCommissionAction(c.id), "Comissão cancelada.");
  }

  async function handleDelete(c: Commission) {
    const ok = await confirm({
      title: "Excluir esta comissão?",
      message: "O lançamento sai da lista definitivamente. Comissão já quitada não pode ser excluída.",
      eyebrow: "Exclusão",
      confirmLabel: "Excluir",
    });
    if (ok) run(c.id, () => deleteCommissionAction(c.id), "Comissão excluída.");
  }

  return (
    <>
      <div className="card-pad row-between">
        <div className="row gap-8">
          {[
            ["", "Todas"],
            ["ABERTO", "Em Aberto"],
            ["QUITADO", "Quitadas"],
            ["CANCELADO", "Canceladas"],
          ].map(([value, label]) => (
            <button
              key={label}
              type="button"
              className={`btn btn-sm ${status === value ? "btn-primary" : "btn-ghost"}`}
              onClick={() =>
                router.push(`/financeiro/comissoes${value ? `?status=${value}` : ""}`)
              }
            >
              {label}
            </button>
          ))}
        </div>
        <button
          className="btn btn-primary btn-sm"
          type="button"
          onClick={() => setFormOpen(true)}
          disabled={!live}
        >
          <Icon name="plus" /> Nova Comissão
        </button>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Parte</th>
              <th>Descrição</th>
              <th>Venda</th>
              <th>Venc.</th>
              <th style={{ textAlign: "right" }}>Valor</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {commissions.map((c) => (
              <tr key={c.id}>
                <td>
                  <span
                    className={`badge ${
                      c.party === "IMOBILIARIA" ? "badge-green" : "badge-amber"
                    }`}
                    title={
                      c.party === "IMOBILIARIA"
                        ? "Receita: o que a imobiliária recebe do cliente"
                        : "Despesa: o que a imobiliária paga ao corretor"
                    }
                  >
                    {c.party === "IMOBILIARIA" ? "Imobiliária" : "Corretor"}
                  </span>
                </td>
                <td className="strong">
                  {c.description ?? "Comissão de venda"}
                  {c.brokerName && (
                    <span className="text-xs subtle"> · {c.brokerName}</span>
                  )}
                </td>
                <td className="text-sm subtle">
                  {c.baseCents > 0 ? formatPrice(c.baseCents) : "—"}
                </td>
                <td className="text-sm subtle">{formatDay(c.dueDate)}</td>
                <td className="strong num" style={{ textAlign: "right" }}>
                  {formatPrice(c.amountCents)}
                </td>
                <td>
                  <StatusBadge status={displayStatus(c, today)} />
                </td>
                <td style={{ width: 180, textAlign: "right" }}>
                  <span className="row gap-8" style={{ justifyContent: "flex-end" }}>
                    {(c.status === "ABERTO" || displayStatus(c, today) === "VENCIDO") && (
                      <SettleButton
                        commission={c}
                        today={today}
                        disabled={!live || pending}
                        onSettle={(id, settledAt) =>
                          run(
                            id,
                            () => settleCommissionAction(id, settledAt),
                            "Comissão quitada.",
                          )
                        }
                      />
                    )}
                    {c.status === "ABERTO" && (
                      <button
                        className="icon-btn"
                        style={{ width: 30, height: 30 }}
                        type="button"
                        onClick={() => void handleCancel(c)}
                        disabled={!live || busyId !== null}
                        aria-label="Cancelar Comissão"
                      >
                        <Icon name="x" size={15} />
                      </button>
                    )}
                    {c.status !== "QUITADO" && (
                      <button
                        className="icon-btn"
                        style={{ width: 30, height: 30 }}
                        type="button"
                        onClick={() => void handleDelete(c)}
                        disabled={!live || busyId !== null}
                        aria-label="Excluir Comissão"
                      >
                        <Icon
                          name={busyId === c.id ? "loader" : "trash"}
                          className={busyId === c.id ? "spin" : undefined}
                          size={15}
                        />
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {commissions.length === 0 && (
              <tr>
                <td colSpan={7} className="text-sm subtle">
                  Nenhuma comissão lançada. Uma venda gera duas linhas: a comissão
                  que a imobiliária recebe e a parte do corretor.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title="Nova comissão"
        subtitle="Uma parte por lançamento — a da imobiliária é receita, a do corretor é despesa."
        icon="receipt"
      >
        <CommissionForm
          brokers={brokers}
          properties={properties}
          onDone={() => {
            setFormOpen(false);
            router.refresh();
          }}
        />
      </Modal>
    </>
  );
}

/**
 * Quitação em dois passos: o clique abre a **data do caixa** (hoje por padrão) e
 * o ✓ confirma.
 *
 * O passo extra existe pelo mesmo motivo da baixa do repasse: a comissão costuma
 * ser registrada depois de recebida, e é essa data que decide em que mês ela
 * entra no fluxo de caixa. Sem ela, todo acerto retroativo cairia no dia do
 * clique.
 */
function SettleButton({
  commission,
  today,
  disabled,
  onSettle,
}: {
  commission: Commission;
  today: string;
  disabled: boolean;
  onSettle: (id: string, settledAt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [settledAt, setSettledAt] = useState(today);

  if (!open) {
    return (
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        Quitar
      </button>
    );
  }

  return (
    <span className="row gap-8" style={{ justifyContent: "flex-end" }}>
      <input
        className="input input-sm"
        type="date"
        value={settledAt}
        max={today}
        autoFocus
        onChange={(e) => setSettledAt(e.target.value)}
        aria-label={`Data da quitação de ${commission.description ?? "comissão"}`}
      />
      <button
        className="icon-btn"
        style={{ width: 30, height: 30 }}
        type="button"
        onClick={() => {
          setOpen(false);
          onSettle(commission.id, settledAt);
        }}
        disabled={disabled}
        aria-label="Confirmar Quitação"
      >
        <Icon name="check" size={15} />
      </button>
    </span>
  );
}

/* ------------------------------------------------------------- Formulário */

function CommissionForm({
  brokers,
  properties,
  onDone,
}: {
  brokers: Broker[];
  properties: Property[];
  onDone: () => void;
}) {
  const toast = useToast();
  const [saving, startSave] = useTransition();
  const [form, setForm] = useState<CommissionFormInput>({ ...EMPTY, dueDate: todayIso() });

  const set = <K extends keyof CommissionFormInput>(
    key: K,
    value: CommissionFormInput[K],
  ): void => setForm((f) => ({ ...f, [key]: value }));

  // Prévia do que o backend vai calcular quando o valor não for digitado —
  // deixa claro na hora que "6% de R$ 500.000" é R$ 30.000.
  const previsto = derived(form);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startSave(async () => {
      const res = await createCommissionAction(form);
      if (!res.ok) {
        toast.error(res.error ?? "Falha ao lançar a comissão.");
        return;
      }
      toast.success("Comissão lançada.");
      onDone();
    });
  }

  return (
    <form className="card-pad stack" style={{ gap: 14 }} onSubmit={handleSubmit}>
      <div className="grid grid-2">
        <div className="field">
          <label>Parte</label>
          <select
            className="input"
            value={form.party}
            onChange={(e) => {
              const party = e.target.value as CommissionFormInput["party"];
              set("party", party);
              // Corretor só faz sentido na parte dele; manter o vínculo numa
              // receita da imobiliária confundiria o relatório do corretor.
              if (party === "IMOBILIARIA") set("brokerId", "");
            }}
          >
            <option value="IMOBILIARIA">Imobiliária (Receita)</option>
            <option value="CORRETOR">Corretor (Despesa)</option>
          </select>
        </div>
        <div className="field">
          <label>Vencimento</label>
          <input
            className="input"
            type="date"
            value={form.dueDate}
            onChange={(e) => set("dueDate", e.target.value)}
            required
          />
        </div>
      </div>

      {form.party === "CORRETOR" && (
        <div className="field">
          <label>Corretor</label>
          <select
            className="input"
            value={form.brokerId}
            onChange={(e) => {
              const brokerId = e.target.value;
              set("brokerId", brokerId);
              // Puxa o percentual do cadastro do corretor como ponto de partida;
              // continua editável, porque o acerto de uma venda específica pode
              // ter sido outro.
              const broker = brokers.find((b) => b.id === brokerId);
              if (broker && !form.percent) {
                set("percent", String(broker.commissionPercent).replace(".", ","));
              }
            }}
            required
          >
            <option value="">Selecione…</option>
            {brokers.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name} ({b.commissionPercent}%)
              </option>
            ))}
          </select>
        </div>
      )}

      <div className="field">
        <label>Imóvel</label>
        <select
          className="input"
          value={form.propertyId}
          onChange={(e) => set("propertyId", e.target.value)}
        >
          <option value="">Não Informado</option>
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.code ? `${p.code} — ` : ""}
              {p.title}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-2">
        <div className="field">
          <label>Valor da Venda (R$)</label>
          <input
            className="input"
            inputMode="decimal"
            placeholder="0,00"
            value={form.baseReais}
            onChange={(e) => set("baseReais", e.target.value)}
          />
        </div>
        <div className="field">
          <label>Percentual (%)</label>
          <input
            className="input"
            inputMode="decimal"
            placeholder="0,00"
            value={form.percent}
            onChange={(e) => set("percent", e.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label>Valor da Comissão (R$)</label>
        <input
          className="input"
          inputMode="decimal"
          placeholder={previsto !== null ? centsToReais(previsto) : "0,00"}
          value={form.amountReais}
          onChange={(e) => set("amountReais", e.target.value)}
        />
      </div>

      <div className="field">
        <label>Descrição</label>
        <input
          className="input"
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          maxLength={200}
        />
      </div>

      {previsto !== null && !form.amountReais.trim() && (
        <p className="text-sm subtle">
          Sem valor informado, será lançado {formatPrice(previsto)}.
        </p>
      )}

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? <Icon name="loader" className="spin" /> : <Icon name="check" />}
          Lançar
        </button>
      </div>
    </form>
  );
}

/**
 * Prévia do cálculo — apenas para exibição. A conta que VALE é a do backend
 * (`amountCents` derivado no service); duplicá-la aqui como fonte seria a
 * segunda verdade que o resto deste módulo evita.
 */
function derived(form: CommissionFormInput): number | null {
  const baseCents = toCents(form.baseReais);
  const percent = toPercent(form.percent);
  if (baseCents === null || percent === null || baseCents <= 0 || percent <= 0) return null;
  return Math.round((baseCents * percent) / 100);
}

/**
 * As duas conversões são DIFERENTES e espelham as de `actions.ts` — em valor, o
 * ponto é separador de milhar ("1.234,56"); em percentual, ele é decimal
 * ("6.5"). Usar a mesma regra nos dois faria a prévia mostrar 65% onde o
 * servidor grava 6,5%.
 */
function toCents(v: string): number | null {
  const raw = v.trim();
  if (!raw) return null;
  const n = Number(raw.replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

function toPercent(v: string): number | null {
  const raw = v.trim();
  if (!raw) return null;
  const n = Number(raw.replace(",", "."));
  if (!Number.isFinite(n)) return null;
  return Math.min(100, Math.max(0, n));
}

function centsToReais(cents: number): string {
  return (cents / 100).toFixed(2).replace(".", ",");
}
