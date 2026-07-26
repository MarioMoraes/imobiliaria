import type { Metadata } from "next";
import { Inter, Poppins } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-inter",
  display: "swap",
});

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
  variable: "--font-poppins",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Offices AI Imobiliária",
  description:
    "Plataforma SaaS multi-tenant para imobiliárias com agentes de IA",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // afterSignOutUrl: sair leva de volta à landing pública ("/").
  //
  // Os *FallbackRedirectUrl existem porque o destino PADRÃO do Clerk depois do
  // login é "/" — a landing. Quem entrasse por um ponto que esquecesse de dizer
  // para onde ir caía de volta na tela inicial, como se o login tivesse
  // falhado, e ainda ficava com os botões "Entrar"/"Criar conta" inertes (o
  // Clerk não abre o formulário para quem já tem sessão). É `fallback` e não
  // `force` de propósito: `force` atropelaria o `redirect_url` da URL e
  // quebraria o fluxo de convite (/aceitar-convite).
  return (
    <ClerkProvider
      afterSignOutUrl="/"
      signInFallbackRedirectUrl="/dashboard"
      signUpFallbackRedirectUrl="/onboarding"
    >
      <html lang="pt-BR" className={`${inter.variable} ${poppins.variable}`}>
        {/*
          suppressHydrationWarning: extensões de navegador (Grammarly, Bitdefender,
          LastPass, ColorZilla…) injetam atributos no <body> antes do React hidratar
          (ex.: data-new-gr-c-s-check-loaded, bis_skin_checked, cz-shortcut-listen).
          Isso gera "hydration mismatch" que NÃO é bug do app. Suprimimos só neste
          nível — não mascara diferenças reais dentro da árvore.
        */}
        <body suppressHydrationWarning>{children}</body>
      </html>
    </ClerkProvider>
  );
}
