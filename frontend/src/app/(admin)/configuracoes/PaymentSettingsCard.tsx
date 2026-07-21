"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import type { PaymentSettings } from "../../../lib/api";
import { disconnectPaymentAction, savePaymentSettingsAction } from "./actions";

/**
 * Formas de recebimento. O rótulo explica o efeito prático — é o que o inquilino
 * vai encontrar ao abrir a cobrança.
 */
const BILLING_TYPES: { value: string; label: string; hint: string }[] = [
  {
    value: "UNDEFINED",
    label: "Boleto + PIX (o inquilino escolhe)",
    hint: "Abre uma fatura com o boleto e o QR Code PIX. O PIX compensa na hora; o boleto, em D+1.",
  },
  {
    value: "BOLETO",
    label: "Somente boleto",
    hint: "O botão da parcela abre direto o PDF do boleto registrado.",
  },
  {
    value: "PIX",
    label: "Somente PIX",
    hint: "Compensação imediata e sem tarifa de boleto, mas exclui quem paga em lotérica.",
  },
];

/**
 * Conexão da conta Asaas do tenant. A chave é write-only: uma vez salva, a tela
 * só exibe os últimos 4 caracteres.
 */
export function PaymentSettingsCard({ settings }: { settings: PaymentSettings | null }) {
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
        <span className="text-xs subtle">
          Asaas → Configurações → Integrações → Chave de API. A chave é gravada cifrada e nunca
          volta a ser exibida. Use a chave do ambiente correspondente à opção abaixo.
        </span>
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
        <span className="text-xs subtle">
          {BILLING_TYPES.find((b) => b.value === billingType)?.hint}
        </span>
      </div>

      <label className="row gap-8 text-sm" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} />
        Ambiente de testes (sandbox) — cobranças <strong>fictícias</strong>, sem dinheiro real
      </label>

      <div className="field">
        <label>URL do webhook</label>
        <input className="input" readOnly value={settings?.webhookUrl ?? "—"} />
        <span className="text-xs subtle">
          {settings?.webhookRegisteredAt
            ? "Registrado automaticamente no Asaas — o pagamento dá baixa sozinho na parcela."
            : "Em ambiente local o Asaas não alcança esta URL — a baixa sai pelo botão da parcela."}
        </span>
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

      {offline && (
        <span className="text-xs subtle">
          Backend offline — suba <code>npm run dev</code> para configurar.
        </span>
      )}
    </div>
  );
}
