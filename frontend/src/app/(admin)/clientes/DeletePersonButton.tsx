"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { useConfirm } from "../../../components/ConfirmDialog";
import { useToast } from "../../../components/Toast";
import { deletePersonAction } from "./actions";

/**
 * Remoção de uma pessoa com confirmação (mesmo padrão das demais tabelas). No
 * backend é um soft delete: a ficha sai das listas mas continua disponível para
 * o histórico de contratos.
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
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, startTransition] = useTransition();

  async function handleDelete() {
    const ok = await confirm({
      eyebrow: "Exclusão",
      title: `Remover "${name}"?`,
      message: "O histórico de contratos e pagamentos é preservado.",
      confirmLabel: "Remover",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deletePersonAction(id);
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível remover a ficha.");
        return;
      }
      toast.success("Ficha removida.");
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
