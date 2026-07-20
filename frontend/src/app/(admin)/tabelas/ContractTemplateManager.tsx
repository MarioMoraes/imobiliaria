"use client";

import { useLayoutEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
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
}: {
  templates: ContractTemplate[];
  mergeFields: MergeField[];
  live: boolean;
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
  /** Onde o cursor estava por último dentro do textarea. */
  const caretRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 });
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
    caretRef.current = { start: form.content.length, end: form.content.length };
    pendingCaretRef.current = null;
    setEditing({ id, form });
  }

  /** Guarda o cursor a cada movimento: abrir o dropdown tira o foco do textarea. */
  function rememberCaret() {
    const el = textRef.current;
    if (el) caretRef.current = { start: el.selectionStart, end: el.selectionEnd };
  }

  /**
   * Reposiciona o cursor DEPOIS que o React aplica o texto novo. Fazer isso
   * antes do commit (síncrono ou via requestAnimationFrame) não funciona: a
   * re-renderização do textarea controlado joga o cursor para o fim.
   */
  useLayoutEffect(() => {
    const el = textRef.current;
    const caret = pendingCaretRef.current;
    if (!el || caret === null) return;
    pendingCaretRef.current = null;
    el.focus();
    el.setSelectionRange(caret, caret);
  });

  /** Insere `{{chave}}` na posição em que o cursor estava (ou no fim). */
  function insertVariable(key: string) {
    const token = `{{${key}}}`;
    const content = editing?.form.content ?? "";
    setLastInserted(key);

    // O texto pode ter encolhido desde o último clique — não deixa a posição
    // gravada apontar para fora do conteúdo atual.
    const start = Math.min(caretRef.current.start, content.length);
    const end = Math.min(Math.max(caretRef.current.end, start), content.length);

    set({ content: `${content.slice(0, start)}${token}${content.slice(end)}` });

    const after = start + token.length;
    caretRef.current = { start: after, end: after };
    pendingCaretRef.current = after;
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
              className="input"
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
            Ativo (disponível para novos contratos)
          </label>
        </div>

        <div className="stack" style={{ gap: 6 }}>
          <span className="text-sm strong">Variáveis dinâmicas</span>
          <span className="text-xs subtle">
            Escolha o campo em cada lista para inseri-lo no ponto do cursor. Na geração do PDF
            eles são trocados pelos dados do contrato.
          </span>
          {/* Um dropdown por grupo: Locador, Locatário, Fiador, Imóvel e Contrato. */}
          <div className="grid grid-3" style={{ gap: 10, marginTop: 4 }}>
            {groups.map(([group, fields]) => (
              <div key={group} className="field">
                <label>{group}</label>
                <select
                  className="input"
                  value=""
                  // Em pré-visualização o textarea está desmontado: inserir aqui
                  // jogaria a variável no fim do HTML sem o usuário ver.
                  disabled={preview}
                  onChange={(e) => {
                    if (e.target.value) insertVariable(e.target.value);
                    // Volta ao placeholder: o select é um gatilho, não um estado.
                    e.target.value = "";
                  }}
                >
                  <option value="">Inserir campo…</option>
                  {fields.map((f) => (
                    <option key={f.key} value={f.key} title={`{{${f.key}}} — ex.: ${f.example}`}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {lastInserted && (
            <span className="text-xs subtle">
              <Icon name="check" size={12} /> Inserido <code>{`{{${lastInserted}}}`}</code>
            </span>
          )}
        </div>

        <div className="field">
          <label>Texto do contrato *</label>
          {preview ? (
            <iframe
              title="Pré-visualização do modelo"
              sandbox=""
              srcDoc={previewHtml}
              style={{
                width: "100%",
                height: 340,
                border: "1px solid var(--border, #e2e8f0)",
                borderRadius: 8,
                background: "#fff",
              }}
            />
          ) : (
            <textarea
              ref={textRef}
              className="input"
              rows={16}
              value={editing.form.content}
              onChange={(e) => {
                set({ content: e.target.value });
                rememberCaret();
              }}
              // `select` cobre digitação, clique e navegação por teclado.
              onSelect={rememberCaret}
              placeholder={
                "CONTRATO DE LOCAÇÃO RESIDENCIAL\n\n" +
                "LOCADOR: {{locador.nome}}, inscrito no CPF sob nº {{locador.cpf_cnpj}}.\n" +
                "LOCATÁRIO: {{locatario.nome}}, CPF {{locatario.cpf_cnpj}}.\n\n" +
                "CLÁUSULA 1ª — O imóvel situado em {{imovel.endereco}} fica locado pelo\n" +
                "prazo de {{contrato.meses}} meses…"
              }
              style={{ resize: "vertical", lineHeight: 1.6 }}
            />
          )}
          <span className="text-xs subtle">
            Escreva em texto corrido — sem HTML. Uma linha em branco separa parágrafos; a
            formatação do documento (fonte, margens, justificação) é aplicada na geração do PDF.
          </span>
        </div>

        {error && <span className="badge badge-red">{error}</span>}

        <div className="row" style={{ justifyContent: "space-between" }}>
          <button className="btn btn-ghost btn-sm" type="button" onClick={togglePreview} disabled={pending}>
            <Icon name={preview ? "edit" : "eye"} size={14} />
            {preview ? "Voltar ao texto" : "Pré-visualizar"}
          </button>
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

      {!live && (
        <span className="text-xs subtle">
          Backend offline — suba <code>npm run dev</code> para gravar.
        </span>
      )}
    </div>
  );
}
