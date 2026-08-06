"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "./Icon";
import type { SearchHit, SearchResults } from "../lib/api";
import { globalSearchAction } from "../app/(admin)/search-action";

/** Cor e ícone por tipo — o mesmo tom que o domínio tem na barra lateral. */
const KIND: Record<SearchHit["kind"], { icon: string; tone: string; label: string }> = {
  imovel: { icon: "building", tone: "tone-ciano", label: "Imóveis" },
  pessoa: { icon: "users", tone: "tone-indigo", label: "Pessoas" },
  contrato: { icon: "contract", tone: "tone-esmeralda", label: "Contratos" },
};

/** Achata os grupos na ordem de exibição — é sobre esta lista que as setas andam. */
function flatten(r: SearchResults | null): SearchHit[] {
  return r ? [...r.imoveis, ...r.pessoas, ...r.contratos] : [];
}

/**
 * Busca global do topo: imóveis, pessoas e contratos.
 *
 * Cada resultado leva à lista do seu módulo já com `?q=`, porque o sistema não
 * tem página de detalhe — a lista filtrada é o lugar onde a ficha se abre.
 */
export function GlobalSearch({ placeholder }: { placeholder?: string }) {
  const router = useRouter();
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResults | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);

  const hits = flatten(results);

  // Debounce: 250ms sem digitar antes de consultar. `cancelled` evita que uma
  // resposta antiga sobrescreva a do termo mais recente.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setResults(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      const res = await globalSearchAction(term);
      if (cancelled) return;
      setLoading(false);
      setCursor(0);
      if (!res.ok) {
        setError(res.error ?? "Busca indisponível.");
        setResults(null);
        return;
      }
      setError(null);
      setResults(res.results ?? null);
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q]);

  // Fecha ao clicar fora.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  // Atalho "/" para focar a busca, como em ferramentas de dev — sem roubar a
  // tecla de quem está digitando num campo.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
      if (e.key === "/" && !typing) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function go(hit: SearchHit) {
    setOpen(false);
    setQ("");
    router.push(hit.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => Math.min(c + 1, Math.max(hits.length - 1, 0)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[cursor];
      if (hit) go(hit);
    }
  }

  const groups: [SearchHit["kind"], SearchHit[]][] = results
    ? [
        ["imovel", results.imoveis],
        ["pessoa", results.pessoas],
        ["contrato", results.contratos],
      ]
    : [];

  // Índice absoluto de cada item dentro da lista achatada (para o destaque).
  let running = -1;

  return (
    <div className="search-box" ref={boxRef}>
      <div className="search">
        <Icon name={loading ? "loader" : "search"} className={loading ? "spin" : undefined} />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? "Buscar imóveis, clientes, contratos…"}
          aria-label="Buscar no Sistema"
          autoComplete="off"
        />
        {q && (
          <button className="search-clear" type="button" onClick={() => setQ("")} aria-label="Limpar Busca">
            <Icon name="close" size={13} />
          </button>
        )}
      </div>

      {open && q.trim().length >= 2 && (
        <div className="search-results" role="listbox">
          {error && <div className="search-empty">{error}</div>}

          {!error && !loading && hits.length === 0 && (
            <div className="search-empty">Nada encontrado para “{q.trim()}”.</div>
          )}

          {groups.map(([kind, items]) =>
            items.length === 0 ? null : (
              <div key={kind} className="search-group">
                <div className="search-group-label">{KIND[kind].label}</div>
                {items.map((hit) => {
                  running += 1;
                  const index = running;
                  return (
                    <button
                      key={`${hit.kind}-${hit.id}`}
                      type="button"
                      role="option"
                      aria-selected={index === cursor}
                      className={`search-hit ${KIND[hit.kind].tone}${index === cursor ? " is-active" : ""}`}
                      onMouseEnter={() => setCursor(index)}
                      onClick={() => go(hit)}
                    >
                      <Icon name={KIND[hit.kind].icon} size={15} />
                      <span className="search-hit-text">
                        <span className="search-hit-label">{hit.label}</span>
                        {hit.sub && <span className="search-hit-sub">{hit.sub}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            ),
          )}

          {hits.length > 0 && (
            <div className="search-foot">↑↓ para navegar · Enter para abrir · Esc para fechar</div>
          )}
        </div>
      )}
    </div>
  );
}

export default GlobalSearch;
