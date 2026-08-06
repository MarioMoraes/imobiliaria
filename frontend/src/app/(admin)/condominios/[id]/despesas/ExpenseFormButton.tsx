"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "../../../../../components/Icon";
import type { CondominiumExpense, Event } from "../../../../../lib/api";
import {
  createExpenseAction,
  updateExpenseAction,
  type ExpenseFormInput,
} from "./actions";

/** Data de hoje em YYYY-MM-DD (padrão do input date). */
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptyForm(): ExpenseFormInput {
  return { entryDate: today(), eventId: "", valueReais: "", notes: "" };
}

/** Preenche o formulário a partir de uma despesa existente (modo edição). */
function fromExpense(e: CondominiumExpense): ExpenseFormInput {
  return {
    entryDate: e.entryDate ?? today(),
    eventId: e.eventId ?? "",
    valueReais: e.amountCents ? (e.amountCents / 100).toFixed(2).replace(".", ",") : "",
    notes: e.notes ?? "",
  };
}

/**
 * Botão + modal do lançamento de despesa do condomínio (paridade com a tela
 * legada "Cadastro de Despesas"): Data, Evento, Valor e Histórico. O "Lancto nº"
 * é sequencial atribuído pelo backend e o Condomínio já vem selecionado — ambos
 * são somente-leitura aqui.
 */
export function ExpenseFormButton({
  condominiumId,
  condominiumName,
  events,
  expense,
}: {
  condominiumId: string;
  condominiumName: string;
  events: Event[];
  expense?: CondominiumExpense;
}) {
  const isEdit = !!expense;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [form, setForm] = useState<ExpenseFormInput>(emptyForm);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const set = (patch: Partial<ExpenseFormInput>) => setForm((f) => ({ ...f, ...patch }));

  function openModal() {
    setForm(expense ? fromExpense(expense) : emptyForm());
    setError(null);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = expense
        ? await updateExpenseAction(condominiumId, expense.id, form)
        : await createExpenseAction(condominiumId, form);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível lançar a despesa.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const modal = (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "10vh 16px",
        overflowY: "auto",
        zIndex: 2000,
      }}
    >
      <div
        className="card card-pad stack"
        onClick={(e) => e.stopPropagation()}
        style={{ gap: 14, width: 560, maxWidth: "96vw", boxShadow: "0 20px 60px rgba(0,0,0,.30)" }}
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Cadastro de Despesas</strong>
          <button className="icon-btn" type="button" aria-label="Fechar" onClick={close}>
            <Icon name="close" size={15} />
          </button>
        </div>

        {/* Condomínio (contexto, só leitura). O "Lancto nº" é sequencial
            atribuído pelo backend — não exibimos o campo no formulário. */}
        <div className="field">
          <label>Condomínio</label>
          <input className="input" value={condominiumName} disabled />
        </div>

        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label>Data *</label>
            <input
              className="input"
              type="date"
              value={form.entryDate}
              onChange={(e) => set({ entryDate: e.target.value })}
              autoFocus
            />
          </div>
          <div className="field">
            <label>Valor (R$) *</label>
            <input
              className="input"
              value={form.valueReais}
              onChange={(e) => set({ valueReais: e.target.value })}
              inputMode="decimal"
              placeholder="0,00"
            />
          </div>
        </div>

        <div className="field">
          <label>Evento</label>
          <select
            className="input"
            value={form.eventId}
            onChange={(e) => set({ eventId: e.target.value })}
          >
            <option value="">— Selecione —</option>
            {events.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} ({ev.kind === "DEBITO" ? "Débito" : "Crédito"})
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label>Histórico</label>
          <input
            className="input"
            value={form.notes}
            onChange={(e) => set({ notes: e.target.value })}
            placeholder="Descrição da despesa"
            maxLength={500}
          />
        </div>

        {error && <span className="text-sm" style={{ color: "var(--danger, #dc2626)" }}>{error}</span>}

        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" type="button" onClick={close} disabled={pending}>
            Fechar
          </button>
          <button className="btn btn-primary btn-sm" type="button" onClick={submit} disabled={pending}>
            {pending ? "Salvando…" : "Confirmar"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {isEdit ? (
        <button
          className="icon-btn"
          style={{ width: 30, height: 30 }}
          type="button"
          onClick={openModal}
          aria-label={`Editar despesa nº ${expense.seq ?? ""}`.trim()}
        >
          <Icon name="edit" size={15} />
        </button>
      ) : (
        <button className="btn btn-primary btn-sm" type="button" onClick={openModal}>
          <Icon name="plus" /> Nova Despesa
        </button>
      )}
      {open && mounted && createPortal(modal, document.body)}
    </>
  );
}
