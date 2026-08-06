"use client";

import { useRef, useState, useTransition, type ChangeEvent } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { StatusBadge } from "../../../components/ui";
// De lib/format (não de lib/api): este é um Client Component, e api.ts importa
// o Clerk server (`server-only`).
import { formatDate, tenantSubdomain } from "../../../lib/format";
import { useConfirm } from "../../../components/ConfirmDialog";
import { useToast } from "../../../components/Toast";
import { grantCreditsAction, saveTenantAction, type TenantInput } from "./actions";

export interface TenantRow {
  id: string;
  name: string;
  slug: string;
  plan: string;
  status: string;
  createdAt?: string;
  logoUrl?: string | null;
  domain?: string | null;
  props?: number;
  /** Créditos de IA do tenant. `null` quando a consulta falhou. */
  credits?: { balance: number; reserved: number; used: number; available: number } | null;
}

/** Pacotes de recarga oferecidos — o campo aceita qualquer valor. */
const PACKAGES = [10_000, 50_000, 100_000, 250_000];

/** Limite do arquivo de logo — evita data URLs enormes na coluna logo_url. */
const MAX_LOGO_BYTES = 512 * 1024;

const emptyForm = { name: "", slug: "", domain: "", plan: "free", logoUrl: "" as string };

export function TenantsManager({ tenants }: { tenants: TenantRow[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /** Tenant com o popup de recarga aberto. */
  const [recharging, setRecharging] = useState<TenantRow | null>(null);
  const [amount, setAmount] = useState<string>(String(PACKAGES[0]));

  async function recarregar() {
    if (!recharging) return;
    const value = Number(amount.replace(/\D/g, ""));
    if (!Number.isInteger(value) || value <= 0) {
      toast.error("Informe uma quantidade de créditos maior que zero.");
      return;
    }

    const ok = await confirm({
      title: `Recarregar ${value.toLocaleString("pt-BR")} créditos?`,
      message:
        `Os créditos entram no pacote de ${recharging.name} e passam a valer na hora. ` +
        `A recarga soma ao saldo atual e fica registrada na trilha de auditoria.`,
      confirmLabel: "Recarregar",
      tone: "brand",
    });
    if (!ok) return;

    const alvo = recharging;
    startTransition(async () => {
      const res = await grantCreditsAction(alvo.id, value);
      if (!res.ok) {
        toast.error(res.error ?? "Não foi possível recarregar.");
        return;
      }
      setRecharging(null);
      toast.success(`${value.toLocaleString("pt-BR")} créditos adicionados a ${alvo.name}.`);
      router.refresh();
    });
  }

  const set = (patch: Partial<typeof emptyForm>) => setForm((f) => ({ ...f, ...patch }));

  function openCreate() {
    setEditingId(null);
    setForm(emptyForm);
    setError(null);
    setOpen(true);
  }

  function openEdit(t: TenantRow) {
    setEditingId(t.id);
    setForm({
      name: t.name,
      slug: t.slug,
      domain: t.domain ?? "",
      plan: t.plan,
      logoUrl: t.logoUrl ?? "",
    });
    setError(null);
    setOpen(true);
  }

  function onPickLogo(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Selecione um arquivo de imagem (PNG, JPG, SVG…).");
      return;
    }
    if (file.size > MAX_LOGO_BYTES) {
      setError("Imagem muito grande. Use um ícone de até 512 KB.");
      return;
    }
    setError(null);
    const reader = new FileReader();
    reader.onload = () => set({ logoUrl: reader.result as string });
    reader.readAsDataURL(file);
  }

  function submit() {
    setError(null);
    const input: TenantInput = {
      id: editingId ?? undefined,
      name: form.name,
      slug: form.slug,
      domain: form.domain || undefined,
      plan: form.plan,
      logoUrl: form.logoUrl || null,
    };
    startTransition(async () => {
      const res = await saveTenantAction(input);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const initials = (form.name || "?").slice(0, 2).toUpperCase();

  return (
    <>
      <div className="row" style={{ justifyContent: "flex-end", marginBottom: 14 }}>
        <button className="btn btn-primary btn-sm" onClick={openCreate} type="button">
          <Icon name="plus" /> Novo Tenant
        </button>
      </div>

      {/* Recarga de créditos — cartão embutido, como o formulário de tenant. */}
      {recharging && (
        <div className="card card-pad mb-4 stack" style={{ gap: 14 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>Recarregar créditos · {recharging.name}</strong>
            <button
              className="icon-btn"
              type="button"
              aria-label="Fechar"
              onClick={() => setRecharging(null)}
            >
              <Icon name="x" size={15} />
            </button>
          </div>

          {recharging.credits && (
            <div className="row gap-8 text-sm subtle" style={{ flexWrap: "wrap" }}>
              <span>
                Disponível hoje:{" "}
                <strong>{recharging.credits.available.toLocaleString("pt-BR")}</strong>
              </span>
              <span>·</span>
              <span>Consumido: {recharging.credits.used.toLocaleString("pt-BR")}</span>
            </div>
          )}

          <div className="row gap-8" style={{ flexWrap: "wrap" }}>
            {PACKAGES.map((p) => (
              <button
                key={p}
                type="button"
                className={`btn btn-sm ${Number(amount) === p ? "btn-primary" : "btn-outline"}`}
                onClick={() => setAmount(String(p))}
              >
                {p.toLocaleString("pt-BR")}
              </button>
            ))}
          </div>

          <div className="field" style={{ maxWidth: 260 }}>
            <label>Créditos a Adicionar</label>
            <input
              className="input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              inputMode="numeric"
            />
          </div>

          <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
            <button
              className="btn btn-ghost btn-sm"
              type="button"
              onClick={() => setRecharging(null)}
              disabled={pending}
            >
              Cancelar
            </button>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={() => void recarregar()}
              disabled={pending}
            >
              {pending ? "Recarregando…" : "Recarregar"}
            </button>
          </div>
        </div>
      )}

      {open && (
        <div className="card card-pad mb-4 stack" style={{ gap: 16 }}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <strong>{editingId ? "Editar Tenant" : "Novo Tenant"}</strong>
            <button className="icon-btn" type="button" aria-label="Fechar" onClick={() => setOpen(false)}>
              <Icon name="x" size={15} />
            </button>
          </div>

          <div className="row" style={{ gap: 16, alignItems: "center" }}>
            <span
              className="avatar"
              style={{
                width: 56,
                height: 56,
                borderRadius: 14,
                overflow: "hidden",
                fontSize: "1rem",
                background: form.logoUrl ? "#fff" : undefined,
              }}
            >
              {form.logoUrl ? (
                <img
                  src={form.logoUrl}
                  alt="Logo"
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                initials
              )}
            </span>
            <div className="stack" style={{ gap: 6 }}>
              <div className="row" style={{ gap: 8 }}>
                <button className="btn btn-ghost btn-sm" type="button" onClick={() => fileRef.current?.click()}>
                  <Icon name="upload" /> {form.logoUrl ? "Trocar Logo" : "Enviar Logo"}
                </button>
                {form.logoUrl && (
                  <button className="btn btn-ghost btn-sm" type="button" onClick={() => set({ logoUrl: "" })}>
                    <Icon name="trash" /> Remover
                  </button>
                )}
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={onPickLogo}
                style={{ display: "none" }}
              />
            </div>
          </div>

          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="field">
              <label>Nome da Imobiliária *</label>
              <input
                className="input"
                value={form.name}
                onChange={(e) => set({ name: e.target.value })}
                placeholder="Vera Cruz Imóveis"
              />
            </div>
            <div className="field">
              <label>Slug (Subdomínio) *</label>
              <input
                className="input"
                value={form.slug}
                onChange={(e) => set({ slug: e.target.value })}
                placeholder="veracruz"
                disabled={editingId !== null}
              />
            </div>
          </div>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="field">
              <label>Plano</label>
              <select className="input" value={form.plan} onChange={(e) => set({ plan: e.target.value })}>
                <option value="free">Free</option>
                <option value="starter">Starter</option>
                <option value="pro">Pro</option>
                <option value="enterprise">Enterprise</option>
              </select>
            </div>
            <div className="field">
              <label>Domínio Próprio (Opcional)</label>
              <input
                className="input"
                value={form.domain}
                onChange={(e) => set({ domain: e.target.value })}
                placeholder="app.veracruz.com.br"
              />
            </div>
          </div>

          {error && (
            <div className="badge badge-red" style={{ padding: "8px 12px" }}>
              <Icon name="x" size={14} /> {error}
            </div>
          )}

          <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
            <button className="btn btn-ghost" type="button" onClick={() => setOpen(false)} disabled={pending}>
              Cancelar
            </button>
            <button className="btn btn-primary" type="button" onClick={submit} disabled={pending}>
              {pending ? <Icon name="loader" className="spin" /> : <Icon name="check" />}
              {pending ? "Salvando…" : "Salvar Tenant"}
            </button>
          </div>
        </div>
      )}

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Imobiliária</th>
              <th>Plano</th>
              <th>Imóveis</th>
              <th>Créditos de IA</th>
              <th>Criado em</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => (
              <tr key={t.id}>
                <td>
                  <div className="cell-main">
                    <span
                      className="avatar"
                      style={{
                        width: 34,
                        height: 34,
                        fontSize: "0.72rem",
                        overflow: "hidden",
                        background: t.logoUrl ? "#fff" : undefined,
                      }}
                    >
                      {t.logoUrl ? (
                        <img
                          src={t.logoUrl}
                          alt={t.name}
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                      ) : (
                        t.name.slice(0, 2).toUpperCase()
                      )}
                    </span>
                    <span>
                      <span className="strong" style={{ display: "block" }}>{t.name}</span>
                      <span className="text-xs subtle">{tenantSubdomain(t.slug)}</span>
                    </span>
                  </div>
                </td>
                <td><span className="badge badge-blue">{t.plan}</span></td>
                <td className="strong">{t.props || "—"}</td>
                {/* Saldo com zero em destaque: é exatamente o estado em que o
                    assistente responde "créditos insuficientes", e era o que
                    não aparecia em lugar nenhum da plataforma. */}
                <td>
                  {t.credits === null || t.credits === undefined ? (
                    <span className="subtle">—</span>
                  ) : (
                    <div className="stack" style={{ gap: 2 }}>
                      <span
                        className="strong"
                        style={
                          t.credits.available === 0
                            ? { color: "var(--danger, #dc2626)" }
                            : undefined
                        }
                      >
                        {t.credits.available.toLocaleString("pt-BR")}
                      </span>
                      <span className="text-xs subtle">
                        {t.credits.used.toLocaleString("pt-BR")} consumidos
                      </span>
                    </div>
                  )}
                </td>
                <td className="text-sm subtle">{t.createdAt ? formatDate(t.createdAt) : "—"}</td>
                <td><StatusBadge status={t.status} /></td>
                <td>
                  <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
                    <button
                      className="icon-btn"
                      style={{ width: 30, height: 30 }}
                      type="button"
                      aria-label={`Recarregar créditos de IA de ${t.name}`}
                      title="Recarregar créditos de IA"
                      onClick={() => {
                        setRecharging(t);
                        setAmount(String(PACKAGES[0]));
                      }}
                    >
                      <Icon name="wallet" size={15} />
                    </button>
                    <button
                      className="icon-btn"
                      style={{ width: 30, height: 30 }}
                      type="button"
                      aria-label="Editar Tenant"
                      onClick={() => openEdit(t)}
                    >
                      <Icon name="edit" size={15} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
