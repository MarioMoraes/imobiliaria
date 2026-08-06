"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BackendNotice, GENERIC_BACKEND_NOTICE } from "../../../components/BackendNotice";
import { Icon } from "../../../components/Icon";
import type { SignatureSettings } from "../../../lib/api";
import { disconnectSignatureAction, saveSignatureSettingsAction } from "./actions";

/**
 * Modos de assinatura oferecidos. A escolha define qual contato passa a ser
 * obrigatório no cadastro das partes (e-mail, celular ou certificado).
 */
const AUTH_MODES: { value: string; label: string }[] = [
  { value: "assinaturaTela-tokenEmail", label: "Assinatura em Tela + Token por E-mail" },
  { value: "assinaturaTela-tokenWhatsApp", label: "Assinatura em Tela + Token por WhatsApp" },
  { value: "assinaturaTela-tokenSms", label: "Assinatura em Tela + Token por SMS" },
  { value: "certificadoDigital", label: "Certificado Digital (ICP-Brasil)" },
];

/**
 * Conexão da conta ZapSign do tenant. O token é write-only: uma vez salvo, a
 * tela só exibe os últimos 4 caracteres.
 */
export function SignatureSettingsCard({
  settings,
  notice,
}: {
  settings: SignatureSettings | null;
  /** Por que não está disponível — vem do `backendNotice()` de quem renderiza. */
  notice?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [token, setToken] = useState("");
  const [sandbox, setSandbox] = useState(settings?.sandbox ?? true);
  const [authMode, setAuthMode] = useState(settings?.authMode ?? AUTH_MODES[0]!.value);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const offline = settings === null;
  const connected = settings?.connected ?? false;

  function save() {
    setError(null);
    setSaved(false);
    if (!connected && !token.trim()) {
      setError("Informe o token da API da ZapSign.");
      return;
    }
    startTransition(async () => {
      const res = await saveSignatureSettingsAction({ apiToken: token, sandbox, authMode });
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar.");
        return;
      }
      setToken("");
      setSaved(true);
      router.refresh();
    });
  }

  function disconnect() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const res = await disconnectSignatureAction();
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
          Contratos assinados eletronicamente com trilha de auditoria (MP 2.200-2/2001).
        </span>
        <span className={`badge ${connected ? "badge-green" : "badge-slate"}`}>
          {connected ? "Conectado" : "Não conectado"}
        </span>
      </div>

      <div className="field">
        <label>Token da API {connected && <span className="subtle">(salvo: ••••{settings?.tokenHint})</span>}</label>
        <input
          className="input"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={connected ? "Deixe em branco para manter o token atual" : "Cole aqui o token da ZapSign"}
          autoComplete="off"
        />
      </div>

      <div className="field">
        <label>Modo de Assinatura</label>
        <select className="input" value={authMode} onChange={(e) => setAuthMode(e.target.value)}>
          {AUTH_MODES.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <label className="row gap-8 text-sm" style={{ cursor: "pointer" }}>
        <input type="checkbox" checked={sandbox} onChange={(e) => setSandbox(e.target.checked)} />
        Ambiente de testes (sandbox) — documentos <strong>sem</strong> validade jurídica
      </label>

      <div className="field">
        <label>URL do Webhook</label>
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
          {pending ? <Icon name="loader" className="spin" size={14} /> : <Icon name="shield" size={14} />}
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
