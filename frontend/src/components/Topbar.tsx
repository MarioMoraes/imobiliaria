import { Icon } from "./Icon";

interface TopbarProps {
  searchPlaceholder?: string;
  contextLabel: string;
  contextSub: string;
  avatar: string;
  live?: string;
}

export function Topbar({
  searchPlaceholder = "Buscar imóveis, clientes, contratos…",
  contextLabel,
  contextSub,
  avatar,
  live,
}: TopbarProps) {
  return (
    <header className="topbar">
      <div className="search">
        <Icon name="search" />
        <span>{searchPlaceholder}</span>
      </div>

      <div className="right row gap-8">
        {live && (
          <span className="badge badge-cyan" title="Agentes de IA online">
            <span className="pulse-dot">
              <span />
              <span />
            </span>
            {live}
          </span>
        )}
        <button className="icon-btn" aria-label="Notificações">
          <Icon name="bell" />
          <span className="dot-notify" />
        </button>
        <button className="tenant-switch" aria-label="Trocar contexto">
          <span className="avatar">{avatar}</span>
          <span style={{ lineHeight: 1.15, textAlign: "left" }}>
            <span style={{ fontWeight: 600, fontSize: "0.82rem", display: "block" }}>
              {contextLabel}
            </span>
            <span className="text-xs subtle">{contextSub}</span>
          </span>
          <Icon name="chevronDown" size={15} />
        </button>
      </div>
    </header>
  );
}

export default Topbar;
