import { Sidebar } from "../../components/Sidebar";
import { Topbar } from "../../components/Topbar";
import { superadminNav } from "../../lib/nav";

export default function SuperadminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell">
      <Sidebar
        variant="platform"
        brandName="Move AI"
        brandSub="Super Admin"
        groups={superadminNav}
      />
      <div className="main">
        <Topbar
          searchPlaceholder="Buscar tenants, planos, logs…"
          userName="Equipe Move AI"
          userRole="Super Admin"
        />
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
