"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import type { Event } from "../../../lib/api";
import { deleteEventAction } from "./actions";
import { EventFormButton } from "./EventFormButton";

/**
 * Gerenciador de Eventos financeiros (tela "Cadastro de Eventos"): lista os
 * eventos (apenas o nome) e, abaixo, um botão que abre o popup de cadastro —
 * mesmo padrão dos demais cadastros do sistema.
 */
export function EventManager({
  events,
  live,
}: {
  events: Event[];
  live: boolean;
}) {
  const router = useRouter();
  const [, startRemove] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  function handleDelete(id: string) {
    setRemoveError(null);
    setRemovingId(id);
    startRemove(async () => {
      try {
        const res = await deleteEventAction(id);
        if (!res.ok) {
          setRemoveError(res.error ?? "Falha ao remover.");
          return;
        }
        router.refresh();
      } catch (e) {
        setRemoveError(e instanceof Error ? e.message : "Falha ao remover.");
      } finally {
        setRemovingId(null);
      }
    });
  }

  return (
    <div className="card-pad stack" style={{ gap: 12 }}>
      <div className="table-wrap">
        <table className="table">
          <tbody>
            {events.length === 0 && (
              <tr>
                <td className="text-sm subtle">Nenhum evento cadastrado.</td>
                <td />
              </tr>
            )}
            {events.map((ev) => (
              <tr key={ev.id}>
                <td className="strong">{ev.name}</td>
                <td style={{ width: 44, textAlign: "right" }}>
                  <button
                    className="icon-btn"
                    style={{ width: 30, height: 30 }}
                    type="button"
                    onClick={() => handleDelete(ev.id)}
                    disabled={!live || removingId !== null}
                    aria-label={`Remover ${ev.name}`}
                  >
                    <Icon
                      name={removingId === ev.id ? "loader" : "trash"}
                      className={removingId === ev.id ? "spin" : undefined}
                      size={15}
                    />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row">
        <EventFormButton disabled={!live} />
      </div>

      {!live && (
        <span className="text-xs subtle">
          Backend offline — suba <code>npm run dev</code> para gravar.
        </span>
      )}
      {removeError && <span className="badge badge-red">{removeError}</span>}
    </div>
  );
}
