"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { deletePersonAction } from "./actions";

/**
 * Remoção de uma pessoa com confirmação inline (mesmo padrão das demais
 * tabelas). No backend é um soft delete: a ficha sai das listas mas continua
 * disponível para o histórico de contratos.
 */
export function DeletePersonButton({
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
    if (!confirm(`Remover "${name}"? A ficha sai das listas (o histórico é preservado).`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deletePersonAction(id);
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
