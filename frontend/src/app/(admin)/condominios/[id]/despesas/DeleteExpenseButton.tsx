"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../../../components/Icon";
import { useConfirm } from "../../../../../components/ConfirmDialog";
import { useToast } from "../../../../../components/Toast";
import { deleteExpenseAction } from "./actions";

/** Remoção de despesa com confirmação (padrão das tabelas auxiliares). */
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
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  async function handleDelete() {
    const ok = await confirm({
      eyebrow: "Exclusão",
      title: `Remover a despesa ${label}?`,
      message: "Esta ação não pode ser desfeita.",
      confirmLabel: "Remover",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteExpenseAction(condominiumId, expenseId);
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível remover a despesa.");
        return;
      }
      toast.success("Despesa removida.");
      router.refresh();
    });
  }

  return (
    <button
      className="icon-btn"
      style={{ width: 30, height: 30 }}
      type="button"
      onClick={() => void handleDelete()}
      disabled={pending}
      aria-label={`Remover despesa ${label}`}
    >
      <Icon name={pending ? "loader" : "trash"} className={pending ? "spin" : undefined} size={15} />
    </button>
  );
}
