import Link from "next/link";
import { SignUp } from "@clerk/nextjs";
import { Icon } from "@/components/Icon";

/** Tela de cadastro (Clerk). Rota pública — ver middleware.ts. */
export default function SignUpPage() {
  return (
    <main className="auth-shell">
      <Link href="/" className="auth-back">
        <span className="stat-icon">
          <Icon name="building" />
        </span>
        Offices AI Imobiliária
      </Link>
      <div className="auth-body">
        <SignUp
          signInUrl="/sign-in"
          forceRedirectUrl="/onboarding"
          signInForceRedirectUrl="/dashboard"
        />
      </div>
    </main>
  );
}
