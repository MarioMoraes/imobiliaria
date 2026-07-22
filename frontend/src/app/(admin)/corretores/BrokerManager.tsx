"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import type { Broker } from "../../../lib/api";
import { formatPhone } from "../../../lib/br-doc";
import { deleteBrokerAction } from "./actions";
import { BrokerFormButton } from "./BrokerFormButton";

/** Percentual pt-BR: 10 → "10,00%". */
function pct(n: number): string {
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

/**
 * Gerenciador de Corretores (tela legada "Cadastro de Corretores"): lista os
 * corretores com ações de editar e remover, e um botão para cadastrar um novo.
 * Mesmo padrão do BankManager.
 */
export function BrokerManager({ brokers, live }: { brokers: Broker[]; live: boolean }) {
  const router = useRouter();
  const [, startRemove] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  function handleDelete(id: string, name: string) {
    if (!confirm(`Remover o corretor "${name}"? Esta ação não pode ser desfeita.`)) return;
    setRemoveError(null);
    setRemovingId(id);
    startRemove(async () => {
      try {
        const res = await deleteBrokerAction(id);
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
              <th>Nome</th>
              <th>Celular</th>
              <th>Cidade</th>
              <th style={{ textAlign: "right" }}>Comissão</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {brokers.length === 0 && (
              <tr>
                <td colSpan={5} className="text-sm subtle">Nenhum corretor cadastrado.</td>
              </tr>
            )}
            {brokers.map((b) => (
              <tr key={b.id}>
                <td className="strong">{b.name}</td>
                <td className="text-sm tabular">{b.mobile ? formatPhone(b.mobile) : "—"}</td>
                <td className="text-sm subtle">
                  {b.city ?? "—"}{b.state ? ` · ${b.state}` : ""}
                </td>
                <td className="strong num" style={{ textAlign: "right" }}>{pct(b.commissionPercent)}</td>
                <td style={{ width: 80, textAlign: "right" }}>
                  <span className="row gap-8" style={{ justifyContent: "flex-end" }}>
                    <BrokerFormButton broker={b} disabled={!live} />
                    <button
                      className="icon-btn"
                      style={{ width: 30, height: 30 }}
                      type="button"
                      onClick={() => handleDelete(b.id, b.name)}
                      disabled={!live || removingId !== null}
                      aria-label={`Remover ${b.name}`}
                    >
                      <Icon
                        name={removingId === b.id ? "loader" : "trash"}
                        className={removingId === b.id ? "spin" : undefined}
                        size={15}
                      />
                    </button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="row">
        <BrokerFormButton disabled={!live} />
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
