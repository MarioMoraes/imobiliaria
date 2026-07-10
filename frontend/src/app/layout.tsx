import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Move AI Imobiliária",
  description: "Plataforma SaaS multi-tenant para imobiliárias com agentes de IA",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
