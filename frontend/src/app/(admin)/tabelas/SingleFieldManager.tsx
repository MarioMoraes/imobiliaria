"use client";

import { useActionState, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import type { DeleteResult, LookupFormState } from "./actions";

const initial: LookupFormState = {};

export interface LookupRow {
  id: string;
  label: string;
}

/**
 * Gerenciador genérico de tabela auxiliar de campo único (Tipos de imóvel,
 * Itens de vistoria): lista com remoção + formulário de inclusão.
 */
export function SingleFieldManager({
  rows,
  fieldName,
  placeholder,
  emptyLabel,
  live,
  createAction,
  deleteAction,
}: {
  rows: LookupRow[];
  fieldName: string;
  placeholder: string;
  emptyLabel: string;
  live: boolean;
  createAction: (prev: LookupFormState, formData: FormData) => Promise<LookupFormState>;
  deleteAction: (id: string) => Promise<DeleteResult>;
}) {
  const [state, action, pending] = useActionState(createAction, initial);
  const router = useRouter();
  const [, startRemove] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  function handleDelete(id: string) {
    setRemoveError(null);
    setRemovingId(id);
    startRemove(async () => {
      try {
        const res = await deleteAction(id);
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
            {rows.length === 0 && (
              <tr>
                <td className="text-sm subtle">{emptyLabel}</td>
                <td />
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="strong">{r.label}</td>
                <td style={{ width: 44, textAlign: "right" }}>
                  <button
                    className="icon-btn"
                    style={{ width: 30, height: 30 }}
                    type="button"
                    onClick={() => handleDelete(r.id)}
                    disabled={!live || removingId !== null}
                    aria-label={`Remover ${r.label}`}
                  >
                    <Icon
                      name={removingId === r.id ? "loader" : "trash"}
                      className={removingId === r.id ? "spin" : undefined}
                      size={15}
                    />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form action={action} className="row gap-8">
        <input className="input" name={fieldName} placeholder={placeholder} required />
        <button className="btn btn-primary btn-sm" type="submit" disabled={pending || !live}>
          {pending ? <Icon name="loader" className="spin" size={14} /> : <Icon name="plus" size={14} />}
          Adicionar
        </button>
      </form>

      {!live && (
        <span className="text-xs subtle">
          Backend offline — suba <code>npm run dev</code> para gravar.
        </span>
      )}
      {removeError && <span className="badge badge-red">{removeError}</span>}
      {state.error && <span className="badge badge-red">{state.error}</span>}
      {state.ok && (
        <span className="badge badge-green">
          <Icon name="check" size={12} /> Registro adicionado.
        </span>
      )}
    </div>
  );
}
