import Link from "next/link";
import { SignIn } from "@clerk/nextjs";
import { Icon } from "@/components/Icon";

/** Tela de login (Clerk). Rota pública — ver middleware.ts. */
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
        <SignIn signUpUrl="/sign-up" />
      </div>
    </main>
  );
}
