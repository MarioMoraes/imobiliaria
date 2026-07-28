"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../../components/Icon";
import { EmptyState } from "../../../components/ui";
import { loadInspectionAction, saveInspectionAction } from "./actions";
import type { InspectionCondition, PropertyInspectionView } from "../../../lib/api";

/**
 * Cadastro de Vistoria do imóvel — espelha a tela legada: uma linha por item do
 * catálogo, com Qtde, o estado (Bom/Médio/Ruim) e Observações.
 *
 * Abre POR CIMA do formulário de imóvel (zIndex acima do modal do form, como o
 * seletor de proprietários já faz). O preenchimento fica só na memória até o
 * "Confirmar" — é uma grade inteira, salvar linha a linha faria uma chamada por
 * tecla digitada.
 */

/** `cls` carrega a cor semântica da coluna (verde/âmbar/vermelho) via `--cond`. */
const CONDITIONS: { value: InspectionCondition; label: string; cls: string }[] = [
  { value: "BOM", label: "Bom", cls: "insp-cond-bom" },
  { value: "MEDIO", label: "Médio", cls: "insp-cond-medio" },
  { value: "RUIM", label: "Ruim", cls: "insp-cond-ruim" },
];

/** O que o usuário editou, por id de linha. */
interface Draft {
  quantity: number;
  condition: InspectionCondition | null;
  notes: string;
}

export default function InspectionModal({
  propertyId,
  onClose,
}: {
  propertyId: string;
  onClose: () => void;
}) {
  const [view, setView] = useState<PropertyInspectionView | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadInspectionAction(propertyId).then((res) => {
      if (!alive) return;
      if (!res.ok || !res.view) {
        setError(res.error ?? "Não foi possível carregar a vistoria.");
      } else {
        setView(res.view);
        setDrafts(
          Object.fromEntries(
            res.view.entries.map((e) => [
              e.id,
              { quantity: e.quantity, condition: e.condition, notes: e.notes ?? "" },
            ]),
          ),
        );
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [propertyId]);

  function patch(id: string, changes: Partial<Draft>) {
    setSaved(false);
    setDrafts((prev) => {
      const current = prev[id];
      if (!current) return prev;
      return { ...prev, [id]: { ...current, ...changes } };
    });
  }

  /**
   * As três caixas são mutuamente exclusivas (a coluna no banco é uma só).
   * Clicar na que já está marcada limpa o estado — é como o usuário desfaz.
   */
  function toggleCondition(id: string, value: InspectionCondition) {
    const current = drafts[id];
    if (!current) return;
    patch(id, { condition: current.condition === value ? null : value });
  }

  // Progresso do preenchimento: um item conta como avaliado quando recebe um
  // estado. Qtde sozinha não basta — é o estado que o laudo precisa registrar.
  const total = view?.entries.length ?? 0;
  const avaliados = Object.values(drafts).filter((d) => d.condition !== null).length;

  function submit() {
    if (!view) return;
    setError(null);
    startTransition(async () => {
      const entries = view.entries.map((e) => {
        const draft = drafts[e.id];
        return {
          id: e.id,
          quantity: draft?.quantity ?? 0,
          condition: draft?.condition ?? null,
          notes: draft?.notes.trim() ? draft.notes.trim() : null,
        };
      });
      const res = await saveInspectionAction(propertyId, entries, null);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar a vistoria.");
        return;
      }
      setSaved(true);
    });
  }

  const modal = (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "5vh 16px",
        overflowY: "auto",
        zIndex: 2500,
      }}
    >
      <div
        className="card card-pad stack modal-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{ gap: 14, width: 1100, maxWidth: "96vw", boxShadow: "0 20px 60px rgba(0,0,0,.30)" }}
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="insp-title">
            <span className="insp-title-chip">
              <Icon name="list" size={16} />
            </span>
            <span className="insp-title-text">Cadastro de Vistoria</span>
          </span>
          <button className="icon-btn" type="button" aria-label="Fechar" onClick={onClose}>
            <Icon name="close" size={15} />
          </button>
        </div>

        {view && (
          <div className="insp-hero">
            <div className="insp-hero-grid">
              <div className="insp-hero-seq">
                <span>Nº</span>
                <strong>{view.inspection.seq ?? "—"}</strong>
              </div>
              <div className="insp-hero-sep" />
              <div className="insp-hero-item">
                <div className="insp-hero-label">Imóvel</div>
                <div className="insp-hero-value">{view.property.code ?? "—"}</div>
              </div>
              <div className="insp-hero-item grow">
                <div className="insp-hero-label">Endereço</div>
                <div className="insp-hero-value">{view.property.address}</div>
              </div>
            </div>

            {total > 0 && (
              <div className="insp-progress">
                <div className="insp-progress-head">
                  <span>Itens avaliados</span>
                  <span>
                    {avaliados} de {total}
                  </span>
                </div>
                <div className="insp-progress-track">
                  <div
                    className="insp-progress-fill"
                    style={{ width: `${(avaliados / total) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="modal-scroll">
          {loading && (
            <div className="row" style={{ gap: 8, padding: "24px 0", justifyContent: "center" }}>
              <Icon name="loader" size={16} />
              <span className="subtle text-sm">Carregando itens…</span>
            </div>
          )}

          {!loading && view && view.entries.length === 0 && (
            <EmptyState
              icon="list"
              title="Nenhum item de vistoria cadastrado"
              hint="A lista da vistoria nasce do cadastro de Itens de Vistoria. Cadastre os itens em Tabelas e reabra esta tela."
            />
          )}

          {!loading && view && view.entries.length > 0 && (
            <div className="insp-grid">
              <table className="table">
                <thead>
                  <tr>
                    <th className="insp-num">Cód</th>
                    <th>Descrição</th>
                    <th className="insp-qty-col">Qtde</th>
                    {CONDITIONS.map((c) => (
                      <th key={c.value} className={`insp-cond ${c.cls}`}>
                        {c.label}
                      </th>
                    ))}
                    <th>Observações</th>
                  </tr>
                </thead>
                <tbody>
                  {view.entries.map((entry, i) => {
                    const draft = drafts[entry.id];
                    return (
                      // `data-cond` pinta a barra lateral da linha com a cor do
                      // estado — é o que torna a coluna legível de relance.
                      <tr key={entry.id} data-cond={draft?.condition ?? undefined}>
                        <td className="insp-num">{i + 1}</td>
                        <td className="insp-desc">{entry.description}</td>
                        <td className="insp-qty-col">
                          <input
                            className="input insp-qty"
                            inputMode="numeric"
                            value={draft?.quantity ?? 0}
                            onChange={(e) =>
                              patch(entry.id, {
                                // Só dígitos: o campo é uma contagem de peças.
                                quantity: Number(e.target.value.replace(/\D/g, "")) || 0,
                              })
                            }
                          />
                        </td>
                        {CONDITIONS.map((c) => (
                          <td key={c.value} className={`insp-cond ${c.cls}`}>
                            <input
                              type="checkbox"
                              className="insp-check"
                              aria-label={`${entry.description} — ${c.label}`}
                              checked={draft?.condition === c.value}
                              onChange={() => toggleCondition(entry.id, c.value)}
                            />
                          </td>
                        ))}
                        <td>
                          <input
                            className="input insp-notes"
                            placeholder="—"
                            value={draft?.notes ?? ""}
                            onChange={(e) => patch(entry.id, { notes: e.target.value })}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {error && (
          <span className="text-sm" style={{ color: "var(--danger, #dc2626)" }}>
            {error}
          </span>
        )}
        {saved && !error && (
          <span className="badge badge-green" style={{ alignSelf: "flex-start" }}>
            <Icon name="check" size={12} /> Vistoria salva
          </span>
        )}

        <div
          className="row"
          style={{
            justifyContent: "space-between",
            gap: 8,
            borderTop: "1px solid var(--border)",
            paddingTop: 12,
          }}
        >
          {/* `<a>` e não `window.open`: o resultado é um arquivo, e assim o PDF
              abre no visualizador nativo sem esbarrar no bloqueador de pop-up. */}
          <a
            className="btn btn-outline btn-sm"
            href={`/imoveis/${propertyId}/vistoria`}
            target="_blank"
            rel="noopener"
          >
            <Icon name="printer" size={14} /> Imprimir
          </a>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>
              Fechar
            </button>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={submit}
              disabled={pending || loading || !view || view.entries.length === 0}
            >
              {pending ? "Salvando…" : "Confirmar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
