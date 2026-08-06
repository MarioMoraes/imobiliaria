"use client";

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

/**
 * Modal / popup reutilizável (design system próprio, sem dependência externa).
 * Fecha com Esc, clique no backdrop ou no botão ×; trava o scroll do body
 * enquanto aberto. Renderiza nada quando `open` é false.
 *
 * **Sai por portal no `document.body`**, e não onde é declarado: `position:
 * fixed` se ancora no ancestral transformado mais próximo, e a animação
 * `.reveal` (usada em `PageHeader`, `Section` e `StatCard`) termina em
 * `transform: translateY(0)` com `fill-mode: both` — ou seja, um transform que
 * NÃO é `none` fica no elemento para sempre. Um modal declarado dentro dessas
 * caixas centralizava dentro delas, não na tela; nos botões do cabeçalho, que é
 * uma faixa de poucos pixels, o popup nascia praticamente fora de vista.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
  maxWidth,
  centered = false,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: string;
  children: ReactNode;
  /** Largura máxima (px). Sobrepõe o padrão de 640px para modais com tabela larga. */
  maxWidth?: number;
  /**
   * Centraliza na vertical em vez de ancorar no topo (o padrão).
   *
   * Opt-in porque o padrão serve os modais de formulário, que são altos e
   * crescem: ancorados no topo, o título fica sempre na mesma altura e o
   * conteúdo desce. Um popup curto de leitura, ao contrário, parece solto lá em
   * cima. Ver `.modal-overlay.is-centered` no globals.css.
   */
  centered?: boolean;
}) {
  // O portal só existe no cliente: no servidor não há `document`. Renderizar
  // nada na primeira passada mantém o HTML do servidor igual ao da hidratação.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open || !mounted) return null;

  return createPortal(
    <div
      className={`modal-overlay${centered ? " is-centered" : ""}`}
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
        style={maxWidth ? { width: `min(${maxWidth}px, 100%)` } : undefined}
      >
        <div className="modal-head">
          <div className="row gap-8" style={{ minWidth: 0 }}>
            {icon && (
              <span className="modal-icon">
                <Icon name={icon} size={18} />
              </span>
            )}
            <div style={{ minWidth: 0 }}>
              <h2 className="section-title">{title}</h2>
              {subtitle && <p className="subtle text-sm" style={{ margin: 0 }}>{subtitle}</p>}
            </div>
          </div>
          <button
            className="icon-btn"
            style={{ width: 34, height: 34 }}
            type="button"
            onClick={onClose}
            aria-label="Fechar"
          >
            <Icon name="close" size={17} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}
