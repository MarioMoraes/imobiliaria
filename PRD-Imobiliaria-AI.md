# PRD — Imobiliária AI
### Product Requirements Document (Documento Mestre / Guarda-Chuva)

| Campo | Valor |
|---|---|
| Produto | Move AI Imobiliária |
| Tipo | SaaS Multi-tenant (AaaS — Agent as a Service) |
| Versão do documento | 1.0 |
| Status | Em elaboração — base para PRDs de módulo |
| Público-alvo | Imobiliárias e administradoras de imóveis (B2B) |

---

## 1. Visão Geral do Produto

**Move AI Imobiliária** é uma plataforma SaaS multi-tenant que unifica toda a operação de uma imobiliária ou administradora de imóveis — cadastro, locação, venda, financeiro, contratos, manutenção, documentos e relacionamento — e entrega, sobre essa base operacional, uma camada de **agentes de inteligência artificial** capazes de atender clientes, qualificar leads, recomendar imóveis, gerar conteúdo e automatizar tarefas internas.

A tese central do produto é: **um agente de IA só é tão bom quanto os dados e processos que o alimentam**. Por isso, o sistema é desenhado em duas camadas complementares:

1. **Camada de Gestão (Core Operacional)** — CRM, cadastros, contratos, financeiro, portais, publicação de imóveis. É o "corpo" do sistema, fonte única da verdade (single source of truth) para os agentes.
2. **Camada de Agentes (AaaS)** — agentes de IA orquestrados (via LangGraph) que consomem a camada de gestão para atender, vender, qualificar, documentar e reportar, atuando em múltiplos canais (WhatsApp, Instagram, Chat, E-mail).

Cada imobiliária (tenant) opera de forma isolada, com seus próprios dados, usuários, marca, domínio de landing page e configurações de integração — mas compartilha a mesma infraestrutura, código e evolução contínua da plataforma.

---

## 2. Objetivos do Produto

### 2.1 Objetivos de Negócio
- Tornar-se a plataforma de referência para imobiliárias de pequeno e médio porte no Brasil que desejam operar com atendimento assistido por IA.
- Reduzir o custo operacional das imobiliárias clientes via automação de atendimento, captação e qualificação de leads.
- Criar um modelo de receita recorrente (assinatura por tenant, possivelmente por faixas de uso/agentes ativos).
- Viabilizar upsell de "pacotes de agentes de IA" como camada premium sobre o core de gestão.

### 2.2 Objetivos de Produto
- Entregar um sistema de gestão imobiliária completo, comparável ou superior às soluções de mercado (ex.: Vista, ImobiBrasil, Union, Superlógica Imobiliária).
- Garantir que toda a informação necessária para os agentes de IA operarem esteja estruturada, atualizada e acessível via API interna.
- Oferecer autoatendimento (self-service onboarding) para novas imobiliárias assinarem e configurarem seu tenant.
- Prover portais dedicados para proprietários, clientes e corretores, reduzindo a carga operacional da equipe interna.

### 2.3 Objetivos Técnicos
- Arquitetura multi-tenant segura, com isolamento lógico (e, quando necessário, físico) de dados.
- Arquitetura de microserviços escalável horizontalmente, tolerante a falhas.
- Observabilidade e auditoria completas, atendendo requisitos de LGPD e segurança de dados sensíveis (documentos, dados financeiros, dados pessoais).
- Base de agentes de IA reutilizável e extensível (novos agentes/skills sem reescrever a plataforma).

---

## 3. Problema e Oportunidade

### 3.1 Problemas do mercado atual
- Imobiliárias pequenas/médias usam sistemas fragmentados (planilhas + CRM genérico + portal de anúncios + WhatsApp manual).
- Atendimento inicial de leads é lento, inconsistente e depende de disponibilidade humana (perda de leads fora do horário comercial).
- Processos de locação (vistoria, contrato, cobrança, manutenção) são manuais, gerando erros e retrabalho.
- Publicação de imóveis em múltiplos portais é manual e repetitiva.
- Falta de dados estruturados impede qualquer automação inteligente real (não é possível plugar IA em cima de planilhas).

### 3.2 Oportunidade
Construir uma plataforma nativamente estruturada para IA, onde o atendimento automatizado não é um "chatbot acoplado", mas um conjunto de agentes com acesso real e seguro aos dados operacionais (imóveis disponíveis, status de contratos, histórico do cliente, disponibilidade de agenda), permitindo qualificação e resolução de ponta a ponta.

---

## 4. Modelo de Negócio e Arquitetura Multi-tenant

### 4.1 Conceito de Tenant
- Cada **tenant** = uma imobiliária/administradora contratante.
- Um tenant possui: usuários próprios, imóveis próprios, clientes/leads próprios, configurações de integração próprias (chaves Asaas/Stripe, número de WhatsApp, domínio de landing page), identidade visual (logo, cores, subdomínio ou domínio próprio) e planos/limites de uso próprios.
- Isolamento de dados: cada registro de domínio é vinculado a um `tenant_id`; nenhuma consulta pode atravessar tenants (garantido em nível de aplicação e reforçado em nível de banco — ver SPEC, seção de Multi-tenancy).

### 4.2 Papéis de Alto Nível
| Papel | Escopo |
|---|---|
| Super Admin (Anthropic da plataforma / equipe Move AI) | Gestão de todos os tenants, billing da plataforma, feature flags, monitoramento global |
| Admin do Tenant | Gestão completa da imobiliária: usuários, configurações, planos, integrações |
| Gestor/Gerente | Gestão operacional (imóveis, contratos, financeiro) dentro do tenant |
| Corretor | Acesso a leads, imóveis, agenda, comissões via Portal do Corretor |
| Financeiro | Acesso ao módulo financeiro e de cobrança |
| Proprietário (externo) | Acesso via Portal do Proprietário |
| Cliente/Inquilino (externo) | Acesso via Portal do Cliente |
| Agente de IA (ator não humano) | Atua em nome do tenant dentro de permissões configuradas |

### 4.3 Modelo de Monetização (referência para PRD de Billing)
- Assinatura mensal por tenant, com planos por faixa de imóveis geridos e/ou número de agentes de IA ativos.
- Cobrança via Asaas (mercado nacional) e/ou Stripe (cartões internacionais/backup).
- Possibilidade de add-ons: canais adicionais de IA (Instagram, e-mail), volume de mensagens de IA, armazenamento documental extra.

---

## 5. Personas

1. **Marina — Dona/Gestora de imobiliária de médio porte (10-30 corretores).** Precisa reduzir custo operacional e não perder leads fora do horário comercial.
2. **Carlos — Corretor autônomo vinculado à imobiliária.** Precisa de agilidade para captar, qualificar e fechar negócios; usa o celular como ferramenta principal.
3. **Renata — Analista financeiro/administrativa.** Responsável por conciliação de aluguéis, boletos, repasses a proprietários e inadimplência.
4. **João — Proprietário de imóveis locados pela imobiliária.** Quer transparência sobre repasses, vistorias e status do imóvel sem precisar ligar.
5. **Ana — Cliente/Inquilina.** Busca imóvel, quer respostas rápidas a qualquer hora, prefere WhatsApp.
6. **Equipe Move AI (Super Admin).** Opera a plataforma, monitora saúde dos tenants, gerencia planos e suporte.

---

## 6. Escopo do Produto

### 6.1 Dentro do escopo (macro)
- Sistema de gestão imobiliária multi-tenant completo (todos os módulos descritos na seção 7).
- Camada de agentes de IA (AaaS) integrada ao core.
- Portais externos (proprietário, cliente, corretor).
- Landing pages personalizadas por tenant.
- Painel Super Admin da plataforma.
- Integrações de pagamento, autenticação, infraestrutura, comunicação e geração documental listadas na seção 9.
- Aplicativo mobile (fase posterior, arquitetura já preparada desde o início).

### 6.2 Fora do escopo (nesta fase)
- Marketplace público de imóveis entre tenants (portal único agregando todas as imobiliárias) — pode ser avaliado futuramente.
- Módulo de crédito imobiliário/financiamento bancário direto.
- Internacionalização para outros países (moeda/documentação além do padrão brasileiro) — arquitetura deve permitir, mas não é entregue nesta fase.

---

## 7. Funcionalidades por Módulo (Épicos)

> Cada item abaixo é um **Épico** que originará um PRD específico. Aqui descrevemos objetivo, principais capacidades e critérios de sucesso em alto nível.

### 7.1 Módulo de Imóveis (Cadastro e Gestão de Imóveis)
**Objetivo:** ser a fonte única de verdade sobre o inventário de imóveis do tenant.
- Cadastro completo por tipo: venda, locação, temporada, comercial, rural, terrenos, empreendimentos (unidades vinculadas a um empreendimento-pai).
- Campos: endereço geocodificado, características (área, quartos, vagas, etc.), valores (venda/locação/condomínio/IPTU), mídia (fotos, vídeos, tour 360°/planta), status (disponível, reservado, alugado, vendido, inativo), proprietário(s) vinculado(s).
- Histórico de alterações de preço e status.
- Vínculo com contratos, visitas e vistorias.
- Geração automática de descrição/anúncio via IA (integração com módulo de agentes).
- Busca e filtros avançados (para uso interno, portal do cliente e agentes).

### 7.2 Cadastro de Proprietários
- Dados pessoais/jurídicos, dados bancários para repasse, documentos.
- Vínculo com um ou mais imóveis.
- Histórico de repasses, contratos e comunicações.
- Consentimento LGPD e preferências de contato.

### 7.3 Cadastro de Clientes
- Unifica lead → cliente → inquilino/comprador (jornada completa).
- Perfil de busca (preferências de imóvel) — insumo direto para recomendação por IA.
- Histórico de interações (humanas e via agente de IA), documentos, propostas.

### 7.4 Gestão de Corretores
- Cadastro, hierarquia (equipes/gerentes), metas, regras de comissionamento.
- Vínculo de leads e imóveis captados.
- Ranking/performance.

### 7.5 Gestão de Funcionários (RH básico)
- Cadastro de colaboradores internos, cargos, permissões (RBAC), status de acesso.
- Não é um módulo de folha de pagamento completo nesta fase — foco em identidade e permissões operacionais.

### 7.6 Agenda (Visitas, Vistorias e Reuniões)
- Agendamento por corretor/equipe, com bloqueio de conflitos.
- Tipos: visita a imóvel, vistoria de entrada/saída, reunião com proprietário/cliente.
- Confirmação e lembretes automatizados (via agente de IA/canal de comunicação).
- Integração com calendário externo (Google Calendar — avaliar em fase de integrações).

### 7.7 CRM Imobiliário
- Funil de vendas/locação (Kanban configurável por tenant).
- Gestão de leads: origem, atribuição automática/manual a corretor, SLA de resposta.
- Automação de follow-up.
- Integração nativa com o módulo de Agentes de IA para qualificação automática.

### 7.8 Gestão de Contratos
- Contratos de locação, venda, intermediação, prestação de serviço.
- Templates configuráveis por tenant, geração de PDF (via Gotenberg), assinatura eletrônica (avaliar integração futura).
- Cláusulas dinâmicas (reajuste, garantia — fiador, caução, seguro-fiança, título de capitalização).
- Ciclo de vida: rascunho → em assinatura → vigente → renovação/encerramento.

### 7.9 Gestão Financeira Completa
- Contas a receber/pagar do tenant.
- Emissão de boletos/cobranças (via Asaas).
- Repasse a proprietários (cálculo automático de taxa de administração).
- Conciliação bancária, fluxo de caixa, relatórios financeiros e fiscais básicos.
- Gestão de comissões de corretores.

### 7.10 Gestão de Aluguel (Locação)
- Controle do ciclo de locação: cobrança mensal, reajuste (IGP-M/IPCA), renovação, rescisão.
- Gestão de inadimplência e régua de cobrança automatizada.
- Vistorias de entrada/saída vinculadas ao contrato.

### 7.11 Gestão de Manutenção
- Abertura de chamados de manutenção (pelo inquilino via portal/agente, ou internamente).
- Fluxo de aprovação (proprietário) e execução (prestador de serviço).
- Histórico de manutenções por imóvel.

### 7.12 Gestão Documental
- Repositório central de documentos por entidade (imóvel, proprietário, cliente, contrato).
- Versionamento, controle de expiração (ex.: documentos com validade), OCR e extração de dados via IA.
- Política de retenção e acesso alinhada à LGPD.

### 7.13 Portal do Proprietário
- Visão de imóveis, repasses, contratos, vistorias, chamados de manutenção, documentos.

### 7.14 Portal do Cliente
- Busca de imóveis, favoritos, propostas, status de contrato/pagamento, abertura de chamados (se inquilino).

### 7.15 Portal do Corretor
- Leads atribuídos, agenda, imóveis, comissões, metas.

### 7.16 Publicação Automática em Portais Imobiliários
- Integração de exportação (feed XML/API) para portais como Viva Real, ZAP Imóveis, OLX, Imovelweb, e site próprio do tenant.
- Sincronização de status (pausar/remover automaticamente ao alugar/vender).

### 7.17 Landing Page Personalizada por Tenant
- Site público (subdomínio `tenant.moveai.com.br` ou domínio próprio) com identidade visual do tenant, catálogo de imóveis, formulário de contato/lead, chat com agente de IA embutido.
- Editor de conteúdo básico (branding, seções, textos institucionais).

### 7.18 Sistema Super Admin
- Gestão de tenants (criação, suspensão, planos, billing da plataforma).
- Monitoramento de uso e saúde por tenant (imóveis cadastrados, agentes ativos, volume de mensagens de IA).
- Feature flags por tenant/plano.
- Suporte e auditoria global.

---

## 8. Camada de Agentes de Inteligência Artificial (AaaS)

> Esta é a camada diferencial do produto. Cada capacidade abaixo é candidata a um agente ou skill dentro da orquestração via LangGraph, e depende integralmente dos dados estruturados pelos módulos da seção 7.

### 8.1 Atendimento Multicanal
- Canais: WhatsApp (principal), Instagram Direct, Chat da landing page, E-mail.
- Agente unificado de atendimento com contexto compartilhado entre canais por cliente (mesma pessoa, histórico único).
- Escalonamento para atendimento humano (corretor) quando necessário, com handoff de contexto completo.

### 8.2 Captação e Qualificação de Leads
- Agente conduz triagem inicial (orçamento, região, tipo de imóvel, urgência) e registra lead qualificado no CRM.
- Roteamento automático para corretor conforme regras do tenant.

### 8.3 Recomendação Inteligente de Imóveis
- Cruzamento entre perfil de busca do cliente e inventário disponível (módulo 7.1 + 7.3).
- Aprendizado incremental a partir de interações (visualizações, favoritos, propostas).

### 8.4 Geração Automática de Descrições e Anúncios
- A partir dos dados estruturados do imóvel, gera textos otimizados para portais e redes sociais, respeitando tom de voz configurável por tenant.

### 8.5 OCR e Análise Documental
- Extração automática de dados de documentos (RG, CPF, comprovante de renda, contratos) para pré-preenchimento de cadastros e análise de risco básica (ex.: análise cadastral de locação).

### 8.6 Assistente Interno (Copiloto da Equipe)
- Agente voltado à equipe interna: busca rápida de informações ("qual o status do contrato X?", "quais imóveis vagos na região Y?"), geração de relatórios sob demanda, apoio à redação de comunicações.

### 8.7 Relatórios Inteligentes
- Geração de relatórios em linguagem natural a partir dos dados financeiros/operacionais (ex.: "resumo da inadimplência do mês", "performance de captação por corretor").

### 8.8 Perfil Inteligente do Cliente
- Consolidação contínua de um perfil enriquecido por IA (preferências, sensibilidade a preço, propensão à conversão) usado por todos os agentes acima.

---

## 9. Integrações Externas (visão de produto)

| Integração | Finalidade |
|---|---|
| Asaas | Cobrança nacional (boletos, PIX, cartão), split de repasse a proprietários |
| Stripe | Cobrança internacional/cartão, billing da própria plataforma (assinatura dos tenants) |
| Clerk | Autenticação e gestão de identidade (usuários internos e portais externos) |
| Cloudflare API | Gestão de domínios/subdomínios por tenant, DNS, segurança de borda (WAF, CDN) |
| AtlasCloud | Infraestrutura/hospedagem (a detalhar em SPEC) |
| Resend | Envio de e-mails transacionais (notificações, confirmações, relatórios) |
| Gotenberg | Geração de PDFs (contratos, recibos, relatórios) |

---

## 10. Requisitos Não Funcionais (visão de produto)

- **Segurança:** criptografia de dados sensíveis em repouso e trânsito, RBAC granular, MFA para usuários internos, rate limiting, proteção contra ataques do OWASP Top 10, conformidade com LGPD, honeypot em formulários públicos.
- **Isolamento multi-tenant:** nenhum dado de um tenant deve ser acessível por outro, em nenhuma camada.
- **Disponibilidade:** sistema crítico de atendimento (agentes) deve ter alta disponibilidade, já que atua fora do horário comercial.
- **Observabilidade:** logs estruturados, health checks, tracing distribuído, auditoria de ações sensíveis, dashboards e alertas.
- **Escalabilidade:** crescimento horizontal por tenant e por volume de mensagens de IA sem degradação perceptível.
- **Auditabilidade:** toda ação de agente de IA deve ser rastreável (o que foi decidido, com base em quê, e resultado).

---

## 11. Métricas de Sucesso (KPIs de Produto)

| Métrica | Descrição |
|---|---|
| Tenants ativos | Número de imobiliárias pagantes ativas |
| Taxa de ativação | % de tenants que completam onboarding e cadastram ≥1 imóvel em 7 dias |
| Tempo médio de primeira resposta a lead | Antes x depois da ativação dos agentes |
| Taxa de qualificação automática de leads | % de leads qualificados sem intervenção humana |
| Taxa de conversão lead → visita → contrato | Funil completo, por tenant |
| Churn de tenants | Cancelamentos mensais |
| NPS dos usuários internos (corretores/gestores) | Satisfação com a plataforma |
| Uptime da camada de agentes | SLA de disponibilidade dos canais de atendimento |

---

## 12. Roadmap de Alto Nível (Fases)

1. **Fase 0 — Fundação:** arquitetura multi-tenant, autenticação (Clerk), Super Admin básico, monorepo, CI/CD, observabilidade base.
2. **Fase 1 — Core de Gestão:** Imóveis, Proprietários, Clientes, Corretores, Funcionários, Agenda, Contratos, Documental.
3. **Fase 2 — Operação e Financeiro:** CRM, Financeiro, Aluguel, Manutenção, Portais (Proprietário/Cliente/Corretor).
4. **Fase 3 — Presença Digital:** Landing Pages por tenant, Publicação automática em portais imobiliários.
5. **Fase 4 — AaaS (Agentes de IA):** atendimento multicanal, qualificação de leads, recomendação, geração de anúncios, OCR, assistente interno, relatórios inteligentes, perfil inteligente do cliente.
6. **Fase 5 — Mobile e Expansão:** app mobile, novos canais, novas integrações, evoluções do modelo de billing.

> Cada fase será detalhada em PRDs específicos por módulo, seguindo a estrutura desta seção 7 e 8.

---

## 13. Riscos e Premissas

**Premissas**
- O tenant já opera (ou pretende operar) com processos digitalizáveis; não haverá suporte a fluxos 100% manuais fora do sistema.
- A qualidade dos agentes de IA depende da completude do cadastro; o produto deve incentivar/forçar boas práticas de preenchimento.

**Riscos**
- Complexidade de integração com múltiplos portais imobiliários externos (formatos de feed variados).
- Dependência de terceiros críticos (Asaas, Stripe, Clerk, Cloudflare, AtlasCloud) para operação contínua.
- Requisitos regulatórios (LGPD, normas do mercado imobiliário/CRECI) podem impactar fluxos de contrato e dados.
- Escalabilidade da camada de IA (custo e latência) conforme volume de mensagens cresce.

---

## 14. Glossário

- **Tenant:** instância isolada de uma imobiliária dentro da plataforma.
- **AaaS:** Agent as a Service — agentes de IA oferecidos como serviço sobre a base operacional.
- **RBAC:** Role-Based Access Control.
- **LGPD:** Lei Geral de Proteção de Dados (Brasil).
- **Repasse:** valor transferido ao proprietário após dedução da taxa de administração.
- **Feed de portal:** arquivo/API usado para publicar imóveis em portais externos (Viva Real, ZAP, OLX etc.).

---

## 15. Próximos Passos

1. Validar este PRD guarda-chuva com stakeholders.
2. Detalhar PRD individual de cada módulo listado nas seções 7 e 8, seguindo template padrão (objetivo, personas, user stories, critérios de aceite, métricas, fora de escopo).
3. Priorizar backlog conforme roadmap da seção 12.
4. Consolidar o SPEC técnico correspondente (documento irmão deste PRD).
