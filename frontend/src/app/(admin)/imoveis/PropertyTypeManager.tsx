"use client";

import { useActionState } from "react";
import { Icon } from "../../../components/Icon";
import type { PropertyType } from "../../../lib/api";
import { createPropertyTypeAction, type TypeFormState } from "./actions";

const initial: TypeFormState = {};

export function PropertyTypeManager({
  types,
  live,
}: {
  types: PropertyType[];
  live: boolean;
}) {
  const [state, action, pending] = useActionState(createPropertyTypeAction, initial);

  return (
    <div className="card-pad stack" style={{ gap: 12 }}>
      <div className="row wrap gap-8">
        {types.length === 0 && <span className="text-sm subtle">Nenhum tipo cadastrado.</span>}
        {types.map((t) => (
          <span key={t.id} className="badge badge-blue">{t.name}</span>
        ))}
      </div>

      <form action={action} className="row gap-8">
        <input className="input" name="name" placeholder="Novo tipo (ex.: Cobertura)" required />
        <button className="btn btn-primary btn-sm" type="submit" disabled={pending || !live}>
          {pending ? <Icon name="loader" className="spin" size={14} /> : <Icon name="plus" size={14} />}
          Adicionar
        </button>
      </form>

      {!live && <span className="text-xs subtle">Backend offline — suba <code>npm run dev</code> para gravar.</span>}
      {state.error && <span className="badge badge-red">{state.error}</span>}
      {state.ok && <span className="badge badge-green"><Icon name="check" size={12} /> Tipo adicionado.</span>}
    </div>
  );
}
