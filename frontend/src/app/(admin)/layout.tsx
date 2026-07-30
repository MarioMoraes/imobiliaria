import { UserButton } from "@clerk/nextjs";
import { currentUser } from "@clerk/nextjs/server";
import { AppDialogs } from "../../components/AppDialogs";
import { Sidebar } from "../../components/Sidebar";
import { Topbar } from "../../components/Topbar";
import { adminNav, visibleNav } from "../../lib/nav";
import { fetchCurrentTenant, fetchCurrentUser } from "../../lib/api";
import { requireSession } from "../../lib/auth-guard";

/** Rótulos em português dos papéis do sistema (RBAC). */
const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ADMIN: "Administrador",
  GESTOR: "Gestor",
  FINANCEIRO: "Financeiro",
  CORRETOR: "Corretor",
  AUXILIAR: "Auxiliar Administrativo",
  PROPRIETARIO: "Proprietário",
  CLIENTE: "Cliente",
  AI_AGENT: "Agente IA",
};

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Gate do painel inteiro: sem sessão, ninguém passa daqui — e nada é buscado
  // no backend. Antes quem barrava era o middleware; ver `lib/auth-guard.ts`.
  await requireSession();

  const [tenant, clerkUser, me] = await Promise.all([
    fetchCurrentTenant(),
    currentUser().catch(() => null),
    fetchCurrentUser(),
  ]);
  const brandName = tenant?.name ?? "Offices AI";

  const userName =
    clerkUser?.fullName ||
    [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") ||
    clerkUser?.primaryEmailAddress?.emailAddress ||
    "Usuário";
  const primaryRole = me?.roles[0];
  const userRole = primaryRole ? (ROLE_LABELS[primaryRole] ?? primaryRole) : undefined;

  return (
    <AppDialogs>
      <div className="app-shell">
        <Sidebar
          variant="tenant"
          brandName={brandName}
          brandSub="Imobiliária"
          brandLogo={tenant?.logoUrl ?? null}
          groups={visibleNav(adminNav, me?.roles ?? [])}
        />
        <div className="main">
          <Topbar
            brandLogo={tenant?.logoUrl ?? null}
            brandName={brandName}
            userName={userName}
            userRole={userRole}
            settingsHref="/configuracoes"
            accountSlot={<UserButton />}
          />
          <div className="content">{children}</div>
        </div>
      </div>
    </AppDialogs>
  );
}
