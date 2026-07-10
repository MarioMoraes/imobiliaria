import Link from "next/link";
import { fetchProperties, formatPrice } from "@/lib/api";

// Server Component: busca no backend a cada request (dados por tenant).
export default async function PropertiesPage() {
  let properties;
  try {
    properties = await fetchProperties();
  } catch (err) {
    return (
      <main>
        <p>
          <Link href="/">← Início</Link>
        </p>
        <h1>Imóveis</h1>
        <div className="card">
          <p>Não foi possível carregar os imóveis do backend.</p>
          <p className="muted">
            Verifique se a infra e o backend estão de pé: <code>npm run infra:up</code>{" "}
            e <code>npm run dev:backend</code>. Detalhe: {String(err)}
          </p>
        </div>
      </main>
    );
  }

  return (
    <main>
      <p>
        <Link href="/">← Início</Link>
      </p>
      <h1>Imóveis</h1>
      <p className="muted">{properties.length} imóvel(is) no tenant demo.</p>
      <div className="grid">
        {properties.map((p) => (
          <div className="card" key={p.id}>
            <span className="badge">{p.status}</span>
            <h3 style={{ margin: "0.5rem 0" }}>{p.title}</h3>
            <p className="muted" style={{ margin: 0 }}>
              {[p.city, p.state].filter(Boolean).join(" / ") || "Localização não informada"}
              {p.bedrooms ? ` · ${p.bedrooms} quarto(s)` : ""}
            </p>
            <p style={{ margin: "0.5rem 0 0", fontWeight: 600 }}>
              {formatPrice(p.priceCents)}
            </p>
          </div>
        ))}
      </div>
    </main>
  );
}
