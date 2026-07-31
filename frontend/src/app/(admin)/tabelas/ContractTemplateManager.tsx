"use client";

import { useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { BackendNotice, GENERIC_BACKEND_NOTICE } from "../../../components/BackendNotice";
import type { ContractTemplate, MergeField } from "../../../lib/api";
import {
  deleteContractTemplateAction,
  previewContractTemplateAction,
  saveContractTemplateAction,
  type ContractTemplateFormInput,
} from "./actions";

const EMPTY: ContractTemplateFormInput = { name: "", content: "", active: true };

/**
 * Gerenciador de Modelos de Contrato: lista + editor do texto do contrato com a
 * paleta de variáveis dinâmicas (merge fields) vinda do backend. O modelo é
 * escrito em TEXTO PURO — a formatação do documento é aplicada na geração do
 * PDF (Gotenberg). A pré-visualização é renderizada pelo backend, pelo mesmo
 * caminho do PDF, e exibida num iframe isolado.
 */
export function ContractTemplateManager({
  templates,
  mergeFields,
  live,
  notice,
}: {
  templates: ContractTemplate[];
  mergeFields: MergeField[];
  live: boolean;
  /** Por que não está disponível — vem do `backendNotice()` de quem renderiza. */
  notice?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<{ id: string | null; form: ContractTemplateFormInput } | null>(null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [lastInserted, setLastInserted] = useState<string | null>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [previewHtml, setPreviewHtml] = useState<string>("");
  /** Posição a restaurar no próximo commit (null = nada a fazer). */
  const pendingCaretRef = useRef<number | null>(null);

  const groups = useMemo(() => {
    const byGroup = new Map<string, MergeField[]>();
    for (const f of mergeFields) {
      const list = byGroup.get(f.group) ?? [];
      list.push(f);
      byGroup.set(f.group, list);
    }
    return [...byGroup.entries()];
  }, [mergeFields]);

  const set = (patch: Partial<ContractTemplateFormInput>) =>
    setEditing((e) => (e ? { ...e, form: { ...e.form, ...patch } } : e));

  /**
   * Abre o editor. Sem clique prévio no texto, o cursor começa no fim — é onde
   * a pessoa espera que a primeira variável entre.
   */
  function openEditor(id: string | null, form: ContractTemplateFormInput) {
    setError(null);
    setPreview(false);
    pendingCaretRef.current = null;
    setEditing({ id, form });
  }

  /**
   * Reposiciona o cursor depois que o React aplica o texto — usado só pelo
   * caminho de reserva (navegador sem `execCommand`), em que a reescrita do
   * textarea controlado joga o cursor para o fim.
   */
  useLayoutEffect(() => {
    const el = textRef.current;
    const caret = pendingCaretRef.current;
    if (!el || caret === null) return;
    pendingCaretRef.current = null;
    el.focus();
    el.setSelectionRange(caret, caret);
  });

  /**
   * Escreve `text` sobre a seleção atual do textarea e devolve o cursor para
   * depois do que foi inserido (recuando `backUp` caracteres, para parar dentro
   * de um par de marcadores vazio).
   *
   * A posição é lida DO DOM na hora do clique, não de um estado nosso: o
   * textarea preserva `selectionStart/End` mesmo depois de perder o foco para o
   * botão ou o dropdown. Rastrear a posição por eventos era o que estava
   * falhando — clicar no meio do texto não dispara `select`, e a última posição
   * conhecida continuava sendo o fim.
   *
   * `execCommand("insertText")` é o caminho preferido mesmo estando obsoleto:
   * é a única forma de escrever num textarea preservando o **desfazer** do
   * navegador (Ctrl+Z) e a rolagem. Ele dispara `input`, então o `onChange` do
   * React sincroniza o estado sozinho.
   */
  function writeAtSelection(text: string, backUp = 0) {
    const el = textRef.current;
    if (!el) return;

    const start = el.selectionStart;
    const end = el.selectionEnd;
    el.focus();
    el.setSelectionRange(start, end);

    let inserted = false;
    try {
      inserted = document.execCommand("insertText", false, text);
    } catch {
      inserted = false;
    }

    if (inserted) {
      if (backUp > 0) {
        const caret = el.selectionStart - backUp;
        el.setSelectionRange(caret, caret);
      }
      return;
    }

    // Reserva: monta o novo conteúdo à mão e recoloca o cursor no efeito acima.
    const content = editing?.form.content ?? "";
    set({ content: `${content.slice(0, start)}${text}${content.slice(end)}` });
    pendingCaretRef.current = start + text.length - backUp;
  }

  /** Insere `{{chave}}` no ponto do cursor. */
  function insertVariable(key: string) {
    setLastInserted(key);
    writeAtSelection(`{{${key}}}`);
  }

  /**
   * Envolve o trecho selecionado com os marcadores de ênfase (`**` / `_`). Sem
   * seleção, insere o par vazio e deixa o cursor no meio, para a pessoa digitar
   * dentro.
   */
  function wrapSelection(marker: string) {
    const el = textRef.current;
    if (!el) return;
    const selected = el.value.slice(el.selectionStart, el.selectionEnd);
    writeAtSelection(`${marker}${selected}${marker}`, selected ? 0 : marker.length);
  }

  function save() {
    if (!editing) return;
    setError(null);
    startTransition(async () => {
      const res = await saveContractTemplateAction(editing.id, editing.form);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar.");
        return;
      }
      setEditing(null);
      setPreview(false);
      router.refresh();
    });
  }

  function remove(id: string) {
    setError(null);
    setRemovingId(id);
    startTransition(async () => {
      const res = await deleteContractTemplateAction(id);
      if (!res.ok) setError(res.error ?? "Falha ao remover.");
      else router.refresh();
      setRemovingId(null);
    });
  }

  /** Alterna a pré-visualização, buscando o HTML final no backend. */
  function togglePreview() {
    if (preview) {
      setPreview(false);
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await previewContractTemplateAction(editing?.form.content ?? "");
      if (!res.ok) {
        setError(res.error ?? "Não foi possível pré-visualizar.");
        return;
      }
      setPreviewHtml(res.html ?? "");
      setPreview(true);
    });
  }

  /* ------------------------------------------------------------ Editor */
  if (editing) {
    return (
      <div className="card-pad stack" style={{ gap: 12 }}>
        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label>Nome do modelo *</label>
            <input
              className="input input-soft"
              value={editing.form.name}
              onChange={(e) => set({ name: e.target.value })}
              placeholder="Ex.: Contrato de Locação Residencial"
              autoFocus
            />
          </div>
          <label className="row gap-8 text-sm" style={{ cursor: "pointer", alignSelf: "end", height: 38 }}>
            <input
              type="checkbox"
              checked={editing.form.active}
              onChange={(e) => set({ active: e.target.checked })}
            />
            Disponível para novos contratos
          </label>
        </div>

        <div className="field">
          <label>Texto do contrato *</label>

          {/* Uma barra só, colada à área de escrita: os cinco dropdowns por
              grupo viraram um seletor com optgroup, e a pré-visualização entrou
              aqui em vez de ficar no rodapé. */}
          <div className="editor-toolbar">
            <select
              className="input input-sm"
              value=""
              // Em pré-visualização o textarea está desmontado: inserir aqui
              // jogaria a variável no fim do HTML sem o usuário ver.
              disabled={preview}
              onChange={(e) => {
                if (e.target.value) insertVariable(e.target.value);
                // Volta ao placeholder: o select é um gatilho, não um estado.
                e.target.value = "";
              }}
              style={{ maxWidth: 260 }}
            >
              <option value="">Inserir campo…</option>
              {groups.map(([group, fields]) => (
                <optgroup key={group} label={group}>
                  {fields.map((f) => (
                    <option key={f.key} value={f.key} title={`{{${f.key}}} — ex.: ${f.example}`}>
                      {f.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>

            <span className="editor-marks">
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                // Sem isto o clique tira o foco do texto e a seleção some da
                // vista antes de o comando rodar.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => wrapSelection("**")}
                disabled={preview}
                title="Negrito (**texto**)"
                aria-label="Negrito"
                style={{ fontWeight: 800 }}
              >
                N
              </button>
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => wrapSelection("_")}
                disabled={preview}
                title="Itálico (_texto_)"
                aria-label="Itálico"
                style={{ fontStyle: "italic", fontFamily: "Georgia, serif" }}
              >
                I
              </button>
            </span>

            {lastInserted && !preview && (
              <span className="text-xs subtle">
                <Icon name="check" size={12} /> <code>{`{{${lastInserted}}}`}</code> inserido
              </span>
            )}

            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={togglePreview}
              disabled={pending}
              style={{ marginLeft: "auto" }}
            >
              <Icon name={preview ? "edit" : "eye"} size={14} />
              {preview ? " Voltar ao texto" : " Pré-visualizar"}
            </button>
          </div>

          {preview ? (
            <iframe
              title="Pré-visualização do modelo"
              sandbox=""
              srcDoc={previewHtml}
              className="editor-surface"
              style={{ width: "100%", height: 420, background: "#fff" }}
            />
          ) : (
            <textarea
              ref={textRef}
              className="input editor-surface"
              rows={20}
              value={editing.form.content}
              onChange={(e) => set({ content: e.target.value })}
              placeholder={
                "CONTRATO DE LOCAÇÃO RESIDENCIAL\n\n" +
                "LOCADOR: {{locador.nome}}, inscrito no CPF sob nº {{locador.cpf_cnpj}}.\n" +
                "LOCATÁRIO: {{locatario.nome}}, CPF {{locatario.cpf_cnpj}}.\n\n" +
                "CLÁUSULA 1ª — O imóvel situado em {{imovel.endereco}} fica locado pelo\n" +
                "prazo de {{contrato.meses}} meses…"
              }
              style={{ resize: "vertical", lineHeight: 1.7 }}
            />
          )}
        </div>

        {error && <span className="badge badge-red">{error}</span>}

        <div className="row" style={{ justifyContent: "flex-end" }}>
          <div className="row gap-8">
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => {
                setEditing(null);
                setPreview(false);
                setError(null);
              }}
              disabled={pending}
            >
              Cancelar
            </button>
            <button className="btn btn-primary btn-sm" type="button" onClick={save} disabled={pending || !live}>
              {pending ? "Salvando…" : "Salvar modelo"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  /* ------------------------------------------------------------- Lista */
  return (
    <div className="card-pad stack" style={{ gap: 12 }}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Modelo</th>
              <th style={{ width: "30%" }}>Variáveis</th>
              <th style={{ width: 90 }}>Situação</th>
              <th style={{ width: 84 }} />
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 && (
              <tr>
                <td className="text-sm subtle" colSpan={4}>
                  Nenhum modelo cadastrado.
                </td>
              </tr>
            )}
            {templates.map((t) => (
              <tr key={t.id}>
                <td className="strong">{t.name}</td>
                <td className="text-xs subtle">
                  {t.variables.length === 0 ? "—" : `${t.variables.length} variáveis`}
                </td>
                <td>
                  <span className={`badge ${t.active ? "badge-green" : "badge-slate"}`}>
                    {t.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td style={{ textAlign: "right" }}>
                  <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
                    <button
                      className="icon-btn"
                      style={{ width: 30, height: 30 }}
                      type="button"
                      aria-label={`Editar ${t.name}`}
                      disabled={!live || pending}
                      onClick={() =>
                        openEditor(t.id, {
                          name: t.name,
                          content: t.content ?? "",
                          active: t.active,
                        })
                      }
                    >
                      <Icon name="edit" size={15} />
                    </button>
                    <button
                      className="icon-btn"
                      style={{ width: 30, height: 30 }}
                      type="button"
                      aria-label={`Remover ${t.name}`}
                      disabled={!live || pending}
                      onClick={() => remove(t.id)}
                    >
                      <Icon
                        name={removingId === t.id ? "loader" : "trash"}
                        className={removingId === t.id ? "spin" : undefined}
                        size={15}
                      />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {error && <span className="badge badge-red">{error}</span>}

      <div className="row">
        <button
          className="btn btn-primary btn-sm"
          type="button"
          disabled={!live}
          onClick={() => openEditor(null, EMPTY)}
        >
          <Icon name="plus" size={14} /> Novo modelo
        </button>
      </div>

      {!live && <BackendNotice message={notice ?? GENERIC_BACKEND_NOTICE} />}
    </div>
  );
}
