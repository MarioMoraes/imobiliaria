"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import type { Bank } from "../../../lib/api";
import { formatPrice } from "../../../lib/format";
import {
  createBankAction,
  updateBankAction,
  type BankFormInput,
} from "./actions";

const EMPTY: BankFormInput = {
  name: "",
  agency: "",
  accountNumber: "",
  favorite: false,
};

function fromBank(b: Bank): BankFormInput {
  return {
    name: b.name,
    agency: b.agency ?? "",
    accountNumber: b.accountNumber ?? "",
    favorite: b.favorite,
  };
}

/** Campo somente-leitura de saldo (alimentado por outras rotinas). */
function ReadonlyMoney({ label, cents }: { label: string; cents: number }) {
  return (
    <div className="field">
      <label>{label}</label>
      <input className="input" value={formatPrice(cents)} readOnly disabled />
    </div>
  );
}

/**
 * Botão + popup da ficha do banco (espelha a tela legada "Bancos"). Sem `bank` é
 * cadastro; com `bank` é edição. Código, nome, agência, conta e favorito são
 * editáveis; Saldo, Cofre, Em Trânsito e Provável Saldo são somente-leitura
 * (alimentados por outras rotinas do sistema). Mesmo padrão de popup dos demais
 * cadastros.
 */
export function BankFormButton({ bank, disabled }: { bank?: Bank; disabled?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [form, setForm] = useState<BankFormInput>(bank ? fromBank(bank) : EMPTY);
  const [error, setError] = useState<string | null>(null);

  const isEdit = bank !== undefined;

  useEffect(() => setMounted(true), []);

  const set = (patch: Partial<BankFormInput>) => setForm((f) => ({ ...f, ...patch }));

  function openModal() {
    setForm(bank ? fromBank(bank) : EMPTY);
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
      setError("Informe o nome do banco.");
      return;
    }
    startTransition(async () => {
      const res = isEdit
        ? await updateBankAction(bank.id, form)
        : await createBankAction(form);
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
        style={{ gap: 14, width: 620, maxWidth: "96vw", boxShadow: "0 20px 60px rgba(0,0,0,.30)" }}
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>{isEdit ? "Editar Banco" : "Novo Banco"}</strong>
          <button className="icon-btn" type="button" aria-label="Fechar" onClick={close}>
            <Icon name="close" size={15} />
          </button>
        </div>

        {/* O Código é sequencial atribuído pelo backend na inclusão — não
            exibimos o campo no formulário. */}
        <div className="field">
          <label>Nome *</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Ex.: Itaú"
            autoFocus
          />
        </div>

        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label>Agência</label>
            <input
              className="input"
              value={form.agency}
              onChange={(e) => set({ agency: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Conta nº</label>
            <input
              className="input"
              value={form.accountNumber}
              onChange={(e) => set({ accountNumber: e.target.value })}
            />
          </div>
        </div>

        <label className="row gap-8 text-sm" style={{ cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={form.favorite}
            onChange={(e) => set({ favorite: e.target.checked })}
          />
          <Icon name="star" size={14} /> Favorito
        </label>

        <div className="grid grid-2" style={{ gap: 12 }}>
          <ReadonlyMoney label="Saldo" cents={bank?.balanceCents ?? 0} />
          <ReadonlyMoney label="Cofre" cents={bank?.vaultCents ?? 0} />
          <ReadonlyMoney label="Em Trânsito" cents={bank?.inTransitCents ?? 0} />
          <ReadonlyMoney label="Provável Saldo" cents={bank?.probableBalanceCents ?? 0} />
        </div>

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
      {isEdit ? (
        <button
          className="icon-btn"
          style={{ width: 30, height: 30 }}
          type="button"
          onClick={openModal}
          disabled={disabled}
          aria-label={`Editar ${bank.name}`}
        >
          <Icon name="edit" size={15} />
        </button>
      ) : (
        <button className="btn btn-primary btn-sm" type="button" onClick={openModal} disabled={disabled}>
          <Icon name="plus" /> Cadastrar Banco
        </button>
      )}
      {open && mounted && createPortal(modal, document.body)}
    </>
  );
}
