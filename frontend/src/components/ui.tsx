import type { ReactNode } from "react";
import { Icon } from "./Icon";

/* -------------------------------------------------------------- PageHeader */
export function PageHeader({
  title,
  actions,
}: {
  title: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-header reveal">
      <div>
        <h1 className="page-title">{title}</h1>
      </div>
      {actions && <div className="row gap-8 wrap">{actions}</div>}
    </div>
  );
}

/* ---------------------------------------------------------------- StatCard */
export function StatCard({
  icon,
  label,
  value,
  trend,
  trendDir = "up",
  tone = "blue",
  feature = false,
}: {
  icon: string;
  label: string;
  value: string;
  trend?: string;
  trendDir?: "up" | "down";
  tone?: "blue" | "accent" | "success" | "warning";
  feature?: boolean;
}) {
  return (
    <div className={`stat reveal${feature ? " stat--feature" : ""}`}>
      <div className={`stat-icon ${tone}`}>
        <Icon name={icon} />
      </div>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {trend && (
        <span className={`stat-trend ${trendDir === "up" ? "trend-up" : "trend-down"}`}>
          <Icon name={trendDir === "up" ? "trendingUp" : "trendingDown"} />
          {trend}
        </span>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- Section */
export function Section({
  title,
  action,
  children,
  pad = false,
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  pad?: boolean;
}) {
  return (
    <section className="card reveal">
      {title && (
        <div className="card-head">
          <h2 className="section-title">{title}</h2>
          {action}
        </div>
      )}
      <div className={pad ? "card-pad" : ""}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------- StatusBadge */
const statusMap: Record<string, { cls: string; label: string; dot?: boolean }> = {
  // imóveis
  available: { cls: "badge-green", label: "Disponível", dot: true },
  reserved: { cls: "badge-cyan", label: "Reservado" },
  rented: { cls: "badge-blue", label: "Alugado" },
  sold: { cls: "badge-dark", label: "Vendido" },
  inactive: { cls: "badge-slate", label: "Inativo" },
  // genéricos
  active: { cls: "badge-green", label: "Ativo", dot: true },
  trial: { cls: "badge-cyan", label: "Trial" },
  suspended: { cls: "badge-amber", label: "Suspenso" },
  canceled: { cls: "badge-slate", label: "Cancelado" },
  overdue: { cls: "badge-red", label: "Vencido" },
  paid: { cls: "badge-green", label: "Pago" },
  pending: { cls: "badge-amber", label: "Pendente" },
  vigente: { cls: "badge-green", label: "Vigente", dot: true },
  signing: { cls: "badge-cyan", label: "Em assinatura" },
  draft: { cls: "badge-slate", label: "Rascunho" },
  ok: { cls: "badge-green", label: "Operacional", dot: true },
  degraded: { cls: "badge-amber", label: "Degradado" },
  down: { cls: "badge-red", label: "Fora do ar" },
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const s = statusMap[status] ?? { cls: "badge-slate", label: label ?? status };
  return (
    <span className={`badge ${s.cls}`}>
      {s.dot &&
        (s.cls === "badge-green" ? (
          <span className="pulse-dot" style={{ width: 7, height: 7 }}>
            <span style={{ background: "var(--success)" }} />
            <span style={{ background: "var(--success)", width: 7, height: 7 }} />
          </span>
        ) : (
          <span className="dot" />
        ))}
      {label ?? s.label}
    </span>
  );
}

/* -------------------------------------------------------------- EmptyState */
export function EmptyState({
  icon = "database",
  title,
  hint,
  action,
}: {
  icon?: string;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-mark">
        <Icon name={icon} size={26} />
      </div>
      <div className="section-title" style={{ marginBottom: 4 }}>
        {title}
      </div>
      {hint && <p className="subtle text-sm" style={{ maxWidth: "42ch", margin: "0 auto" }}>{hint}</p>}
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}


/* -------------------------------------------------------------- FieldBlock */
/**
 * Bloco de campos de uma ficha: filete na cor do tópico + ícone em chip +
 * título. `tone` é uma classe `tone-*` de globals.css — quem mapeia assunto →
 * cor é a tela, o bloco só consome `var(--tone)`.
 */
export function FieldBlock({
  tone,
  icon,
  title,
  hint,
  children,
}: {
  tone: string;
  icon: string;
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className={`field-block ${tone}`}>
      <div className="field-block-head">
        <span className="field-block-chip">
          <Icon name={icon} size={15} />
        </span>
        <span className="field-block-title">{title}</span>
        {hint && <span className="field-block-hint">{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ TabBar */
/**
 * Abas de ficha, cada uma com a cor do seu tópico no marcador e no sublinhado.
 */
export function TabBar<T extends string>({
  tabs,
  active,
  onSelect,
}: {
  tabs: { id: T; label: string; tone: string }[];
  active: T;
  onSelect: (id: T) => void;
}) {
  return (
    <div className="tabbar" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          aria-selected={active === t.id}
          className={`tabbar-item ${t.tone}`}
          onClick={() => onSelect(t.id)}
        >
          <span className="tab-bullet" />
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** "Ana Maria Lima" → "AL": primeira e última inicial, para avatares. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0]!;
  const last = parts.length > 1 ? parts[parts.length - 1]![0]! : "";
  return (first + last).toUpperCase();
}
