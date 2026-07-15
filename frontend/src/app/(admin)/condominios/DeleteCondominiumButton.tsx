"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { deleteCondominiumAction } from "./actions";

/** Botão de remoção com confirmação inline (padrão das tabelas auxiliares). */
export function DeleteCondominiumButton({
  id,
  name,
  disabled,
}: {
  id: string;
  name: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    if (!confirm(`Remover o condomínio "${name}"? Esta ação não pode ser desfeita.`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteCondominiumAction(id);
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
        disabled={disabled || pending}
        aria-label={`Remover ${name}`}
      >
        <Icon name={pending ? "loader" : "trash"} className={pending ? "spin" : undefined} size={15} />
      </button>
    </span>
  );
}
