import { Icon } from "./Icon";
import { GlobalSearch } from "./GlobalSearch";

interface TopbarProps {
  searchPlaceholder?: string;
  /** Logo da imobiliária (data URL). Ausente → só o nome. */
  brandLogo?: string | null;
  /** Nome da imobiliária, exibido ao lado do logo. */
  brandName?: string;
  /** Nome do usuário logado, exibido ao lado do menu de conta. */
  userName?: string;
  /** Papel do usuário no sistema (ex.: "Gestor"). */
  userRole?: string;
  /** Menu de conta (ex.: <UserButton/> do Clerk). Renderizado à direita. */
  accountSlot?: React.ReactNode;
}

export function Topbar({
  searchPlaceholder = "Buscar imóveis, clientes, contratos…",
  brandLogo,
  brandName,
  userName,
  userRole,
  accountSlot,
}: TopbarProps) {
  return (
    <header className="topbar">
      {/* Marca da imobiliária: o logo personaliza o sistema para o cliente. Sem
          logo enviado, fica só o nome — nada de placeholder genérico. */}
      {(brandLogo || brandName) && (
        <div className="topbar-brand">
          {brandLogo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={brandLogo} alt={brandName ?? "Logo da imobiliária"} />
          )}
          {brandName && <span className="topbar-brand-name">{brandName}</span>}
        </div>
      )}

      <GlobalSearch placeholder={searchPlaceholder} />

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
