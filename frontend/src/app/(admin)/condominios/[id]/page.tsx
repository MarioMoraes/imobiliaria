import Link from "next/link";
import { notFound } from "next/navigation";
import { PageHeader, StatCard } from "../../../../components/ui";
import { Icon } from "../../../../components/Icon";
import { BackendNotice } from "../../../../components/BackendNotice";
import {
  backendNotice,
  fetchCondominium,
  fetchCondominiumExpenses,
  fetchCurrentUser,
  fetchPropertiesByCondominium,
  formatPrice,
  type Property,
} from "../../../../lib/api";
import { BILLING_ROLES } from "../../../../lib/condo-billing";

/**
 * O condomínio aberto — hub do que se faz nele: consultar os condôminos, lançar
 * despesas e gerar a cobrança do período. Mesmo padrão de /financeiro,
 * /auditoria e /corretores.
 *
 * A tela existe porque as três coisas viviam em lugares diferentes: as despesas
 * atrás de um botão no cabeçalho de uma tela chamada "Condôminos", e a cobrança
 * numa página da listagem que pedia o condomínio de novo. Aqui o condomínio é o
 * contexto, e cada opção diz o que é.
 */

/** Formata percentual (0–100) no padrão pt-BR: 10 → "10,00%". */
function formatPercent(n: number): string {
  return `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function CondominioPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  // Id que não é UUID nunca foi um condomínio: 404 direto. Sem isto, as duas
  // leituras falham com 400 e a tela renderiza um hub vazio com "o servidor
  // respondeu com erro" — que manda investigar a infra por um link velho.
  // `/condominios/cobranca` (a URL antiga da cobrança) cai exatamente aqui.
  if (!UUID.test(id)) notFound();

  const [condominium, live, expenses, me] = await Promise.all([
    fetchCondominium(id),
    fetchPropertiesByCondominium(id),
    fetchCondominiumExpenses(id),
    fetchCurrentUser(),
  ]);

  // Condomínio inexistente (ou id inválido) com backend no ar → 404.
  if (condominium === null && live !== null) notFound();

  const properties: Property[] = live ?? [];
  const notice = backendNotice();
  // Gerar cobrança grava contas a receber: quem não pode escrever no financeiro
  // nem vê o card (o backend recusaria o POST de qualquer forma).
  const canBill = (me?.roles ?? []).some((role) => BILLING_ROLES.includes(role));

  const rented = properties.filter((p) => p.status === "rented").length;

  return (
    <>
      <PageHeader title={condominium?.name ?? "Condomínio"} backHref="/condominios" />

      {condominium && (
        <div className="grid grid-3 mb-4">
          <StatCard
            icon="wallet"
            label="Saldo"
            value={formatPrice(condominium.balanceCents)}
            tone="success"
          />
          <StatCard
            icon="receipt"
            label="Taxa de administração"
            value={
              formatPercent(condominium.adminFeePercent) +
              (condominium.adminFeeFixedCents > 0
                ? ` + ${formatPrice(condominium.adminFeeFixedCents)}`
                : "")
            }
            tone="accent"
          />
          <StatCard
            icon="building"
            label="Total de Condôminos"
            value={String(properties.length)}
            tone="blue"
          />
        </div>
      )}

      <div className="grid grid-3">
        <Link href={`/condominios/${id}/condominos`} className="lookup-card reveal">
          <span className="stat-icon blue">
            <Icon name="building" />
          </span>
          <div className="stack" style={{ gap: 4 }}>
            <span className="lookup-card-title">Condôminos</span>
            <span className="subtle text-sm">
              Os imóveis do condomínio, quem paga cada um e o boleto da cobrança.
            </span>
          </div>
          <div className="lookup-card-foot">
            <span className="badge badge-slate">
              {properties.length} {properties.length === 1 ? "imóvel" : "imóveis"}
              {rented > 0 ? ` · ${rented} alugado(s)` : ""}
            </span>
            <span className="row gap-8 text-sm strong">
              Abrir <Icon name="arrowRight" size={15} />
            </span>
          </div>
        </Link>

        <Link href={`/condominios/${id}/despesas`} className="lookup-card reveal">
          <span className="stat-icon warning">
            <Icon name="receipt" />
          </span>
          <div className="stack" style={{ gap: 4 }}>
            <span className="lookup-card-title">Despesas</span>
            <span className="subtle text-sm">
              Lance os débitos do condomínio — são eles que formam o rateio da cobrança.
            </span>
          </div>
          <div className="lookup-card-foot">
            <span className="badge badge-slate">
              {expenses === null
                ? "Lançamentos"
                : `${expenses.length} ${expenses.length === 1 ? "lançamento" : "lançamentos"}`}
            </span>
            <span className="row gap-8 text-sm strong">
              Abrir <Icon name="arrowRight" size={15} />
            </span>
          </div>
        </Link>

        {canBill && (
          <Link href={`/condominios/${id}/cobranca`} className="lookup-card reveal">
            <span className="stat-icon accent">
              <Icon name="banknote" />
            </span>
            <div className="stack" style={{ gap: 4 }}>
              <span className="lookup-card-title">Cobrança</span>
              <span className="subtle text-sm">
                Gere as contas a receber de um período: rateio das despesas mais o condomínio.
              </span>
            </div>
            <div className="lookup-card-foot">
              <span className="badge badge-slate">Financeiro</span>
              <span className="row gap-8 text-sm strong">
                Abrir <Icon name="arrowRight" size={15} />
              </span>
            </div>
          </Link>
        )}
      </div>

      {notice && (
        <p className="text-xs subtle mt-4">
          <BackendNotice message={notice} />
        </p>
      )}
    </>
  );
}
