"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { formatCep } from "../../../lib/br-doc";
import type { Condominium } from "../../../lib/api";
import {
  createCondominiumAction,
  updateCondominiumAction,
  type CondominiumFormInput,
} from "./actions";

const EMPTY: CondominiumFormInput = {
  name: "",
  address: "",
  number: "",
  district: "",
  zip: "",
  city: "",
  state: "",
  adminFeePercent: "",
  adminFeeFixedReais: "",
  interestPercent: "",
  penaltyPercent: "",
};

/** Campos de endereço preenchidos pelo CEP (travados após a busca). */
type AddressLock = Partial<Record<"address" | "district" | "city" | "state", boolean>>;

interface ViaCepResponse {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

/** Preenche o formulário a partir de um condomínio existente (modo edição). */
function fromCondominium(c: Condominium): CondominiumFormInput {
  const money = (cents: number) => (cents ? (cents / 100).toFixed(2).replace(".", ",") : "");
  const pct = (n: number) => (n ? String(n).replace(".", ",") : "");
  return {
    name: c.name,
    address: c.address ?? "",
    number: c.number ?? "",
    district: c.district ?? "",
    zip: c.zip ?? "",
    city: c.city ?? "",
    state: c.state ?? "",
    adminFeePercent: pct(c.adminFeePercent),
    adminFeeFixedReais: money(c.adminFeeFixedCents),
    interestPercent: pct(c.interestPercent),
    penaltyPercent: pct(c.penaltyPercent),
  };
}

/**
 * Botão + modal do cadastro de condomínio (paridade com a tela legada
 * "Cadastro de Condomínios"): identificação e parâmetros financeiros de
 * cobrança. Serve para criar (`condominium` ausente) e editar. O Saldo é
 * derivado da movimentação — exibido só leitura na tela, não no formulário.
 */
export function CondominiumFormButton({
  condominium,
}: {
  condominium?: Condominium;
}) {
  const isEdit = !!condominium;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [form, setForm] = useState<CondominiumFormInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<AddressLock>({});
  const [cepLoading, setCepLoading] = useState(false);
  const [cepMsg, setCepMsg] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const set = (patch: Partial<CondominiumFormInput>) =>
    setForm((f) => ({ ...f, ...patch }));

  /** Consulta o ViaCEP, preenche o endereço e trava os campos retornados. */
  async function lookupCep(cepRaw: string) {
    const cep = (cepRaw ?? "").replace(/\D/g, "");
    if (cep.length !== 8) return;
    setCepLoading(true);
    setCepMsg(null);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = (await res.json()) as ViaCepResponse;
      if (data.erro) {
        setCepMsg("CEP não encontrado.");
        setLocked({});
        return;
      }
      set({
        address: data.logradouro ?? "",
        district: data.bairro ?? "",
        city: data.localidade ?? "",
        state: data.uf ?? "",
      });
      // Só trava o que veio preenchido; o resto segue editável.
      setLocked({
        address: Boolean(data.logradouro),
        district: Boolean(data.bairro),
        city: Boolean(data.localidade),
        state: Boolean(data.uf),
      });
    } catch {
      setCepMsg("Falha ao consultar o CEP.");
    } finally {
      setCepLoading(false);
    }
  }

  function openModal() {
    setForm(condominium ? fromCondominium(condominium) : EMPTY);
    // Ao editar, mantém o endereço já salvo travado (com opção de reabrir).
    setLocked(
      condominium
        ? {
            address: Boolean(condominium.address),
            district: Boolean(condominium.district),
            city: Boolean(condominium.city),
            state: Boolean(condominium.state),
          }
        : {},
    );
    setCepMsg(null);
    setError(null);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setError(null);
  }

  function submit() {
    setError(null);
    if (form.name.trim().length < 2) {
      setError("Informe o nome do condomínio.");
      return;
    }
    startTransition(async () => {
      const res = condominium
        ? await updateCondominiumAction(condominium.id, form)
        : await createCondominiumAction(form);
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
        padding: "6vh 16px",
        overflowY: "auto",
        zIndex: 2000,
      }}
    >
      <div
        className="card card-pad stack"
        onClick={(e) => e.stopPropagation()}
        style={{ gap: 14, width: 740, maxWidth: "96vw", boxShadow: "0 20px 60px rgba(0,0,0,.30)" }}
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>{isEdit ? "Editar Condomínio" : "Novo Condomínio"}</strong>
          <button className="icon-btn" type="button" aria-label="Fechar" onClick={close}>
            <Icon name="close" size={15} />
          </button>
        </div>

        {/* Identificação */}
        <div className="field">
          <label>Condomínio *</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Edifício Aurora"
            autoFocus
          />
        </div>

        {/* Endereço por CEP: informa o CEP → ViaCEP preenche e trava os campos;
            só o número fica editável. "editar" reabre caso o CEP venha errado. */}
        <div className="stack" style={{ gap: 10 }}>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <span className="text-sm strong">Endereço</span>
            {Object.values(locked).some(Boolean) && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ padding: "2px 8px" }}
                onClick={() => setLocked({})}
              >
                <Icon name="edit" size={12} /> Editar
              </button>
            )}
          </div>

          <div className="grid grid-3" style={{ gap: 12 }}>
            <div className="field">
              <label>CEP {cepLoading && <span className="text-xs subtle">buscando…</span>}</label>
              <input
                className="input"
                value={form.zip}
                inputMode="numeric"
                maxLength={9}
                placeholder="00000-000"
                onChange={(e) => set({ zip: formatCep(e.target.value) })}
                onBlur={(e) => lookupCep(e.target.value)}
              />
            </div>
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>Logradouro</label>
              <input
                className="input"
                value={form.address}
                disabled={locked.address}
                onChange={(e) => set({ address: e.target.value })}
                placeholder="Preenchido pelo CEP"
              />
            </div>
          </div>

          <div className="grid grid-3" style={{ gap: 12 }}>
            <div className="field">
              <label>Número</label>
              <input
                className="input"
                value={form.number}
                onChange={(e) => set({ number: e.target.value })}
                placeholder="Nº"
              />
            </div>
            <div className="field">
              <label>Bairro</label>
              <input
                className="input"
                value={form.district}
                disabled={locked.district}
                onChange={(e) => set({ district: e.target.value })}
              />
            </div>
            <div className="field">
              <label>Cidade / UF</label>
              <div className="row" style={{ gap: 6 }}>
                <input
                  className="input"
                  value={form.city}
                  disabled={locked.city}
                  onChange={(e) => set({ city: e.target.value })}
                />
                <input
                  className="input"
                  style={{ width: 60 }}
                  maxLength={2}
                  value={form.state}
                  disabled={locked.state}
                  onChange={(e) => set({ state: e.target.value.toUpperCase() })}
                />
              </div>
            </div>
          </div>

          {cepMsg && <span className="text-xs" style={{ color: "var(--danger, #dc2626)" }}>{cepMsg}</span>}
        </div>

        {/* Parâmetros financeiros */}
        <div className="stack" style={{ gap: 10, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <span className="text-sm strong">Cobrança</span>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="field">
              <label>Taxa de Administração (%)</label>
              <input className="input" value={form.adminFeePercent} onChange={(e) => set({ adminFeePercent: e.target.value })} inputMode="decimal" placeholder="10" />
            </div>
            <div className="field">
              <label>Taxa de Administração (R$)</label>
              <input className="input" value={form.adminFeeFixedReais} onChange={(e) => set({ adminFeeFixedReais: e.target.value })} inputMode="decimal" placeholder="0,00" />
            </div>
          </div>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="field">
              <label>Juros ao Mês (%)</label>
              <input className="input" value={form.interestPercent} onChange={(e) => set({ interestPercent: e.target.value })} inputMode="decimal" placeholder="1" />
            </div>
            <div className="field">
              <label>Multa (%)</label>
              <input className="input" value={form.penaltyPercent} onChange={(e) => set({ penaltyPercent: e.target.value })} inputMode="decimal" placeholder="2" />
            </div>
          </div>
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
        <button className="icon-btn" style={{ width: 30, height: 30 }} type="button" onClick={openModal} aria-label={`Editar ${condominium.name}`}>
          <Icon name="edit" size={15} />
        </button>
      ) : (
        <button className="btn btn-primary btn-sm" type="button" onClick={openModal}>
          <Icon name="plus" /> Novo Condomínio
        </button>
      )}
      {open && mounted && createPortal(modal, document.body)}
    </>
  );
}
