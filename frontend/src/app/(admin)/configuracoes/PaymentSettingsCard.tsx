"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BackendNotice, GENERIC_BACKEND_NOTICE } from "../../../components/BackendNotice";
import { Icon } from "../../../components/Icon";
import type { PaymentSettings } from "../../../lib/api";
import { disconnectPaymentAction, savePaymentSettingsAction } from "./actions";

/** Formas de recebimento — é o que o inquilino encontra ao abrir a cobrança. */
const BILLING_TYPES: { value: string; label: string }[] = [
  { value: "UNDEFINED", label: "Boleto + PIX (o inquilino escolhe)" },
  { value: "BOLETO", label: "Somente boleto" },
  { value: "PIX", label: "Somente PIX" },
];

/**
 * Conexão da conta Asaas do tenant. A chave é write-only: uma vez salva, a tela
 * só exibe os últimos 4 caracteres.
 */
export function PaymentSettingsCard({
  settings,
  notice,
}: {
  settings: PaymentSettings | null;
  /** Por que não está disponível — vem do `backendNotice()` de quem renderiza. */
  notice?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [apiKey, setApiKey] = useState("");
  const [sandbox, setSandbox] = useState(settings?.sandbox ?? true);
  const [billingType, setBillingType] = useState(settings?.billingType ?? BILLING_TYPES[0]!.value);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const offline = settings === null;
  const connected = settings?.connected ?? false;

  function save() {
    setError(null);
    setSaved(false);
    if (!connected && !apiKey.trim()) {
      setError("Informe a chave de API do Asaas.");
      return;
    }
    startTransition(async () => {
      const res = await savePaymentSettingsAction({ apiKey, sandbox, billingType });
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar.");
        return;
      }
      setApiKey("");
      setSaved(true);
      router.refresh();
    });
  }

  function disconnect() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await disconnectPaymentAction();
      if (!res.ok) {
        setError(res.error ?? "Não foi possível desconectar.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <span className="text-sm subtle">
          Boletos e PIX dos aluguéis, emitidos na conta da imobiliária.
        </span>
        <span className={`badge ${connected ? "badge-green" : "badge-slate"}`}>
          {connected ? "Conectado" : "Não conectado"}
        </span>
      </div>

      <div className="field">
        <label>
          Chave de API {connected && <span className="subtle">(salva: ••••{settings?.apiKeyHint})</span>}
        </label>
        <input
          className="input"
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={connected ? "Deixe em branco para manter a chave atual" : "Cole aqui a chave do Asaas"}
          autoComplete="off"
        />
      </div>

      <div className="field">
        <label>Forma de recebimento</label>
        <select className="input" value={billingType} onChange={(e) => setBillingType(e.target.value)}>
          {BILLING_TYPES.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </div>

      <label className="row gap-8 text-sm" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} />
        Ambiente de testes (sandbox) — cobranças <strong>fictícias</strong>, sem dinheiro real
      </label>

      <div className="field">
        <label>URL do webhook</label>
        <input className="input" readOnly value={settings?.webhookUrl ?? "—"} />
      </div>

      {error && <span className="badge badge-red">{error}</span>}
      {saved && (
        <span className="badge badge-green">
          <Icon name="check" size={12} /> Integração salva.
        </span>
      )}

      <div className="row gap-8">
        <button className="btn btn-primary btn-sm" type="button" onClick={save} disabled={pending || offline}>
          {pending ? <Icon name="loader" className="spin" size={14} /> : <Icon name="wallet" size={14} />}
          {connected ? " Salvar alterações" : " Conectar"}
        </button>
        {connected && (
          <button className="btn btn-ghost btn-sm" type="button" onClick={disconnect} disabled={pending}>
            Desconectar
          </button>
        )}
      </div>

      {offline && <BackendNotice message={notice ?? GENERIC_BACKEND_NOTICE} />}
    </div>
  );
}
