"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { resendInviteAction } from "./actions";

/**
 * Ações do convite pendente de um membro (MOD-FUNC). Reenvia o convite e, se a
 * entrega do e-mail falhar, expõe o link do ticket para o admin repassar por
 * outro canal — o acesso não fica refém da caixa de entrada do convidado.
 *
 * O "copiar link" é um SEGUNDO clique, deliberadamente: escrever na área de
 * transferência depois de um `await` é bloqueado pelos navegadores (a permissão
 * exige o gesto do usuário na mesma tarefa).
 */
export function EmployeeInviteActions({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  function resend() {
    setError(null);
    setMessage(null);
    setCopied(false);
    startTransition(async () => {
      const res = await resendInviteAction(id);
      if (!res.ok) {
        setError(res.error ?? "Falha ao reenviar o convite.");
        return;
      }
      if (res.emailSent) {
        setMessage("Convite enviado por e-mail.");
        setUrl(null);
      } else {
        setMessage("E-mail não pôde ser enviado — copie o link e envie ao membro.");
        setUrl(res.url ?? null);
      }
      router.refresh();
    });
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setError("Não foi possível copiar. Selecione o link manualmente.");
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
      <div className="row gap-8">
        <button
          className="icon-btn"
          style={{ width: 30, height: 30 }}
          type="button"
          onClick={resend}
          disabled={pending}
          aria-label={`Reenviar convite para ${name}`}
          title="Reenviar convite"
        >
          <Icon name={pending ? "loader" : "mail"} className={pending ? "spin" : undefined} size={15} />
        </button>
        {url && (
          <button
            className="icon-btn"
            style={{ width: 30, height: 30 }}
            type="button"
            onClick={copy}
            aria-label={`Copiar link do convite de ${name}`}
            title="Copiar link do convite"
          >
            <Icon name={copied ? "check" : "link"} size={15} />
          </button>
        )}
      </div>
      {(message || error) && (
        <span style={{ fontSize: "0.72rem", color: "var(--muted)", textAlign: "right", maxWidth: 220 }}>
          {error ?? (copied ? "Link copiado." : message)}
        </span>
      )}
    </div>
  );
}
