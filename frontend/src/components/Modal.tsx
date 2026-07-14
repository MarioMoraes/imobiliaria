"use client";

import { useEffect, type ReactNode } from "react";
import { Icon } from "./Icon";

/**
 * Modal / popup reutilizável (design system próprio, sem dependência externa).
 * Fecha com Esc, clique no backdrop ou no botão ×; trava o scroll do body
 * enquanto aberto. Renderiza nada quando `open` é false.
 */
export function Modal({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: string;
  children: ReactNode;
}) {
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

  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={onClose}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
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
    </div>
  );
}
