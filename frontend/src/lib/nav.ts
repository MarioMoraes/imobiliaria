/** Configuração de navegação — painel do tenant (admin) e plataforma (superadmin). */

export interface NavItem {
  label: string;
  href: string;
  icon: string;
  /**
   * Cor do ícone na barra lateral (classe `tone-*` de globals.css). Serve de
   * âncora visual: cada destino tem sempre a mesma cor, então o olho encontra o
   * item pela cor antes de ler o rótulo. Só o ícone é colorido — o texto segue
   * neutro, para a lista não virar um arco-íris.
   */
  tone?: string;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const adminNav: NavGroup[] = [
  {
    label: "Principal",
    items: [{ label: "Dashboard", href: "/dashboard", icon: "dashboard", tone: "tone-azul" }],
  },
  {
    label: "Cadastros",
    items: [
      // Não use `tone-ardosia` aqui: é um cinza-azulado e lê como ícone
      // apagado no meio dos coloridos.
      { label: "Tabelas", href: "/tabelas", icon: "database", tone: "tone-esmeralda" },
      { label: "Imóveis", href: "/imoveis", icon: "building", tone: "tone-ciano" },
      { label: "Locadores", href: "/proprietarios", icon: "user", tone: "tone-indigo" },
      { label: "Locatários", href: "/clientes", icon: "users", tone: "tone-teal" },
      { label: "Fiadores", href: "/fiadores", icon: "shield", tone: "tone-ambar" },
      { label: "Corretores", href: "/corretores", icon: "broker", tone: "tone-rosa" },
      { label: "Funcionários", href: "/funcionarios", icon: "creci", tone: "tone-violeta" },
    ],
  },
  {
    label: "Condomínios",
    items: [
      { label: "Condomínios", href: "/condominios", icon: "home", tone: "tone-azul" },
    ],
  },
  // Grupo "Operação" (CRM, Agenda, Aluguel, Manutenção, Documentos) retirado do
  // menu em 2026-07-21 — volta quando esses módulos forem implementados. As
  // rotas continuam existindo em app/(admin), só não são mais navegáveis pela
  // barra lateral; para reativar, basta descomentar.
  // {
  //   label: "Operação",
  //   items: [
  //     { label: "CRM", href: "/crm", icon: "kanban", tone: "tone-indigo" },
  //     { label: "Agenda", href: "/agenda", icon: "calendar", tone: "tone-ciano" },
  //     { label: "Aluguel", href: "/aluguel", icon: "key", tone: "tone-ambar" },
  //     { label: "Manutenção", href: "/manutencao", icon: "wrench", tone: "tone-ardosia" },
  //     { label: "Documentos", href: "/documentos", icon: "folder", tone: "tone-teal" },
  //   ],
  // },
  {
    label: "Financeiro",
    items: [{ label: "Financeiro", href: "/financeiro", icon: "wallet", tone: "tone-esmeralda" }],
  },
  // Grupo "Presença Digital" (Publicação, Landing Page) retirado do menu em
  // 2026-07-21, pelo mesmo motivo do grupo Operação acima. Rotas preservadas.
  // {
  //   label: "Presença Digital",
  //   items: [
  //     { label: "Publicação", href: "/publicacao", icon: "megaphone", tone: "tone-rosa" },
  //     { label: "Landing Page", href: "/landing", icon: "globe", tone: "tone-ciano" },
  //   ],
  // },
  {
    label: "Inteligência",
    items: [{ label: "Agentes de IA", href: "/agentes", icon: "bot", tone: "tone-violeta" }],
  },
];

export const adminFootNav: NavItem[] = [
  { label: "Configurações", href: "/configuracoes", icon: "settings", tone: "tone-ardosia" },
];

export const superadminNav: NavGroup[] = [
  {
    label: "Plataforma",
    items: [
      { label: "Visão Geral", href: "/superadmin", icon: "dashboard", tone: "tone-azul" },
      { label: "Tenants", href: "/superadmin/tenants", icon: "building", tone: "tone-ciano" },
      { label: "Planos & Billing", href: "/superadmin/planos", icon: "wallet", tone: "tone-esmeralda" },
      { label: "Saúde", href: "/superadmin/saude", icon: "activity", tone: "tone-teal" },
      { label: "Feature Flags", href: "/superadmin/flags", icon: "flag", tone: "tone-ambar" },
      { label: "Auditoria", href: "/superadmin/auditoria", icon: "list", tone: "tone-ardosia" },
    ],
  },
];
