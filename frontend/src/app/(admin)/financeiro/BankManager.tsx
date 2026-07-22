"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import type { Bank } from "../../../lib/api";
import { formatPrice } from "../../../lib/format";
import { deleteBankAction } from "./actions";
import { BankFormButton } from "./BankFormButton";

/**
 * Gerenciador de Bancos (tela legada "Bancos"): lista as contas bancárias com
 * ações de editar e remover, e um botão para cadastrar uma nova. Mesmo padrão dos
 * demais cadastros do sistema.
 */
export function BankManager({ banks, live }: { banks: Bank[]; live: boolean }) {
  const router = useRouter();
  const [, startRemove] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);

  function handleDelete(id: string) {
    setRemoveError(null);
    setRemovingId(id);
    startRemove(async () => {
      try {
        const res = await deleteBankAction(id);
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
              <th>Cód.</th>
              <th>Nome</th>
              <th>Agência</th>
              <th>Conta</th>
              <th style={{ textAlign: "right" }}>Saldo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {banks.length === 0 && (
              <tr>
                <td colSpan={6} className="text-sm subtle">Nenhum banco cadastrado.</td>
              </tr>
            )}
            {banks.map((b) => (
              <tr key={b.id}>
                <td className="text-sm subtle">{b.code}</td>
                <td className="strong">
                  <span className="row gap-8">
                    {b.favorite && <Icon name="star" size={13} />}
                    {b.name}
                  </span>
                </td>
                <td className="text-sm subtle">{b.agency ?? "—"}</td>
                <td className="text-sm subtle">{b.accountNumber ?? "—"}</td>
                <td className="strong num" style={{ textAlign: "right" }}>{formatPrice(b.balanceCents)}</td>
                <td style={{ width: 80, textAlign: "right" }}>
                  <span className="row gap-8" style={{ justifyContent: "flex-end" }}>
                    <BankFormButton bank={b} disabled={!live} />
                    <button
                      className="icon-btn"
                      style={{ width: 30, height: 30 }}
                      type="button"
                      onClick={() => handleDelete(b.id)}
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
        <BankFormButton disabled={!live} />
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
