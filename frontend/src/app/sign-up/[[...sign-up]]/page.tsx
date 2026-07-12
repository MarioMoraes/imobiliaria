import { SignUp } from "@clerk/nextjs";

/** Tela de cadastro (Clerk). Rota pública — ver middleware.ts. */
export default function SignUpPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: "2rem",
        background: "var(--bg, #0b0b12)",
      }}
    >
      <SignUp signInUrl="/sign-in" forceRedirectUrl="/onboarding" />
    </main>
  );
}
