import Link from "next/link";
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
  /**
   * Destino do ícone de configurações, ao lado das notificações. Ausente → o
   * ícone não aparece (a área de plataforma não tem configurações de tenant).
   */
  settingsHref?: string;
}

export function Topbar({
  searchPlaceholder = "Buscar imóveis, clientes, contratos…",
  brandLogo,
  brandName,
  userName,
  userRole,
  accountSlot,
  settingsHref,
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
        {/* Mesma moldura das notificações (`icon-btn`): são os dois utilitários
            da barra, e um botão com borda ao lado de um sem borda leria como
            estados diferentes do mesmo controle. */}
        {settingsHref && (
          <Link
            href={settingsHref}
            className="icon-btn"
            aria-label="Configurações"
            title="Configurações"
          >
            <Icon name="settings" />
          </Link>
        )}
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
