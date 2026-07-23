import * as repo from "./dashboard.repository.js";
import type { DashboardSummary } from "./dashboard.schema.js";

/**
 * Monta o resumo do painel. As quatro consultas são independentes, então vão
 * em paralelo (cada uma abre sua própria transação com o tenant no withTenant).
 *
 * `withFinance` vem da autorização da rota: quem não tem `finance:read` recebe
 * `finance: null` e o painel some com os cards de dinheiro, em vez de mostrar
 * zeros que pareceriam um erro.
 */
export async function summary(
  tenantId: string,
  withFinance: boolean,
): Promise<DashboardSummary> {
  const [properties, contracts, persons, finance] = await Promise.all([
    repo.propertyStats(tenantId),
    repo.contractStats(tenantId),
    repo.personStats(tenantId),
    withFinance ? repo.financeStats(tenantId) : Promise.resolve(null),
  ]);

  return { properties, contracts, persons, finance };
}
