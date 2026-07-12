import { UserButton } from "@clerk/nextjs";
import { Sidebar } from "../../components/Sidebar";
import { Topbar } from "../../components/Topbar";
import { adminNav, adminFootNav } from "../../lib/nav";
import { fetchCurrentTenant } from "../../lib/api";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const tenant = await fetchCurrentTenant();
  const brandName = tenant?.name ?? "Move AI";
  const initials = brandName.slice(0, 2).toUpperCase();

  return (
    <div className="app-shell">
      <Sidebar
        variant="tenant"
        brandName={brandName}
        brandSub="Imobiliária"
        brandLogo={tenant?.logoUrl ?? null}
        groups={adminNav}
        footItems={adminFootNav}
      />
      <div className="main">
        <Topbar
          contextLabel={brandName}
          contextSub={tenant ? `Plano ${tenant.plan} · Gestor` : "Plano Pro · Gestor"}
          avatar={initials}
          live="IA online"
          accountSlot={<UserButton />}
        />
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
