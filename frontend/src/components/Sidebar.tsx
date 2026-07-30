"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon } from "./Icon";
import type { NavGroup } from "../lib/nav";

interface SidebarProps {
  variant?: "tenant" | "platform";
  brandName: string;
  brandSub: string;
  /** Logo do tenant (data URL / URL). Quando ausente, mostra o ícone padrão. */
  brandLogo?: string | null;
  groups: NavGroup[];
}

export function Sidebar({
  variant = "tenant",
  brandName,
  brandSub,
  brandLogo,
  groups,
}: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === "/superadmin" || href === "/dashboard"
      ? pathname === href
      : pathname === href || pathname.startsWith(href + "/");

  return (
    <aside className={`sidebar${variant === "platform" ? " sidebar--platform" : ""}`}>
      <div className="sidebar-brand">
        <span className={`brand-mark${brandLogo ? " brand-mark--logo" : ""}`}>
          {brandLogo ? (
            <img src={brandLogo} alt={brandName} />
          ) : (
            <Icon name={variant === "platform" ? "shield" : "home"} size={18} />
          )}
        </span>
        <span>
          <span className="brand-name" style={variant === "platform" ? { color: "#fff" } : undefined}>
            {brandName}
          </span>
          <br />
          <span className="brand-sub">{brandSub}</span>
        </span>
      </div>

      <nav className="sidebar-nav">
        {groups.map((group) => (
          <div className="nav-group" key={group.label}>
            <div className="nav-group-label">{group.label}</div>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={`nav-item ${item.tone ?? "tone-azul"}${isActive(item.href) ? " active" : ""}`}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

    </aside>
  );
}

export default Sidebar;
