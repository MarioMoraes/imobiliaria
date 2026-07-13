"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { addOwnerAction, removeOwnerAction } from "./actions";
import type { PropertyOwner } from "../../../lib/api";

interface Candidate {
  id: string;
  fullName: string;
}

/**
 * Célula de "Donos" de um imóvel: lista os proprietários vinculados (com % de
 * participação) e permite adicionar/remover. Os candidatos são pessoas com papel
 * LOCADOR (carregadas no server component da página). Só habilitado com backend
 * ao vivo (precisa de ids reais).
 */
export function PropertyOwnersCell({
  propertyId,
  owners,
  candidates,
  live,
}: {
  propertyId: string;
  owners: PropertyOwner[];
  candidates: Candidate[];
  live: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [personId, setPersonId] = useState("");
  const [share, setShare] = useState("100");
  const [error, setError] = useState<string | null>(null);

  // Candidatos que ainda não são donos deste imóvel.
  const available = candidates.filter((c) => !owners.some((o) => o.personId === c.id));

  function add() {
    setError(null);
    startTransition(async () => {
      const res = await addOwnerAction(propertyId, personId, Number(share) || 100);
      if (!res.ok) {
        setError(res.error ?? "Falha ao vincular.");
        return;
      }
      setAdding(false);
      setPersonId("");
      setShare("100");
      router.refresh();
    });
  }

  function remove(pid: string) {
    startTransition(async () => {
      await removeOwnerAction(propertyId, pid);
      router.refresh();
    });
  }

  return (
    <div className="stack" style={{ gap: 6, minWidth: 180 }}>
      <div className="row" style={{ flexWrap: "wrap", gap: 4 }}>
        {owners.length === 0 ? (
          <span className="text-sm subtle">Sem dono</span>
        ) : (
          owners.map((o) => (
            <span key={o.id} className="badge badge-slate" style={{ gap: 6 }}>
              {o.personName}
              {o.sharePercent !== 100 ? ` · ${o.sharePercent}%` : ""}
              {live && (
                <button
                  type="button"
                  className="icon-btn"
                  aria-label={`Remover ${o.personName}`}
                  style={{ width: 16, height: 16 }}
                  disabled={pending}
                  onClick={() => remove(o.personId)}
                >
                  <Icon name="x" size={11} />
                </button>
              )}
            </span>
          ))
        )}
      </div>

      {live && !adding && available.length > 0 && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          style={{ alignSelf: "flex-start", padding: "2px 8px" }}
          onClick={() => setAdding(true)}
        >
          <Icon name="plus" size={13} /> dono
        </button>
      )}

      {live && adding && (
        <div className="stack" style={{ gap: 4 }}>
          <div className="row" style={{ gap: 4 }}>
            <select
              className="input"
              style={{ padding: "4px 8px", fontSize: "0.8rem" }}
              value={personId}
              onChange={(e) => setPersonId(e.target.value)}
            >
              <option value="">Selecione…</option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>{c.fullName}</option>
              ))}
            </select>
            <input
              className="input"
              style={{ width: 56, padding: "4px 6px", fontSize: "0.8rem" }}
              value={share}
              inputMode="numeric"
              aria-label="Participação (%)"
              onChange={(e) => setShare(e.target.value)}
            />
          </div>
          <div className="row" style={{ gap: 4 }}>
            <button className="btn btn-primary btn-sm" style={{ padding: "2px 8px" }} type="button" disabled={pending || !personId} onClick={add}>
              {pending ? "…" : "Vincular"}
            </button>
            <button className="btn btn-ghost btn-sm" style={{ padding: "2px 8px" }} type="button" disabled={pending} onClick={() => { setAdding(false); setError(null); }}>
              Cancelar
            </button>
          </div>
          {error && <span className="text-xs" style={{ color: "var(--danger, #dc2626)" }}>{error}</span>}
        </div>
      )}
    </div>
  );
}
