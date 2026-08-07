"use client";

import { useState } from "react";
import { Icon } from "../../../../components/Icon";
import { Modal } from "../../../../components/Modal";

/**
 * Popup de período dos relatórios do financeiro: pede início e fim antes de
 * abrir o PDF.
 *
 * O "Gerar" é um `<a target="_blank">`, e não um `window.open`: o resultado é um
 * arquivo, e assim o PDF abre no visualizador nativo sem esbarrar no bloqueador
 * de pop-up (que dispara quando a aba nasce depois de um `await`). Mesmo desenho
 * de `imoveis/AdministrationContractModal.tsx`.
 *
 * As datas são montadas a partir do relógio LOCAL, nunca de `toISOString()`:
 * 1º de agosto às 00:00 em UTC-3 é 31 de julho em UTC, e o período viria com um
 * dia a menos para todo mundo no Brasil.
 */

/** `Date` → "AAAA-MM-DD" no fuso do usuário. */
function isoLocal(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${mm}-${dd}`;
}

/** Primeiro e último dia de um mês deslocado de `offset` a partir do corrente. */
function monthRange(offset: number): [string, string] {
  const today = new Date();
  const first = new Date(today.getFullYear(), today.getMonth() + offset, 1);
  // Dia 0 do mês seguinte = último dia deste — resolve fevereiro e os de 31 sem
  // tabela de tamanhos.
  const last = new Date(today.getFullYear(), today.getMonth() + offset + 1, 0);
  return [isoLocal(first), isoLocal(last)];
}

const PRESETS: { label: string; range: () => [string, string] }[] = [
  { label: "Mês atual", range: () => monthRange(0) },
  { label: "Mês anterior", range: () => monthRange(-1) },
  {
    label: "Últimos 3 meses",
    range: () => [monthRange(-2)[0], monthRange(0)[1]],
  },
  {
    label: "Ano",
    range: () => {
      const year = new Date().getFullYear();
      return [`${year}-01-01`, `${year}-12-31`];
    },
  },
];

export function PeriodDialog({
  kind,
  title,
  onClose,
}: {
  /** Chave do relatório — casa com `FINANCE_REPORTS` em `lib/api.ts`. */
  kind: string;
  title: string;
  onClose: () => void;
}) {
  // Abre no mês corrente: é o fechamento que se emite no dia a dia, e evita que
  // o primeiro clique caia num período vazio.
  const [defaultFrom, defaultTo] = monthRange(0);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  const invertido = Boolean(from && to) && from > to;
  const ready = Boolean(from && to) && !invertido;
  const href = `/financeiro/relatorios/pdf?${new URLSearchParams({
    tipo: kind,
    de: from,
    ate: to,
  })}`;

  const isPreset = ([a, b]: [string, string]): boolean => a === from && b === to;

  return (
    <Modal open onClose={onClose} title={title} subtitle="Período do relatório" icon="printer" centered>
      {/* `.modal-body` traz só 4px de padding — a convenção do app é o conteúdo
          do popup trazer o próprio respiro (mesmo que `.card-pad` faz nos demais
          modais). O topo maior afasta os atalhos de período da divisória do
          cabeçalho, onde nasciam colados. */}
      <div className="stack" style={{ gap: 14, padding: "22px 24px 24px" }}>
        <div className="row gap-8" style={{ flexWrap: "wrap" }}>
          {PRESETS.map((preset) => {
            const range = preset.range();
            return (
              <button
                key={preset.label}
                type="button"
                className={`btn btn-sm ${isPreset(range) ? "btn-primary" : "btn-ghost"}`}
                onClick={() => {
                  setFrom(range[0]);
                  setTo(range[1]);
                }}
              >
                {preset.label}
              </button>
            );
          })}
        </div>

        <div className="grid grid-2">
          <div className="field">
            <label htmlFor="periodo-de">Início</label>
            <input
              id="periodo-de"
              className="input"
              type="date"
              value={from}
              max={to || undefined}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="periodo-ate">Fim</label>
            <input
              id="periodo-ate"
              className="input"
              type="date"
              value={to}
              min={from || undefined}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>

        {invertido && (
          <span className="text-sm" style={{ color: "var(--danger, #dc2626)" }}>
            A data inicial não pode ser maior que a final.
          </span>
        )}

        <div
          className="row"
          style={{
            justifyContent: "flex-end",
            gap: 8,
            borderTop: "1px solid var(--border)",
            paddingTop: 12,
          }}
        >
          <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>
            Cancelar
          </button>
          {ready ? (
            <a
              className="btn btn-primary btn-sm"
              href={href}
              target="_blank"
              rel="noopener"
              onClick={onClose}
            >
              <Icon name="printer" size={14} /> Gerar Relatório
            </a>
          ) : (
            // Sem período válido vira um botão desabilitado de verdade: um `<a>`
            // "desabilitado" ainda navegaria ao ser clicado.
            <button className="btn btn-primary btn-sm" type="button" disabled>
              <Icon name="printer" size={14} /> Gerar Relatório
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
