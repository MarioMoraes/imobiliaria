"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { formatCep, formatCpf, formatPhone } from "../../../lib/br-doc";
import type { Broker } from "../../../lib/api";
import { createBrokerAction, updateBrokerAction, type BrokerFormInput } from "./actions";

const EMPTY: BrokerFormInput = {
  name: "",
  address: "",
  district: "",
  city: "",
  state: "",
  zip: "",
  phone: "",
  mobile: "",
  cpf: "",
  rg: "",
  commissionPercent: "",
};

type AddressLock = Partial<Record<"address" | "district" | "city" | "state", boolean>>;

interface ViaCepResponse {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

/** Preenche o formulário a partir de um corretor existente (modo edição). */
function fromBroker(b: Broker): BrokerFormInput {
  return {
    name: b.name,
    address: b.address ?? "",
    district: b.district ?? "",
    city: b.city ?? "",
    state: b.state ?? "",
    zip: b.zip ?? "",
    phone: b.phone ?? "",
    mobile: b.mobile ?? "",
    cpf: b.cpf ?? "",
    rg: b.rg ?? "",
    commissionPercent: b.commissionPercent ? String(b.commissionPercent).replace(".", ",") : "",
  };
}

/**
 * Botão + modal do cadastro de corretor (paridade com a tela legada "Cadastro
 * de Corretores"): identificação, contato, endereço e comissão. Serve para criar
 * (`broker` ausente) e editar. O Código é sequencial atribuído pelo backend —
 * não exibimos o campo.
 */
export function BrokerFormButton({
  broker,
  disabled,
}: {
  broker?: Broker;
  disabled?: boolean;
}) {
  const isEdit = !!broker;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [form, setForm] = useState<BrokerFormInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [locked, setLocked] = useState<AddressLock>({});
  const [cepLoading, setCepLoading] = useState(false);
  const [cepMsg, setCepMsg] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const set = (patch: Partial<BrokerFormInput>) => setForm((f) => ({ ...f, ...patch }));

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
    setForm(broker ? fromBroker(broker) : EMPTY);
    setLocked(
      broker
        ? {
            address: Boolean(broker.address),
            district: Boolean(broker.district),
            city: Boolean(broker.city),
            state: Boolean(broker.state),
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
      setError("Informe o nome do corretor.");
      return;
    }
    startTransition(async () => {
      const res = broker
        ? await updateBrokerAction(broker.id, form)
        : await createBrokerAction(form);
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
        style={{ gap: 14, width: 720, maxWidth: "96vw", boxShadow: "0 20px 60px rgba(0,0,0,.30)" }}
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>{isEdit ? "Editar Corretor" : "Novo Corretor"}</strong>
          <button className="icon-btn" type="button" aria-label="Fechar" onClick={close}>
            <Icon name="close" size={15} />
          </button>
        </div>

        {/* Identificação */}
        <div className="field">
          <label>Nome *</label>
          <input
            className="input"
            value={form.name}
            onChange={(e) => set({ name: e.target.value })}
            placeholder="Nome do corretor"
            autoFocus
          />
        </div>

        {/* Endereço por CEP */}
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
                <Icon name="edit" size={12} /> editar
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
              <label>Endereço</label>
              <input
                className="input"
                value={form.address}
                disabled={locked.address}
                onChange={(e) => set({ address: e.target.value })}
                placeholder="Preenchido pelo CEP"
              />
            </div>
          </div>

          <div className="grid grid-2" style={{ gap: 12 }}>
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

        {/* Contato */}
        <div className="grid grid-2" style={{ gap: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <div className="field">
            <label>Telefone</label>
            <input
              className="input"
              value={form.phone}
              inputMode="tel"
              placeholder="(11) 3333-4444"
              onChange={(e) => set({ phone: formatPhone(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>Celular</label>
            <input
              className="input"
              value={form.mobile}
              inputMode="tel"
              placeholder="(11) 99999-8888"
              onChange={(e) => set({ mobile: formatPhone(e.target.value) })}
            />
          </div>
        </div>

        {/* Documentos + comissão */}
        <div className="grid grid-3" style={{ gap: 12 }}>
          <div className="field">
            <label>CPF</label>
            <input
              className="input"
              value={form.cpf}
              inputMode="numeric"
              maxLength={14}
              placeholder="000.000.000-00"
              onChange={(e) => set({ cpf: formatCpf(e.target.value) })}
            />
          </div>
          <div className="field">
            <label>RG</label>
            <input
              className="input"
              value={form.rg}
              onChange={(e) => set({ rg: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Comissão (%)</label>
            <input
              className="input"
              value={form.commissionPercent}
              inputMode="decimal"
              placeholder="0,00"
              onChange={(e) => set({ commissionPercent: e.target.value })}
            />
          </div>
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
          disabled={disabled}
          aria-label={`Editar ${broker.name}`}
        >
          <Icon name="edit" size={15} />
        </button>
      ) : (
        <button className="btn btn-primary btn-sm" type="button" onClick={openModal} disabled={disabled}>
          <Icon name="plus" /> Novo Corretor
        </button>
      )}
      {open && mounted && createPortal(modal, document.body)}
    </>
  );
}
