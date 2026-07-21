"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { createEventAction, type EventFormInput } from "./actions";

const EMPTY: EventFormInput = {
  name: "",
  kind: "DEBITO",
  interestPercent: "0",
  judicialInterestPercent: "0",
  penaltyPercent: "0",
  appliesAdminFee: false,
};

/**
 * Botão "Cadastrar Evento" + popup com a ficha do evento financeiro (espelha a
 * tela legada "Cadastro de Eventos"): nome, tipo (débito/crédito), juros, juros
 * de execução judicial, multa e se incide a taxa de administração. Mesmo padrão
 * de popup usado nos demais cadastros do sistema.
 */
export function EventFormButton({ disabled }: { disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [form, setForm] = useState<EventFormInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const set = (patch: Partial<EventFormInput>) => setForm((f) => ({ ...f, ...patch }));

  function openModal() {
    setForm(EMPTY);
    setError(null);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setError(null);
  }

  function submit() {
    setError(null);
    if (form.name.trim().length < 1) {
      setError("Informe o nome do evento.");
      return;
    }
    startTransition(async () => {
      const res = await createEventAction(form);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar.");
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
        padding: "8vh 16px",
        overflowY: "auto",
        zIndex: 2000,
      }}
    >
      <div
        className="card card-pad stack"
        onClick={(e) => e.stopPropagation()}
        style={{ gap: 14, width: 660, maxWidth: "96vw", boxShadow: "0 20px 60px rgba(0,0,0,.30)" }}
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Novo Evento</strong>
          <button className="icon-btn" type="button" aria-label="Fechar" onClick={close}>
            <Icon name="close" size={15} />
          </button>
        </div>

        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label>Evento *</label>
            <input
              className="input"
              value={form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Ex.: ÁGUA"
              autoFocus
            />
          </div>
          <div className="field">
            <label>Tipo</label>
            <select
              className="input"
              value={form.kind}
              onChange={(e) => set({ kind: e.target.value as EventFormInput["kind"] })}
            >
              <option value="DEBITO">Débito</option>
              <option value="CREDITO">Crédito</option>
            </select>
          </div>
        </div>

        <div className="grid grid-3" style={{ gap: 12 }}>
          <div className="field">
            <label>Juros (%)</label>
            <input className="input" value={form.interestPercent} onChange={(e) => set({ interestPercent: e.target.value })} inputMode="decimal" />
          </div>
          <div className="field">
            <label>Juros Exec. Judicial (%)</label>
            <input className="input" value={form.judicialInterestPercent} onChange={(e) => set({ judicialInterestPercent: e.target.value })} inputMode="decimal" />
          </div>
          <div className="field">
            <label>Multa (%)</label>
            <input className="input" value={form.penaltyPercent} onChange={(e) => set({ penaltyPercent: e.target.value })} inputMode="decimal" />
          </div>
        </div>

        <label className="row gap-8 text-sm" style={{ cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={form.appliesAdminFee}
            onChange={(e) => set({ appliesAdminFee: e.target.checked })}
          />
          Incide Taxa de Administração
        </label>

        {error && <span className="text-sm" style={{ color: "var(--danger, #dc2626)" }}>{error}</span>}

        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" type="button" onClick={close} disabled={pending}>
            Cancelar
          </button>
          <button className="btn btn-primary btn-sm" type="button" onClick={submit} disabled={pending}>
            {pending ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button className="btn btn-primary btn-sm" type="button" onClick={openModal} disabled={disabled}>
        <Icon name="plus" /> Cadastrar Evento
      </button>
      {open && mounted && createPortal(modal, document.body)}
    </>
  );
}
