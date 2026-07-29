"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * Diálogo de confirmação do sistema — substitui o `window.confirm()` nativo.
 *
 * Direção "minimal editorial": sem ícone e sem gradiente, a tipografia faz o
 * trabalho. A cor entra em dose (só o eyebrow e o rótulo da ação de risco),
 * seguindo a mesma regra das `tone-*` do design system.
 *
 * Uso:
 *
 *   const confirm = useConfirm();
 *   const ok = await confirm({ title: 'Remover "Apto 302"?', ... });
 *   if (!ok) return;
 *
 * O diálogo resolve e fecha na hora — quem executa a ação continua sendo o
 * chamador, com o `startTransition`/spinner que ele já tem.
 */
export type ConfirmOptions = {
  /** A pergunta. Curta, sem a consequência. */
  title: string;
  /** A consequência do "sim". */
  message?: ReactNode;
  /** Rótulo do assunto acima do título (ex.: "Exclusão"). */
  eyebrow?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** `danger` (padrão) foca o Cancelar; `brand` foca o Confirmar. */
  tone?: "danger" | "brand";
};

type Pending = { opts: ConfirmOptions; resolve: (ok: boolean) => void };

const ConfirmContext = createContext<((opts: ConfirmOptions) => Promise<boolean>) | null>(null);

/** Duração da animação de saída — mantenha em sincronia com `confirm-fade-out`. */
const EXIT_MS = 160;

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback(
    (opts: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ opts, resolve });
      }),
    [],
  );

  const settle = useCallback((ok: boolean) => {
    setPending((current) => {
      current?.resolve(ok);
      return null;
    });
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {pending && <ConfirmSurface opts={pending.opts} onSettle={settle} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) {
    throw new Error("useConfirm precisa de um <ConfirmProvider> acima na árvore.");
  }
  return ctx;
}

/* ------------------------------------------------------------------ Surface */

function ConfirmSurface({
  opts,
  onSettle,
}: {
  opts: ConfirmOptions;
  onSettle: (ok: boolean) => void;
}) {
  const {
    title,
    message,
    eyebrow = "Confirmação",
    confirmLabel = "Confirmar",
    cancelLabel = "Cancelar",
    tone = "danger",
  } = opts;

  const cardRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Guarda quem tinha o foco (o botão da lixeira, em geral) para devolvê-lo no
  // fim: sem isso o Tab recomeça do topo da página depois de cancelar.
  const openerRef = useRef<Element | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [mounted, setMounted] = useState(false);

  // O portal só existe no cliente; renderizar nada no primeiro passe evita o
  // mismatch de hidratação.
  useEffect(() => setMounted(true), []);

  /** Anima a saída antes de desmontar, para o cartão não sumir de estalo. */
  const close = useCallback(
    (ok: boolean) => {
      setLeaving(true);
      window.setTimeout(() => onSettle(ok), EXIT_MS);
    },
    [onSettle],
  );

  useEffect(() => {
    openerRef.current = document.activeElement;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    // O foco inicial é o Cancelar quando a ação é destrutiva: um Enter
    // distraído não pode apagar nada.
    const initial = tone === "danger" ? cancelRef.current : confirmRef.current;
    initial?.focus();

    return () => {
      document.body.style.overflow = prevOverflow;
      const opener = openerRef.current;
      if (opener instanceof HTMLElement && document.contains(opener)) {
        opener.focus();
      }
    };
  }, [tone]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(false);
        return;
      }
      // Enter NÃO é interceptado de propósito: o `<button>` focado já responde
      // a ele nativamente. Capturar aqui faria o Enter confirmar mesmo com o
      // foco no Cancelar — que é justamente onde ele começa numa exclusão.
      if (e.key !== "Tab") return;
      // Focus trap: só os dois botões participam do ciclo.
      const stops = [cancelRef.current, confirmRef.current].filter(
        (el): el is HTMLButtonElement => el != null,
      );
      if (stops.length === 0) return;
      const first = stops[0]!;
      const last = stops[stops.length - 1]!;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !cardRef.current?.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !cardRef.current?.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    // `capture` para chegar antes dos listeners de Esc dos modais que podem
    // estar abertos atrás (o encerramento de contrato abre daqui de dentro).
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [close]);

  if (!mounted) return null;

  const toneClass = tone === "danger" ? "tone-danger" : "tone-azul";

  return createPortal(
    <div
      className={`confirm-overlay${leaving ? " is-leaving" : ""}`}
      role="presentation"
      onClick={() => close(false)}
    >
      <div
        ref={cardRef}
        className={`confirm-card ${toneClass}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby={message ? "confirm-message" : undefined}
        onClick={(e) => e.stopPropagation()}
      >
        <p className="confirm-eyebrow">{eyebrow}</p>
        <h2 className="confirm-title" id="confirm-title">
          {title}
        </h2>
        {message && (
          <p className="confirm-message" id="confirm-message">
            {message}
          </p>
        )}
        <div className="confirm-rule" />
        {/* Mesmo par dos rodapés de modal do sistema (ghost + primary). */}
        <div className="confirm-actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => close(false)}
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="btn btn-primary btn-sm"
            onClick={() => close(true)}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
