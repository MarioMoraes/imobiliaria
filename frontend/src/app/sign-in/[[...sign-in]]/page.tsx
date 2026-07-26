import Link from "next/link";
import { Icon } from "@/components/Icon";
import { SignInWidget } from "./SignInWidget";

/**
 * Tela de login (Clerk). Rota pública — ver middleware.ts.
 *
 * `forceRedirectUrl` não é opcional aqui: sem ele o Clerk manda o recém-logado
 * para o padrão dele, que é "/" — a landing. O usuário via a tela inicial de
 * novo (parecia que o login tinha falhado) e os botões "Entrar"/"Criar conta"
 * não abriam nada, porque o Clerk se recusa a mostrar o formulário para quem já
 * tem sessão em modo single-session.
 *
 * Os props de redirect e a proteção contra o laço /dashboard ↔ /sign-in vivem no
 * `SignInWidget` (Client Component) — ele precisa consultar `useAuth()`.
 */
export default function SignInPage() {
  return (
    <main className="auth-shell">
      <Link href="/" className="auth-back">
        <span className="stat-icon">
          <Icon name="building" />
        </span>
        Offices AI Imobiliária
      </Link>
      <div className="auth-body">
        <SignInWidget />
      </div>
    </main>
  );
}
