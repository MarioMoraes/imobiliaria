"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { deleteContractAction } from "./actions";

/** Botão de remoção com confirmação inline (padrão dos demais cadastros). */
export function DeleteContractButton({
  id,
  label,
  disabled,
}: {
  id: string;
  label: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleDelete() {
    if (!confirm(`Remover o contrato ${label}? Esta ação não pode ser desfeita.`)) {
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await deleteContractAction(id);
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
        aria-label={`Remover contrato ${label}`}
      >
        <Icon name={pending ? "loader" : "trash"} className={pending ? "spin" : undefined} size={15} />
      </button>
    </span>
  );
}
