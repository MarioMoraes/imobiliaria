"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { useConfirm } from "../../../components/ConfirmDialog";
import { useToast } from "../../../components/Toast";
import { deleteCondominiumAction } from "./actions";

/** Botão de remoção com confirmação (padrão das tabelas auxiliares). */
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
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  async function handleDelete() {
    const ok = await confirm({
      eyebrow: "Exclusão",
      title: `Remover o condomínio "${name}"?`,
      message: "Esta ação não pode ser desfeita.",
      confirmLabel: "Remover",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteCondominiumAction(id);
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível remover o condomínio.");
        return;
      }
      toast.success("Condomínio removido.");
      router.refresh();
    });
  }

  return (
    <button
      className="icon-btn"
      style={{ width: 30, height: 30 }}
      type="button"
      onClick={() => void handleDelete()}
      disabled={disabled || pending}
      aria-label={`Remover ${name}`}
    >
      <Icon name={pending ? "loader" : "trash"} className={pending ? "spin" : undefined} size={15} />
    </button>
  );
}
