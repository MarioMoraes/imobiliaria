import { notFound } from "next/navigation";
import { PageHeader } from "../../../../../components/ui";
import { backendNotice, fetchCondominium, fetchCurrentUser } from "../../../../../lib/api";
import { BILLING_ROLES } from "../../../../../lib/condo-billing";
import { CobrancaPanel } from "./CobrancaPanel";

/**
 * Cobrança do condomínio — informa-se o período e o vencimento; o sistema
 * rateia as despesas lançadas entre as unidades, soma o valor de condomínio de
 * cada imóvel (× meses) e gera as contas a receber.
 *
 * O condomínio vem do caminho: quem chega aqui saiu do condomínio aberto, e
 * pedir para escolhê-lo de novo era o que fazia a tela parecer desconexa do
 * resto do módulo.
 *
 * Gerar é escrita no financeiro: sem `finance:write` a página não existe (404),
 * o mesmo critério que esconde o card no hub do condomínio.
 */
export default async function CobrancaPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const [me, condominium] = await Promise.all([fetchCurrentUser(), fetchCondominium(id)]);

  const canBill = (me?.roles ?? []).some((role) => BILLING_ROLES.includes(role));
  if (!canBill) notFound();

  return (
    <>
      <PageHeader
        title={condominium ? `Cobrança · ${condominium.name}` : "Cobrança de Condomínio"}
        backHref={`/condominios/${id}`}
      />
      <CobrancaPanel condominiumId={id} notice={backendNotice()} />
    </>
  );
}
