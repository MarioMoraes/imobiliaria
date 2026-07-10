import Link from "next/link";

export default function HomePage() {
  return (
    <main>
      <span className="badge">Fase 0 — Fundação</span>
      <h1>Move AI Imobiliária</h1>
      <p className="muted">
        Plataforma SaaS multi-tenant para imobiliárias, com uma camada de agentes
        de IA (AaaS) sobre o núcleo de gestão. Este é o esqueleto executável do
        projeto.
      </p>
      <p>
        <Link href="/properties">Ver imóveis do tenant demo →</Link>
      </p>
    </main>
  );
}
