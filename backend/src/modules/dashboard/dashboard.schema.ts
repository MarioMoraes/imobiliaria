/**
 * Contratos de dados do painel inicial (MOD-DASHBOARD).
 *
 * É um módulo de LEITURA agregada: não tem entidade própria nem escrita, só
 * projeta números que já existem em imóveis, contratos e contas a receber.
 * Por isso os tipos vivem aqui como interfaces (não há input a validar).
 */

/** Contagem de imóveis por situação. */
export interface PropertyStats {
  total: number;
  available: number;
  reserved: number;
  rented: number;
  sold: number;
  /** Cadastrados nos últimos 30 dias — alimenta o "tendência" do card. */
  createdLast30Days: number;
}

/** Situação da carteira de contratos. */
export interface ContractStats {
  active: number;
  inSignature: number;
  draft: number;
  /** VIGENTE com `ends_at` dentro dos próximos 90 dias. */
  endingSoon: number;
}

/** Parcela a vencer ou vencida, já com o nome de quem paga. */
export interface ReceivableBrief {
  id: string;
  dueDate: string;
  amountCents: number;
  status: string;
  kind: string;
  description: string | null;
  payerName: string | null;
}

/**
 * Bloco financeiro. É `null` para quem não tem `finance:read` (corretor, por
 * exemplo) — o painel simplesmente não mostra os cards de dinheiro.
 */
export interface FinanceStats {
  /** Pago dentro do mês corrente. */
  receivedThisMonthCents: number;
  /** Em aberto com vencimento no mês corrente. */
  openThisMonthCents: number;
  /** Vencido e não pago (qualquer competência). */
  overdueCents: number;
  overdueCount: number;
  /*
   * A série mensal do gráfico NÃO vem daqui: o painel e a Gestão Financeira
   * leem o mesmo `GET /v1/receivables/cash-flow` (recebido x previsto). Havia
   * uma `monthlyRevenue` própria neste resumo, e as duas consultas divergiam na
   * tela — uma agregação a menos aqui é uma fonte da verdade a mais.
   */
  /** Aluguéis que ainda vencem no mês corrente (de hoje até o fim do mês). */
  upcoming: ReceivableBrief[];
  /** Parcelas vencidas, das mais antigas para as mais novas. */
  overdue: ReceivableBrief[];
}

/** Contagem do cadastro de pessoas por papel. */
export interface PersonStats {
  landlords: number;
  tenants: number;
  guarantors: number;
}

/** Resposta de GET /v1/dashboard/summary. */
export interface DashboardSummary {
  properties: PropertyStats;
  contracts: ContractStats;
  persons: PersonStats;
  finance: FinanceStats | null;
}
