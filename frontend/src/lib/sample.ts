/**
 * Dados de exemplo — usados pelos módulos cuja API ainda não existe no backend
 * (roadmap do PRD, fases 1–4). Servem para a UI premium ficar realista.
 * Quando o endpoint correspondente existir, troca-se por fetch em lib/api.ts.
 */

export const sampleProperties = [
  { id: "AP-0042", title: "Apartamento 2 quartos · Jardins", kind: "rent", status: "available", priceCents: 320000, city: "São Paulo", state: "SP", bedrooms: 2 },
  { id: "CA-0113", title: "Casa térrea com quintal · Alphaville", kind: "sale", status: "available", priceCents: 118000000, city: "Barueri", state: "SP", bedrooms: 3 },
  { id: "AP-0088", title: "Cobertura duplex · Moema", kind: "sale", status: "reserved", priceCents: 245000000, city: "São Paulo", state: "SP", bedrooms: 4 },
  { id: "SL-0007", title: "Sala comercial · Faria Lima", kind: "commercial", status: "available", priceCents: 850000, city: "São Paulo", state: "SP", bedrooms: 0 },
  { id: "AP-0051", title: "Studio mobiliado · Pinheiros", kind: "rent", status: "rented", priceCents: 280000, city: "São Paulo", state: "SP", bedrooms: 1 },
  { id: "TR-0019", title: "Terreno 500m² · Cotia", kind: "land", status: "available", priceCents: 42000000, city: "Cotia", state: "SP", bedrooms: 0 },
  { id: "AP-0104", title: "Apto 3 dorm · Tatuapé", kind: "sale", status: "sold", priceCents: 76000000, city: "São Paulo", state: "SP", bedrooms: 3 },
  { id: "CA-0090", title: "Casa de praia · Bertioga", kind: "season", status: "available", priceCents: 450000, city: "Bertioga", state: "SP", bedrooms: 4 },
];

export const sampleOwners = [
  { id: "1", name: "João Andrade", doc: "PF", email: "joao@email.com", props: 3, bank: true, status: "active" },
  { id: "2", name: "Construtora Vera Cruz Ltda", doc: "PJ", email: "financeiro@veracruz.com", props: 12, bank: true, status: "active" },
  { id: "3", name: "Marília Souza", doc: "PF", email: "marilia.s@email.com", props: 1, bank: false, status: "active" },
  { id: "4", name: "Espólio de R. Menezes", doc: "PF", email: "—", props: 2, bank: true, status: "inactive" },
];

export const sampleCustomers = [
  { id: "1", name: "Ana Lima", stage: "LEAD", source: "WhatsApp", broker: "Carlos M.", budget: "até R$ 3.000/mês", intent: "Locação" },
  { id: "2", name: "Pedro Nogueira", stage: "CLIENTE", source: "Site", broker: "Bianca R.", budget: "até R$ 900k", intent: "Compra" },
  { id: "3", name: "Família Ribeiro", stage: "INQUILINO", source: "Indicação", broker: "Carlos M.", budget: "R$ 3.200/mês", intent: "Locação" },
  { id: "4", name: "Marcos Teixeira", stage: "LEAD", source: "Instagram", broker: "—", budget: "até R$ 1.5M", intent: "Compra" },
  { id: "5", name: "Juliana Prado", stage: "COMPRADOR", source: "Portal ZAP", broker: "Diego F.", budget: "R$ 760k", intent: "Compra" },
];

export const sampleBrokers = [
  { id: "1", name: "Carlos Mendes", creci: "SP-123456", team: "Vendas Zona Sul", deals: 18, conv: 32, commission: 4820000, avatar: "CM" },
  { id: "2", name: "Bianca Rocha", creci: "SP-234567", team: "Locação", deals: 24, conv: 41, commission: 3110000, avatar: "BR" },
  { id: "3", name: "Diego Ferraz", creci: "SP-345678", team: "Vendas Zona Sul", deals: 12, conv: 27, commission: 2740000, avatar: "DF" },
  { id: "4", name: "Letícia Alves", creci: "SP-456789", team: "Alto padrão", deals: 9, conv: 38, commission: 6980000, avatar: "LA" },
];

export const sampleEmployees = [
  { id: "1", name: "Renata Campos", role: "Financeiro", access: "active", roles: ["FINANCEIRO"] },
  { id: "2", name: "Otávio Dias", role: "Gestor", access: "active", roles: ["GESTOR"] },
  { id: "3", name: "Paula Neves", role: "Recepção / Admin", access: "active", roles: ["ADMIN"] },
  { id: "4", name: "Rafael Lopes", role: "Financeiro", access: "suspended", roles: ["FINANCEIRO"] },
];

export const dealStages = [
  { key: "novo", label: "Novo lead", color: "var(--muted)" },
  { key: "contato", label: "Em contato", color: "var(--primary)" },
  { key: "visita", label: "Visita agendada", color: "var(--accent)" },
  { key: "proposta", label: "Proposta", color: "var(--warning)" },
  { key: "ganho", label: "Ganho", color: "var(--success)" },
];

export const sampleDeals: Record<string, { name: string; prop: string; value: string; broker: string; sla?: string }[]> = {
  novo: [
    { name: "Ana Lima", prop: "Apto Jardins", value: "R$ 3.000/mês", broker: "—", sla: "SLA 12min" },
    { name: "Marcos Teixeira", prop: "Cobertura Moema", value: "R$ 1.5M", broker: "—", sla: "SLA 8min" },
  ],
  contato: [
    { name: "Juliana Prado", prop: "Casa Alphaville", value: "R$ 760k", broker: "Diego F." },
    { name: "Sérgio Braga", prop: "Sala Faria Lima", value: "R$ 8.5k/mês", broker: "Bianca R." },
  ],
  visita: [
    { name: "Família Ribeiro", prop: "Studio Pinheiros", value: "R$ 3.2k/mês", broker: "Carlos M." },
  ],
  proposta: [
    { name: "Pedro Nogueira", prop: "Apto Tatuapé", value: "R$ 720k", broker: "Bianca R." },
  ],
  ganho: [
    { name: "Camila Reis", prop: "Casa Cotia", value: "R$ 540k", broker: "Letícia A." },
  ],
};

export const sampleAppointments = [
  { time: "09:00", type: "Visita", title: "Apto Jardins · Ana Lima", broker: "Carlos M.", status: "confirmed" },
  { time: "10:30", type: "Vistoria", title: "Entrada · Studio Pinheiros", broker: "Bianca R.", status: "confirmed" },
  { time: "14:00", type: "Reunião", title: "Proprietário · Construtora Vera Cruz", broker: "Otávio D.", status: "pending" },
  { time: "16:00", type: "Visita", title: "Cobertura Moema · Marcos T.", broker: "Diego F.", status: "pending" },
  { time: "17:30", type: "Vistoria", title: "Saída · Apto Tatuapé", broker: "Carlos M.", status: "confirmed" },
];

export const sampleContracts = [
  { id: "CT-2041", type: "Locação", party: "Família Ribeiro", prop: "Studio Pinheiros", value: "R$ 3.200/mês", status: "vigente", ends: "12 mar 2026" },
  { id: "CT-2038", type: "Venda", party: "Juliana Prado", prop: "Apto Tatuapé", value: "R$ 760.000", status: "signing", ends: "—" },
  { id: "CT-2033", type: "Locação", party: "Sérgio Braga", prop: "Sala Faria Lima", value: "R$ 8.500/mês", status: "vigente", ends: "30 jun 2026" },
  { id: "CT-2045", type: "Intermediação", party: "Construtora Vera Cruz", prop: "Empreend. Vista Verde", value: "6% comissão", status: "draft", ends: "—" },
];

export const sampleReceivables = [
  { id: "1", desc: "Aluguel · Studio Pinheiros", party: "Família Ribeiro", due: "05 jul", value: 320000, status: "paid" },
  { id: "2", desc: "Aluguel · Sala Faria Lima", party: "Sérgio Braga", due: "10 jul", value: 850000, status: "pending" },
  { id: "3", desc: "Aluguel · Apto Moema", party: "L. Fernandes", due: "28 jun", value: 480000, status: "overdue" },
  { id: "4", desc: "Comissão venda · Apto Tatuapé", party: "Bianca R.", due: "15 jul", value: 3800000, status: "pending" },
];

export const sampleMaintenance = [
  { id: "MN-311", prop: "Studio Pinheiros", cat: "Hidráulica", who: "Família Ribeiro", status: "pending", cost: "R$ 380" },
  { id: "MN-308", prop: "Apto Moema", cat: "Elétrica", who: "L. Fernandes", status: "active", cost: "R$ 1.240" },
  { id: "MN-302", prop: "Casa Alphaville", cat: "Estrutural", who: "Interno", status: "paid", cost: "R$ 4.900" },
];

// `sampleDocuments` saiu em 2026-07-29: /documentos passou a ler o MOD-DOC.

export const samplePortals = [
  { name: "Viva Real", listings: 42, status: "ok", sync: "há 3 min" },
  { name: "ZAP Imóveis", listings: 42, status: "ok", sync: "há 3 min" },
  { name: "OLX", listings: 28, status: "degraded", sync: "há 2 h" },
  { name: "Imovelweb", listings: 0, status: "down", sync: "—" },
];

export const sampleConversations = [
  { name: "Ana Lima", channel: "WhatsApp", last: "Tem algo de 2 quartos até 3 mil nos Jardins?", status: "active", sentiment: "pos" },
  { name: "Marcos Teixeira", channel: "Instagram", last: "Quero agendar uma visita na cobertura", status: "active", sentiment: "neu" },
  { name: "Cliente #4821", channel: "Chat", last: "Isso não está funcionando, quero falar com alguém", status: "handoff", sentiment: "neg" },
  { name: "Sérgio Braga", channel: "E-mail", last: "Obrigado, contrato recebido!", status: "closed", sentiment: "pos" },
];

/* -------------------------------------------------- Super Admin (plataforma) */
export const sampleTenants = [
  { id: "1", name: "Imobiliária Demo", slug: "demo", plan: "pro", status: "active", props: 128, agents: 3, createdAt: "2026-01-04T00:00:00Z" },
  { id: "2", name: "Vera Cruz Imóveis", slug: "veracruz", plan: "enterprise", status: "active", props: 640, agents: 8, createdAt: "2025-11-20T00:00:00Z" },
  { id: "3", name: "Alpha Negócios", slug: "alpha", plan: "starter", status: "trial", props: 14, agents: 1, createdAt: "2026-06-28T00:00:00Z" },
  { id: "4", name: "Litoral Sul Locações", slug: "litoralsul", plan: "pro", status: "suspended", props: 96, agents: 2, createdAt: "2025-09-12T00:00:00Z" },
];

export const samplePlans = [
  { name: "Starter", price: "R$ 149/mês", props: "até 50", agents: "1 agente", tenants: 42 },
  { name: "Pro", price: "R$ 449/mês", props: "até 300", agents: "3 agentes", tenants: 118 },
  { name: "Enterprise", price: "sob consulta", props: "ilimitado", agents: "ilimitado", tenants: 9 },
];

export const sampleHealth = [
  { name: "PostgreSQL", status: "ok", latency: "4 ms" },
  { name: "Redis", status: "ok", latency: "1 ms" },
  { name: "RabbitMQ", status: "ok", latency: "6 ms" },
  { name: "ai-orchestrator", status: "degraded", latency: "820 ms" },
  { name: "notification-service", status: "ok", latency: "42 ms" },
  { name: "Asaas (gateway)", status: "ok", latency: "180 ms" },
];

export const sampleFlags = [
  { flag: "ai_agents", label: "Agentes de IA", scope: "Plano Pro+", enabled: true },
  { flag: "portal_publishing", label: "Publicação em portais", scope: "Global", enabled: true },
  { flag: "custom_domain", label: "Domínio próprio (landing)", scope: "Plano Pro+", enabled: true },
  { flag: "electronic_signature", label: "Assinatura eletrônica", scope: "Beta", enabled: false },
  { flag: "instagram_channel", label: "Canal Instagram", scope: "Add-on", enabled: false },
];

export const sampleAudit = [
  { actor: "Super Admin · Offices AI", action: "tenant.suspended", target: "Litoral Sul Locações", when: "há 2 h" },
  { actor: "Otávio Dias · Vera Cruz", action: "contract.signed", target: "CT-2041", when: "há 4 h" },
  { actor: "Sistema · billing", action: "subscription.past_due", target: "Alpha Negócios", when: "há 6 h" },
  { actor: "Renata Campos · Demo", action: "transfer.executed", target: "Repasse #8841", when: "ontem" },
  { actor: "AI Agent · Demo", action: "lead.created", target: "Ana Lima", when: "ontem" },
];
