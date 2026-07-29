"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { useConfirm } from "./ConfirmDialog";
import { useToast } from "./Toast";
import { EmptyState } from "./ui";
import { formatDay } from "../lib/format";
import {
  addDocumentVersionAction,
  listDocumentsAction,
  purgeDocumentAction,
  uploadDocumentAction,
} from "../app/(admin)/documentos/actions";
import type { DocumentEntityType, DocumentRecord } from "../lib/api";

/**
 * Painel de documentos de uma entidade (MOD-DOC). É o mesmo componente na ficha
 * da pessoa e no cadastro do imóvel — o vínculo é polimórfico, então só mudam
 * `entityType`/`entityId`.
 *
 * O botão Baixar é um `<a>` para a URL presignada que já veio na listagem:
 * abrir a URL depois de um `await` seria bloqueado como popup pelo navegador.
 */

export const DOCUMENT_KINDS: { value: string; label: string }[] = [
  { value: "RG", label: "RG / Identidade" },
  { value: "CPF", label: "CPF / CNPJ" },
  { value: "RENDA", label: "Comprovante de renda" },
  { value: "MATRICULA", label: "Matrícula do imóvel" },
  { value: "CONTRATO", label: "Contrato" },
  { value: "OUTRO", label: "Outro" },
];

const KIND_LABEL: Record<string, string> = Object.fromEntries(
  DOCUMENT_KINDS.map((k) => [k.value, k.label]),
);

const ACCEPT = "application/pdf,image/png,image/jpeg,image/webp";
const MAX_BYTES = 5 * 1024 * 1024;

/** Arquivo → data URL, sem canvas: um PDF não sobrevive a `toDataURL`. */
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Falha ao ler o arquivo"));
    reader.readAsDataURL(file);
  });
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Quantos dias faltam para a validade (negativo = já venceu). */
function daysUntil(iso: string): number {
  const today = new Date().toISOString().slice(0, 10);
  return Math.round(
    (Date.parse(`${iso}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
  );
}

interface Props {
  entityType: DocumentEntityType;
  entityId: string;
}

export function DocumentsPanel({ entityType, entityId }: Props) {
  const confirm = useConfirm();
  const toast = useToast();
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState("RG");
  const [expiresAt, setExpiresAt] = useState("");

  const uploadRef = useRef<HTMLInputElement>(null);
  const versionRef = useRef<HTMLInputElement>(null);
  // Documento que a próxima escolha de arquivo vai substituir (Nova versão).
  const replacingRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await listDocumentsAction(entityType, entityId);
    if (res.ok) setDocuments(res.documents);
    else setError(res.error ?? "Não foi possível carregar os documentos.");
    setLoaded(true);
  }, [entityType, entityId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  /** Valida o que dá para saber no navegador antes de mandar 5 MB de base64. */
  function reject(file: File): string | null {
    if (file.size > MAX_BYTES) return "Arquivo acima do limite de 5 MB.";
    if (!ACCEPT.split(",").includes(file.type)) {
      return "Formato não aceito (use PDF, PNG, JPG ou WEBP).";
    }
    return null;
  }

  async function onPickUpload(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;
    const problem = reject(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await uploadDocumentAction({
        entityType,
        entityId,
        kind,
        fileName: file.name,
        dataUrl: await readFileAsDataUrl(file),
        expiresAt: expiresAt || undefined,
      });
      if (!res.ok) {
        setError(res.error ?? "Falha ao enviar o documento.");
        return;
      }
      setExpiresAt("");
      await refresh();
    } catch {
      setError("Não foi possível ler o arquivo.");
    } finally {
      setBusy(false);
      if (uploadRef.current) uploadRef.current.value = "";
    }
  }

  async function onPickVersion(files: FileList | null) {
    const file = files?.[0];
    const documentId = replacingRef.current;
    if (!file || !documentId) return;
    const problem = reject(file);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await addDocumentVersionAction(documentId, {
        fileName: file.name,
        dataUrl: await readFileAsDataUrl(file),
      });
      if (!res.ok) {
        setError(res.error ?? "Falha ao enviar a nova versão.");
        return;
      }
      await refresh();
    } catch {
      setError("Não foi possível ler o arquivo.");
    } finally {
      setBusy(false);
      replacingRef.current = null;
      if (versionRef.current) versionRef.current.value = "";
    }
  }

  function startVersion(documentId: string) {
    replacingRef.current = documentId;
    versionRef.current?.click();
  }

  async function onPurge(doc: DocumentRecord) {
    const ok = await confirm({
      eyebrow: "Expurgo LGPD",
      title: `Excluir "${doc.fileName ?? "documento"}"?`,
      message: "O arquivo e todas as versões anteriores são apagados definitivamente.",
      confirmLabel: "Excluir",
    });
    if (!ok) return;
    setError(null);
    setBusy(true);
    try {
      const res = await purgeDocumentAction(doc.id);
      if (!res.ok) {
        const msg = res.error ?? "Não foi possível excluir o documento.";
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success("Documento excluído.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="grid grid-3 mb-4">
        <div className="field">
          <label>Tipo</label>
          <select
            className="input"
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            disabled={busy}
          >
            {DOCUMENT_KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Validade</label>
          <input
            className="input"
            type="date"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            disabled={busy}
          />
        </div>
        <div className="field" style={{ justifyContent: "flex-end" }}>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => uploadRef.current?.click()}
            disabled={busy}
          >
            <Icon name="upload" /> {busy ? "Enviando…" : "Anexar arquivo"}
          </button>
        </div>
      </div>

      <input
        ref={uploadRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => void onPickUpload(e.target.files)}
      />
      <input
        ref={versionRef}
        type="file"
        accept={ACCEPT}
        hidden
        onChange={(e) => void onPickVersion(e.target.files)}
      />

      {error && (
        <p className="text-sm mb-4" style={{ color: "var(--danger)" }}>
          {error}
        </p>
      )}

      {!loaded ? (
        <p className="text-sm subtle">Carregando…</p>
      ) : documents.length === 0 ? (
        <EmptyState
          icon="folder"
          title="Nenhum documento anexado"
          hint="Anexe RG, comprovante de renda, matrícula — em PDF ou imagem, até 5 MB."
        />
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Documento</th>
                <th>Tipo</th>
                <th>Validade</th>
                <th>Versão</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id}>
                  <td>
                    <span className="strong">{doc.fileName ?? "—"}</span>
                    <span className="text-xs subtle"> · {formatSize(doc.sizeBytes)}</span>
                  </td>
                  <td>{KIND_LABEL[doc.kind] ?? doc.kind}</td>
                  <td className="text-sm">
                    {doc.expiresAt ? (
                      <ExpiryLabel iso={doc.expiresAt} expired={doc.expired} />
                    ) : (
                      <span className="subtle">—</span>
                    )}
                  </td>
                  <td className="text-sm subtle">v{doc.currentVersion}</td>
                  <td>
                    <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
                      {doc.url && (
                        <a
                          className="icon-btn"
                          style={{ width: 30, height: 30 }}
                          href={doc.url}
                          target="_blank"
                          rel="noopener"
                          aria-label="Baixar"
                          title="Baixar"
                        >
                          <Icon name="arrowUpRight" size={15} />
                        </a>
                      )}
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ width: 30, height: 30 }}
                        onClick={() => startVersion(doc.id)}
                        disabled={busy}
                        aria-label="Enviar nova versão"
                        title="Enviar nova versão"
                      >
                        <Icon name="refresh" size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        style={{ width: 30, height: 30 }}
                        onClick={() => void onPurge(doc)}
                        disabled={busy}
                        aria-label="Excluir"
                        title="Excluir"
                      >
                        <Icon name="trash" size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Validade com o aviso na cor certa: vencido, vencendo ou em dia. */
function ExpiryLabel({ iso, expired }: { iso: string; expired: boolean }) {
  const days = daysUntil(iso);
  if (expired) {
    return <span style={{ color: "var(--danger)" }}>{formatDay(iso)} · vencido</span>;
  }
  if (days <= 30) {
    return (
      <span style={{ color: "var(--warning)" }}>
        {formatDay(iso)} · {days === 0 ? "vence hoje" : `${days}d`}
      </span>
    );
  }
  return <>{formatDay(iso)}</>;
}
