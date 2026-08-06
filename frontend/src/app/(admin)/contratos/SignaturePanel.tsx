"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import type { ContractParty, SignatureEnvelope } from "../../../lib/api";
import {
  generateContractPdfAction,
  linkTemplateAction,
  loadSignatureAction,
  sendToSignAction,
  syncSignatureAction,
} from "./actions";
import { initials } from "../../../components/ui";
import type { Opt } from "./ContractFormButton";

const SIGNER_LABEL: Record<string, string> = {
  PENDENTE: "Aguardando",
  ASSINADO: "Assinado",
  RECUSADO: "Recusado",
};

const ENVELOPE_LABEL: Record<string, string> = {
  PENDENTE: "Em assinatura",
  ASSINADO: "Assinado por todos",
  RECUSADO: "Recusado",
  CANCELADO: "Cancelado",
  EXPIRADO: "Expirado",
};

const ROLE_LABEL: Record<string, string> = {
  LOCADOR: "Locador",
  LOCATARIO: "Locatário",
  FIADOR: "Fiador",
};

/** Cor do papel — a mesma das abas Locatários/Fiadores da ficha. */
const ROLE_TONE: Record<string, string> = {
  LOCADOR: "tone-azul",
  LOCATARIO: "tone-indigo",
  FIADOR: "tone-teal",
};

/** dd/mm/aaaa hh:mm */
function dateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}

/**
 * Aba "Assinatura" do contrato: envia o documento ao provedor (ZapSign),
 * acompanha quem já assinou e sincroniza o estado sob demanda — necessário em
 * desenvolvimento, onde o webhook não alcança a máquina local.
 */
export function SignaturePanel({
  contractId,
  isEdit,
  templates,
  templateId,
  onTemplateChange,
  parties,
}: {
  contractId?: string;
  isEdit: boolean;
  /** Modelos ativos do tenant (cadastrados em Tabelas → Modelos de Contrato). */
  templates: Opt[];
  /** Modelo vinculado hoje ao contrato ("" = padrão do tenant). */
  templateId: string;
  /** Mantém o formulário em sincronia — senão o "Salvar" reescreveria o antigo. */
  onTemplateChange: (templateId: string) => void;
  /** Partes já vinculadas ao contrato (locador vem do dono do imóvel). */
  parties: ContractParty[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [envelope, setEnvelope] = useState<SignatureEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  const [generating, setGenerating] = useState(false);

  const load = useCallback(async () => {
    if (!contractId) return;
    setLoading(true);
    const res = await loadSignatureAction(contractId);
    if (!res.ok) setError(res.error ?? "Falha ao carregar a assinatura.");
    else setEnvelope(res.envelope ?? null);
    setLoading(false);
  }, [contractId]);

  useEffect(() => {
    void load();
  }, [load]);

  function run(action: (id: string) => Promise<{ ok: boolean; envelope?: SignatureEnvelope; error?: string }>) {
    if (!contractId) return;
    setError(null);
    startTransition(async () => {
      const res = await action(contractId);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível concluir a operação.");
        return;
      }
      setEnvelope(res.envelope ?? null);
      router.refresh();
    });
  }

  /** Troca o modelo e grava na hora (ver linkTemplateAction). */
  function selectTemplate(next: string) {
    if (!contractId) return;
    const previous = templateId;
    onTemplateChange(next);
    setError(null);
    setLinking(true);
    void (async () => {
      const res = await linkTemplateAction(contractId, next);
      setLinking(false);
      if (!res.ok) {
        onTemplateChange(previous); // desfaz: o vínculo não foi gravado
        setError(res.error ?? "Não foi possível vincular o modelo.");
        return;
      }
      router.refresh();
    })();
  }

  /** Gera o PDF a partir do modelo vinculado e abre numa nova aba. */
  function previewPdf() {
    if (!contractId) return;
    setError(null);
    setGenerating(true);
    void (async () => {
      const res = await generateContractPdfAction(contractId);
      setGenerating(false);
      if (!res.ok || !res.url) {
        setError(res.error ?? "Não foi possível gerar o contrato.");
        return;
      }
      window.open(res.url, "_blank", "noopener,noreferrer");
      router.refresh();
    })();
  }

  async function copy(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(id);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Não foi possível copiar o link.");
    }
  }

  if (!isEdit || !contractId) {
    return (
      <p className="text-sm subtle" style={{ padding: "8px 0" }}>
        <Icon name="plus" size={14} /> Salve o contrato primeiro para enviá-lo para assinatura.
      </p>
    );
  }

  const signed = envelope?.signers.filter((s) => s.status === "ASSINADO").length ?? 0;
  const total = envelope?.signers.length ?? 0;

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="field">
        <label>
          Modelo do contrato{" "}
          {linking && <Icon name="loader" className="spin" size={12} />}
        </label>
        <select
          className="input"
          value={templateId}
          disabled={pending || linking || envelope?.status === "ASSINADO"}
          onChange={(e) => selectTemplate(e.target.value)}
        >
          <option value="">Padrão do Tenant (primeiro modelo ativo)</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
        {templates.length === 0 && (
          <span className="text-xs subtle">
            Nenhum modelo cadastrado — crie um em Tabelas → Modelos de Contrato.
          </span>
        )}
      </div>

      <div className="row">
        <button
          className="btn btn-outline btn-sm"
          type="button"
          onClick={previewPdf}
          disabled={generating || pending || linking}
        >
          <Icon name={generating ? "loader" : "contract"} className={generating ? "spin" : undefined} size={14} />
          {generating ? " Gerando…" : " Visualizar contrato (PDF)"}
        </button>
      </div>

      {loading ? (
        <span className="text-sm subtle">
          <Icon name="loader" className="spin" size={14} /> Carregando…
        </span>
      ) : !envelope ? (
        <div className="stack" style={{ gap: 10 }}>
          {/* Quem vai assinar, ANTES de enviar: o locador vem do proprietário do
              imóvel, então é útil conferir aqui em vez de descobrir no erro. */}
          <span className="text-sm strong">Partes que vão assinar</span>
          {parties.length === 0 ? (
            <span className="text-xs subtle">
              Nenhuma parte vinculada. Selecione o imóvel (o proprietário entra como locador) e
              adicione o locatário na aba Locatários.
            </span>
          ) : (
            <div className="stack" style={{ gap: 6 }}>
              {parties.map((p) => (
                <div
                  key={p.id}
                  className={`row ${ROLE_TONE[p.role] ?? "tone-muted"}`}
                  style={{ justifyContent: "space-between", border: "1px solid var(--border)", borderRadius: 8, padding: "6px 12px" }}
                >
                  <span className="row gap-8">
                    <span className="avatar-initials">{initials(p.personName)}</span>
                    <span className="text-sm strong">{p.personName}</span>
                  </span>
                  <span className="badge badge-tone">{ROLE_LABEL[p.role] ?? p.role}</span>
                </div>
              ))}
            </div>
          )}
          <span className="text-xs subtle">
            O PDF é gerado a partir do modelo e enviado a cada parte por e-mail, com trilha de
            auditoria e validade jurídica (MP 2.200-2/2001).
          </span>
        </div>
      ) : (
        <>
          <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
            <div className="row gap-8">
              <span className={`badge ${envelope.status === "ASSINADO" ? "badge-green" : "badge-slate"}`}>
                {ENVELOPE_LABEL[envelope.status] ?? envelope.status}
              </span>
              <span className="text-sm subtle">
                {signed} de {total} assinaram · enviado em {dateTime(envelope.createdAt)}
              </span>
            </div>
            {envelope.sandbox && (
              <span className="badge badge-red" title="Ambiente de testes: sem validade jurídica">
                Sandbox
              </span>
            )}
          </div>

          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Parte</th>
                  <th style={{ width: "26%" }}>E-mail</th>
                  <th style={{ width: 120 }}>Situação</th>
                  <th style={{ width: 150 }}>Assinado em</th>
                  <th style={{ width: 44 }} />
                </tr>
              </thead>
              <tbody>
                {envelope.signers.map((s) => (
                  <tr key={s.id}>
                    <td className={ROLE_TONE[s.role ?? ""] ?? "tone-muted"}>
                      <span className="row gap-8">
                        <span className="avatar-initials">{initials(s.name)}</span>
                        <span>
                          <span className="strong">{s.name}</span>
                          {s.role && (
                            <span className="text-xs subtle"> · {ROLE_LABEL[s.role] ?? s.role}</span>
                          )}
                        </span>
                      </span>
                    </td>
                    <td className="text-sm">{s.email ?? "—"}</td>
                    <td>
                      <span className={`badge ${s.status === "ASSINADO" ? "badge-green" : "badge-slate"}`}>
                        {SIGNER_LABEL[s.status] ?? s.status}
                      </span>
                    </td>
                    <td className="text-sm">{dateTime(s.signedAt)}</td>
                    <td style={{ textAlign: "right" }}>
                      {s.signUrl && s.status !== "ASSINADO" && (
                        <button
                          className="icon-btn"
                          style={{ width: 30, height: 30 }}
                          type="button"
                          aria-label={`Copiar link de assinatura de ${s.name}`}
                          title="Copiar link de assinatura"
                          onClick={() => void copy(s.signUrl!, s.id)}
                        >
                          <Icon name={copied === s.id ? "check" : "link"} size={15} />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {error && <span className="badge badge-red">{error}</span>}

      <div className="row gap-8" style={{ flexWrap: "wrap" }}>
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={pending || loading || envelope?.status === "ASSINADO"}
          onClick={() => run(sendToSignAction)}
        >
          <Icon name={pending ? "loader" : "shield"} className={pending ? "spin" : undefined} size={14} />
          {envelope ? " Reenviar para assinatura" : " Enviar para assinatura"}
        </button>
        {envelope && (
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            disabled={pending || loading}
            onClick={() => run(syncSignatureAction)}
          >
            <Icon name="refresh" size={14} /> Sincronizar Status
          </button>
        )}
      </div>

      {envelope && envelope.status !== "ASSINADO" && (
        <span className="text-xs subtle">
          Cada parte recebe o convite por e-mail. Em desenvolvimento o webhook não chega até aqui —
          use &quot;Sincronizar status&quot; após assinar.
        </span>
      )}
      {envelope?.hasSignedPdf && (
        <span className="text-xs subtle">
          <Icon name="check" size={12} /> Contrato assinado arquivado como nova versão — abra pelo
          botão &quot;Contrato de Locação&quot;.
        </span>
      )}
    </div>
  );
}
