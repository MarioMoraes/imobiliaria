import { Icon } from "./Icon";

interface TopbarProps {
  searchPlaceholder?: string;
  /** Nome do usuário logado, exibido ao lado do menu de conta. */
  userName?: string;
  /** Papel do usuário no sistema (ex.: "Gestor"). */
  userRole?: string;
  /** Menu de conta (ex.: <UserButton/> do Clerk). Renderizado à direita. */
  accountSlot?: React.ReactNode;
}

export function Topbar({
  searchPlaceholder = "Buscar imóveis, clientes, contratos…",
  userName,
  userRole,
  accountSlot,
}: TopbarProps) {
  return (
    <header className="topbar">
      <div className="search">
        <Icon name="search" />
        <span>{searchPlaceholder}</span>
      </div>

      <div className="right row gap-8">
        <button className="icon-btn" aria-label="Notificações">
          <Icon name="bell" />
          <span className="dot-notify" />
        </button>
        {userName && (
          <span style={{ lineHeight: 1.15, textAlign: "right" }}>
            <span style={{ fontWeight: 600, fontSize: "0.82rem", display: "block" }}>
              {userName}
            </span>
            {userRole && <span className="text-xs subtle">{userRole}</span>}
          </span>
        )}
        {accountSlot}
      </div>
    </header>
  );
}

export default Topbar;
