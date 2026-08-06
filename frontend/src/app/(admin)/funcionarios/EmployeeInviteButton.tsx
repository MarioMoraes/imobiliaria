"use client";

import { useEffect, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { formatCpf, isValidCpf, onlyDigits } from "../../../lib/br-doc";
import { inviteEmployeeAction, type EmployeeRole, type NewEmployeeInput } from "./actions";

const ROLES: { value: EmployeeRole; label: string }[] = [
  { value: "ADMIN", label: "Administrador" },
  { value: "GESTOR", label: "Gestor" },
  { value: "FINANCEIRO", label: "Financeiro" },
  { value: "AUXILIAR", label: "Auxiliar Administrativo" },
];

function makeEmpty(): NewEmployeeInput {
  return { fullName: "", email: "", cpf: "", position: "", roles: [], hiredAt: "" };
}

/**
 * Botão + modal de convite de membro (MOD-FUNC / MOD-AUTH-06). Envia para
 * POST /v1/employees via Server Action: o backend cria o funcionário como
 * "invited" e dispara o convite da organização no Clerk. Espelha o padrão do
 * PersonFormButton (portal + useTransition), porém enxuto — só identidade,
 * cargo e papéis (RBAC).
 */
export function EmployeeInviteButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [form, setForm] = useState<NewEmployeeInput>(makeEmpty);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const set = (patch: Partial<NewEmployeeInput>) => setForm((f) => ({ ...f, ...patch }));

  // Validação inline do CPF — null quando vazio (só valida com algo digitado).
  const cpfError =
    form.cpf.trim() !== "" && !isValidCpf(onlyDigits(form.cpf)) ? "CPF inválido" : null;

  const toggleRole = (r: EmployeeRole) =>
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r],
    }));

  function close() {
    setOpen(false);
    setError(null);
  }

  function submit() {
    setError(null);
    if (cpfError) {
      setError(cpfError);
      return;
    }
    startTransition(async () => {
      const res = await inviteEmployeeAction(form);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível enviar o convite.");
        return;
      }
      setForm(makeEmpty());
      setOpen(false);
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
        style={{ gap: 14, width: 660, maxWidth: "96vw", boxShadow: "0 20px 60px rgba(0,0,0,.30)" }}
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>Convidar Membro</strong>
          <button className="icon-btn" type="button" aria-label="Fechar" onClick={close}>
            <Icon name="x" size={15} />
          </button>
        </div>

        <span className="text-sm subtle">
          O membro recebe um convite por e-mail para acessar o painel com os papéis atribuídos.
        </span>

        <div className="field">
          <label>Nome Completo *</label>
          <input
            className="input"
            value={form.fullName}
            onChange={(e) => set({ fullName: e.target.value })}
            placeholder="Maria Souza"
          />
        </div>

        <div className="grid grid-2" style={{ gap: 12 }}>
          <div className="field">
            <label>E-mail *</label>
            <input
              className="input"
              type="email"
              value={form.email}
              onChange={(e) => set({ email: e.target.value })}
              placeholder="maria@imobiliaria.com"
            />
          </div>
          <div className="field">
            <label>CPF *</label>
            <input
              className="input"
              value={form.cpf}
              onChange={(e) => set({ cpf: formatCpf(e.target.value) })}
              placeholder="000.000.000-00"
              inputMode="numeric"
              aria-invalid={cpfError ? true : undefined}
              style={cpfError ? { borderColor: "var(--danger, #dc2626)" } : undefined}
            />
            {cpfError && (
              <span className="text-xs" style={{ color: "var(--danger, #dc2626)" }}>
                {cpfError}
              </span>
            )}
          </div>
        </div>

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
            {pending ? "Enviando…" : "Enviar Convite"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button className="btn btn-primary btn-sm" type="button" onClick={() => setOpen(true)}>
        <Icon name="plus" /> Convidar Membro
      </button>
      {open && mounted && createPortal(modal, document.body)}
    </>
  );
}
