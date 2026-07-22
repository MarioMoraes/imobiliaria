"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../../../components/Icon";
import { deleteExpenseAction } from "./actions";

/** Remoção de despesa com confirmação inline (padrão das tabelas auxiliares). */
export function DeleteExpenseButton({
  condominiumId,
  expenseId,
  label,
}: {
  condominiumId: string;
  expenseId: string;
  label: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    if (!confirm(`Remover a despesa ${label}? Esta ação não pode ser desfeita.`)) return;
    setError(null);
    startTransition(async () => {
      const res = await deleteExpenseAction(condominiumId, expenseId);
      if (!res.ok) {
        setError(res.error ?? "Falha ao remover.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <span title={error ?? undefined}>
      <button
        className="icon-btn"
        style={{ width: 30, height: 30 }}
        type="button"
        onClick={handleDelete}
        disabled={pending}
        aria-label={`Remover despesa ${label}`}
      >
        <Icon name={pending ? "loader" : "trash"} className={pending ? "spin" : undefined} size={15} />
      </button>
    </span>
  );
}
