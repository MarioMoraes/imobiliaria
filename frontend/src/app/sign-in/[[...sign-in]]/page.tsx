import { SignIn } from "@clerk/nextjs";

/** Tela de login (Clerk). Rota pública — ver middleware.ts. */
export default function SignInPage() {
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
      <SignIn signUpUrl="/sign-up" />
    </main>
  );
}
