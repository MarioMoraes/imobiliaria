/** Configuração de navegação — painel do tenant (admin) e plataforma (superadmin). */

export interface NavItem {
  label: string;
  href: string;
  icon: string;
}
export interface NavGroup {
  label: string;
  items: NavItem[];
}

export const adminNav: NavGroup[] = [
  {
    label: "Principal",
    items: [{ label: "Dashboard", href: "/dashboard", icon: "dashboard" }],
  },
  {
    label: "Cadastros",
    items: [
      { label: "Tabelas", href: "/tabelas", icon: "database" },
      { label: "Imóveis", href: "/imoveis", icon: "building" },
      { label: "Locadores", href: "/proprietarios", icon: "user" },
      { label: "Locatários", href: "/clientes", icon: "users" },
      { label: "Fiadores", href: "/fiadores", icon: "shield" },
      { label: "Corretores", href: "/corretores", icon: "broker" },
      { label: "Funcionários", href: "/funcionarios", icon: "creci" },
    ],
  },
  {
    label: "Condomínios",
    items: [
      { label: "Condomínios", href: "/condominios", icon: "home" },
    ],
  },
  {
    label: "Operação",
    items: [
      { label: "CRM", href: "/crm", icon: "kanban" },
      { label: "Agenda", href: "/agenda", icon: "calendar" },
      { label: "Contratos", href: "/contratos", icon: "contract" },
      { label: "Aluguel", href: "/aluguel", icon: "key" },
      { label: "Manutenção", href: "/manutencao", icon: "wrench" },
      { label: "Documentos", href: "/documentos", icon: "folder" },
    ],
  },
  {
    label: "Financeiro",
    items: [{ label: "Financeiro", href: "/financeiro", icon: "wallet" }],
  },
  {
    label: "Presença Digital",
    items: [
      { label: "Publicação", href: "/publicacao", icon: "megaphone" },
      { label: "Landing Page", href: "/landing", icon: "globe" },
    ],
  },
  {
    label: "Inteligência",
    items: [{ label: "Agentes de IA", href: "/agentes", icon: "bot" }],
  },
];

export const adminFootNav: NavItem[] = [
  { label: "Configurações", href: "/configuracoes", icon: "settings" },
];

export const superadminNav: NavGroup[] = [
  {
    label: "Plataforma",
    items: [
      { label: "Visão Geral", href: "/superadmin", icon: "dashboard" },
      { label: "Tenants", href: "/superadmin/tenants", icon: "building" },
      { label: "Planos & Billing", href: "/superadmin/planos", icon: "wallet" },
      { label: "Saúde", href: "/superadmin/saude", icon: "activity" },
      { label: "Feature Flags", href: "/superadmin/flags", icon: "flag" },
      { label: "Auditoria", href: "/superadmin/auditoria", icon: "list" },
    ],
  },
];
