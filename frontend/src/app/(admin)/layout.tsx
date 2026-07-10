import { Sidebar } from "../../components/Sidebar";
import { Topbar } from "../../components/Topbar";
import { adminNav, adminFootNav } from "../../lib/nav";

export default function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="app-shell">
      <Sidebar
        variant="tenant"
        brandName="Move AI"
        brandSub="Imobiliária"
        groups={adminNav}
        footItems={adminFootNav}
      />
      <div className="main">
        <Topbar
          contextLabel="Imobiliária Demo"
          contextSub="Plano Pro · Gestor"
          avatar="ID"
          live="IA online"
        />
        <div className="content">{children}</div>
      </div>
    </div>
  );
}
