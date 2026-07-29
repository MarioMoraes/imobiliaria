"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { useConfirm } from "../../../components/ConfirmDialog";
import { useToast } from "../../../components/Toast";
import {
  changeAccessAction,
  deleteEmployeeAction,
  updateEmployeeAction,
  type EmployeeAccessStatus,
  type EmployeeRole,
} from "./actions";

const ROLES: { value: EmployeeRole; label: string }[] = [
  { value: "ADMIN", label: "Administrador" },
  { value: "GESTOR", label: "Gestor" },
  { value: "FINANCEIRO", label: "Financeiro" },
  { value: "AUXILIAR", label: "Auxiliar Administrativo" },
];

const ACCESS: { value: EmployeeAccessStatus; label: string }[] = [
  { value: "ATIVO", label: "Ativo" },
  { value: "SUSPENSO", label: "Suspenso" },
  { value: "REVOGADO", label: "Revogado" },
];

export interface EmployeeRowData {
  id: string;
  name: string;
  position: string;
  hiredAt: string;
  roles: EmployeeRole[];
  access: EmployeeAccessStatus;
}

interface EditForm {
  position: string;
  hiredAt: string;
  roles: EmployeeRole[];
  access: EmployeeAccessStatus;
}

function formOf(e: EmployeeRowData): EditForm {
  return { position: e.position, hiredAt: e.hiredAt, roles: e.roles, access: e.access };
}

/**
 * Editar / excluir um funcionário na lista (MOD-FUNC-02 e 04). A identidade
 * (nome, e-mail, CPF) não é editável: ela é a chave do usuário no Clerk e no
 * banco — só cargo, admissão, papéis (RBAC) e o estado de acesso mudam aqui.
 *
 * Acesso vai por um endpoint próprio (`/access`, máquina de estados do MOD-FUNC),
 * então o submit pode disparar duas chamadas; a de acesso só quando muda.
 */
export function EmployeeRowActions({
  employee,
  disabled,
}: {
  employee: EmployeeRowData;
  disabled?: boolean;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [removing, startRemove] = useTransition();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [form, setForm] = useState<EditForm>(() => formOf(employee));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const set = (patch: Partial<EditForm>) => setForm((f) => ({ ...f, ...patch }));

  const toggleRole = (r: EmployeeRole) =>
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r],
    }));

  function openModal() {
    setForm(formOf(employee));
    setError(null);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await updateEmployeeAction(employee.id, {
        position: form.position,
        roles: form.roles,
        hiredAt: form.hiredAt,
      });
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar as alterações.");
        return;
      }
      if (form.access !== employee.access) {
        const acc = await changeAccessAction(employee.id, form.access);
        if (!acc.ok) {
          setError(acc.error ?? "Cargo/papéis salvos, mas o acesso não pôde ser alterado.");
          router.refresh();
          return;
        }
      }
      setOpen(false);
      router.refresh();
    });
  }

  async function handleDelete() {
    const ok = await confirm({
      eyebrow: "Exclusão",
      title: `Excluir "${employee.name}"?`,
      message: "O acesso ao painel é removido imediatamente. Esta ação não pode ser desfeita.",
      confirmLabel: "Excluir",
    });
    if (!ok) return;
    setError(null);
    startRemove(async () => {
      const res = await deleteEmployeeAction(employee.id);
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível excluir o funcionário.");
        return;
      }
      toast.success("Funcionário excluído.");
      router.refresh();
    });
  }

  const modal = (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "6vh 16px",
        overflowY: "auto",
        zIndex: 2000,
      }}
    >
      <div
        className="card card-pad stack"
        onClick={(e) => e.stopPropagation()}
        style={{ gap: 14, width: 620, maxWidth: "96vw", boxShadow: "0 20px 60px rgba(0,0,0,.30)" }}
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Editar Membro</strong>
          <button className="icon-btn" type="button" aria-label="Fechar" onClick={close}>
            <Icon name="x" size={15} />
          </button>
        </div>

        <span className="text-sm subtle">
          {employee.name} — nome, e-mail e CPF não mudam por aqui.
        </span>

        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label>Cargo *</label>
            <input
              className="input"
              value={form.position}
              onChange={(e) => set({ position: e.target.value })}
              placeholder="Analista de locação"
            />
          </div>
          <div className="field">
            <label>Admissão</label>
            <input
              className="input"
              type="date"
              value={form.hiredAt}
              onChange={(e) => set({ hiredAt: e.target.value })}
            />
          </div>
        </div>

        <div className="field">
          <label>Papéis (RBAC) *</label>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {ROLES.map((r) => {
              const active = form.roles.includes(r.value);
              return (
                <button
                  key={r.value}
                  type="button"
                  className={`badge ${active ? "badge-blue" : "badge-slate"}`}
                  style={{ cursor: "pointer", padding: "6px 12px" }}
                  onClick={() => toggleRole(r.value)}
                >
                  {active ? <Icon name="check" size={13} /> : <Icon name="plus" size={13} />} {r.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="field">
          <label>Acesso</label>
          <select
            className="input"
            value={form.access}
            onChange={(e) => set({ access: e.target.value as EmployeeAccessStatus })}
          >
            {ACCESS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>

        {error && (
          <span className="text-sm" style={{ color: "var(--danger, #dc2626)" }}>
            {error}
          </span>
        )}

        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" type="button" onClick={close} disabled={pending}>
            Cancelar
          </button>
          <button className="btn btn-primary btn-sm" type="button" onClick={submit} disabled={pending}>
            {pending ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        className="icon-btn"
        style={{ width: 30, height: 30 }}
        type="button"
        onClick={openModal}
        disabled={disabled}
        aria-label={`Editar ${employee.name}`}
        title="Editar"
      >
        <Icon name="edit" size={15} />
      </button>
      <button
        className="icon-btn"
        style={{ width: 30, height: 30 }}
        type="button"
        onClick={() => void handleDelete()}
        disabled={disabled || removing}
        aria-label={`Excluir ${employee.name}`}
        title="Excluir"
      >
        <Icon name={removing ? "loader" : "trash"} className={removing ? "spin" : undefined} size={15} />
      </button>
      {open && mounted && createPortal(modal, document.body)}
    </>
  );
}
