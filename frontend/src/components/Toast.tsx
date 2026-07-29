"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Icon } from "./Icon";

/**
 * Avisos efêmeros no canto inferior direito.
 *
 * Existem porque o retorno das ações era invisível: sucesso não dizia nada e
 * erro virava só o `title` de um `<span>` (tooltip que exige parar o mouse em
 * cima). Aqui o filete de 3px na cor do assunto é a única dose de cor, e o fio
 * do rodapé drena junto com a vida do aviso.
 *
 *   const toast = useToast();
 *   toast.success("Imóvel removido.");
 */
type ToastKind = "success" | "error" | "info";

type ToastItem = {
  id: number;
  kind: ToastKind;
  message: string;
  /** Vida em ms — vira a duração da animação do fio. */
  duration: number;
};

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

/** Erro fica mais tempo: quem errou precisa ler a mensagem inteira. */
const DURATION: Record<ToastKind, number> = { success: 4000, error: 6000, info: 4000 };

const TONE: Record<ToastKind, string> = {
  success: "tone-esmeralda",
  error: "tone-danger",
  info: "tone-azul",
};

const ICON: Record<ToastKind, string> = { success: "check", error: "x", info: "bell" };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId.current++;
    setItems((list) => [...list, { id, kind, message, duration: DURATION[kind] }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push("success", m),
      error: (m) => push("error", m),
      info: (m) => push("info", m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastRegion items={items} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error("useToast precisa de um <ToastProvider> acima na árvore.");
  }
  return ctx;
}

/* ------------------------------------------------------------------- Região */

function ToastRegion({
  items,
  onDismiss,
}: {
  items: ToastItem[];
  onDismiss: (id: number) => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || items.length === 0) return null;

  return createPortal(
    <div className="toast-region">
      {items.map((item) => (
        <ToastCard key={item.id} item={item} onDismiss={onDismiss} />
      ))}
    </div>,
    document.body,
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  // Sair da pausa reinicia a contagem. O `run` entra como `key` do fio para que
  // a animação recomece junto — pausar o CSS e reiniciar o timer de JS deixaria
  // os dois fora de sincronia, e o fio zeraria antes do aviso sumir.
  const [run, setRun] = useState(0);

  useEffect(() => {
    if (paused) return;
    const timer = window.setTimeout(() => onDismiss(item.id), item.duration);
    return () => window.clearTimeout(timer);
  }, [item.id, item.duration, onDismiss, paused, run]);

  const pause = () => setPaused(true);
  const resume = () => {
    setPaused(false);
    setRun((n) => n + 1);
  };

  return (
    <div
      className={`toast ${TONE[item.kind]}`}
      role={item.kind === "error" ? "alert" : "status"}
      aria-live={item.kind === "error" ? "assertive" : "polite"}
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
    >
      <Icon name={ICON[item.kind]} size={16} className="toast-icon" />
      <span className="toast-text">{item.message}</span>
      <button
        type="button"
        className="toast-close"
        onClick={() => onDismiss(item.id)}
        aria-label="Dispensar aviso"
      >
        <Icon name="close" size={14} />
      </button>
      <span
        key={run}
        className="toast-bar"
        style={{
          animationDuration: `${item.duration}ms`,
          animationPlayState: paused ? "paused" : "running",
        }}
      />
    </div>
  );
}
