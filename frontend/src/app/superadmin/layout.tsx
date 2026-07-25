import { notFound } from "next/navigation";
import { Sidebar } from "../../components/Sidebar";
import { Topbar } from "../../components/Topbar";
import { superadminNav } from "../../lib/nav";
import { isPlatformAdmin } from "../../lib/platform-admin";

/**
 * A área de plataforma exige ser admin da PLATAFORMA, não só ter sessão. O
 * `middleware.ts` garante apenas que existe um usuário logado — sem esta
 * checagem, qualquer usuário de qualquer imobiliária administraria todos os
 * tenants. `notFound()` em vez de 403: quem não é admin da plataforma não
 * precisa saber que a área existe.
 */
export default async function SuperadminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!(await isPlatformAdmin())) notFound();

  return (
    <div className="app-shell">
      <Sidebar
        variant="platform"
        brandName="Offices AI"
        brandSub="Super Admin"
        groups={superadminNav}
      />
      <div className="main">
        <Topbar
          searchPlaceholder="Buscar tenants, planos, logs…"
          userName="Equipe Offices AI"
          userRole="Super Admin"
        />
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
