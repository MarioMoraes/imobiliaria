"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { BackendNotice, GENERIC_BACKEND_NOTICE } from "../../../components/BackendNotice";
import type { Clause } from "../../../lib/api";
import {
  createClauseAction,
  deleteClauseAction,
  type LookupFormState,
} from "./actions";

const initial: LookupFormState = {};

/** Gerenciador de Cláusulas contratuais: Nome + Descrição (texto longo). */
export function ClauseManager({
  clauses,
  live,
  notice,
}: {
  clauses: Clause[];
  live: boolean;
  /** Por que não está disponível — vem do `backendNotice()` de quem renderiza. */
  notice?: string | null;
}) {
  const [state, action, pending] = useActionState(createClauseAction, initial);
  const router = useRouter();
  const [, startRemove] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  function handleDelete(id: string) {
    setRemoveError(null);
    setRemovingId(id);
    startRemove(async () => {
      try {
        const res = await deleteClauseAction(id);
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
          <thead>
            <tr>
              <th style={{ width: "28%" }}>Nome</th>
              <th>Descrição</th>
              <th style={{ width: 44 }} />
            </tr>
          </thead>
          <tbody>
            {clauses.length === 0 && (
              <tr>
                <td className="text-sm subtle" colSpan={3}>
                  Nenhuma cláusula cadastrada.
                </td>
              </tr>
            )}
            {clauses.map((c) => (
              <tr key={c.id}>
                <td className="strong">{c.name}</td>
                <td className="text-sm">{c.description}</td>
                <td style={{ textAlign: "right" }}>
                  <button
                    className="icon-btn"
                    style={{ width: 30, height: 30 }}
                    type="button"
                    onClick={() => handleDelete(c.id)}
                    disabled={!live || removingId !== null}
                    aria-label={`Remover ${c.name}`}
                  >
                    <Icon
                      name={removingId === c.id ? "loader" : "trash"}
                      className={removingId === c.id ? "spin" : undefined}
                      size={15}
                    />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={action} className="stack" style={{ gap: 8 }}>
        <input className="input" name="name" placeholder="Nome (ex.: Cláusula de 1 ano)" required />
        <textarea
          className="input"
          name="description"
          rows={4}
          placeholder="Descrição da cláusula…"
          style={{ resize: "vertical" }}
          required
        />
        <div className="row">
          <button className="btn btn-primary btn-sm" type="submit" disabled={pending || !live}>
            {pending ? <Icon name="loader" className="spin" size={14} /> : <Icon name="plus" size={14} />}
            Adicionar Cláusula
          </button>
        </div>
      </form>

      {!live && <BackendNotice message={notice ?? GENERIC_BACKEND_NOTICE} />}
      {removeError && <span className="badge badge-red">{removeError}</span>}
      {state.error && <span className="badge badge-red">{state.error}</span>}
      {state.ok && (
        <span className="badge badge-green">
          <Icon name="check" size={12} /> Cláusula adicionada.
        </span>
      )}
    </div>
  );
}
