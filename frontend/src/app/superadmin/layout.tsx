import { notFound } from "next/navigation";
import { Sidebar } from "../../components/Sidebar";
import { Topbar } from "../../components/Topbar";
import { superadminNav } from "../../lib/nav";
import { isPlatformAdmin } from "../../lib/platform-admin";
import { requireSession } from "../../lib/auth-guard";

/**
 * A área de plataforma exige ser admin da PLATAFORMA, não só ter sessão — sem a
 * segunda checagem, qualquer usuário de qualquer imobiliária administraria todos
 * os tenants. As duas moram aqui porque o middleware não decide mais acesso
 * (ver `middleware.ts`).
 *
 * A ordem importa: quem não está logado vai ao login (sessão expirada é o caso
 * comum); quem está logado mas não é da plataforma leva `notFound()` em vez de
 * 403, porque não precisa saber que a área existe.
 */
export default async function SuperadminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireSession();
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
