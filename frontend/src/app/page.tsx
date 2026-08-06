import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { BrandIcon } from "@/components/BrandIcon";
import { Icon } from "@/components/Icon";
import { CriarContaButton, EntrarButton } from "./LandingCta";
import "./landing.css";

export const metadata: Metadata = {
  title: "Offices AI Imobiliária — gestão imobiliária com agentes de IA",
  description:
    "Imóveis, contratos, aluguel, financeiro e condomínios em um só lugar, com agentes de IA que atendem, qualificam leads e escrevem por você.",
};

/**
 * Rota "/" — landing pública: a primeira tela de quem ainda não está logado.
 * Quem já tem sessão do Clerk cai direto no painel. Login e cadastro moram no
 * Clerk (/sign-in e /sign-up); aqui só apontamos para lá.
 *
 * Convites emitidos antes de /aceitar-convite existir apontam para cá: se vier
 * um `__clerk_ticket`, encaminha para a página que sabe trocá-lo (antes do
 * redirect de sessão — um admin logado pode abrir o convite de outra pessoa).
 */
export default async function LandingPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = new URLSearchParams(
    Object.entries(await searchParams).flatMap(([k, v]) =>
      v === undefined ? [] : [[k, Array.isArray(v) ? (v[0] ?? "") : v] as [string, string]],
    ),
  );
  if (params.has("__clerk_ticket")) redirect(`/aceitar-convite?${params.toString()}`);

  const { userId } = await auth();
  if (userId) redirect("/dashboard");

  return (
    <div className="lp">
      <Nav />
      <Hero />
      <Modulos />
      <ComoFunciona />
      <Inteligencia />
      <Seguranca />
      <CtaFinal />
      <Rodape />
    </div>
  );
}

/* ------------------------------------------------------------------- Nav */

function Nav() {
  return (
    <header className="lp-nav">
      <div className="lp-wrap lp-nav-inner">
        <span className="lp-brand">
          <span className="lp-brand-mark">
            <Icon name="building" size={18} />
          </span>
          Offices AI Imobiliária
        </span>

        <nav className="lp-nav-links">
          <a href="#modulos">Módulos</a>
          <a href="#como-funciona">Como Funciona</a>
          <a href="#ia">Agentes de IA</a>
          <a href="#seguranca">Segurança</a>
        </nav>

        <div className="lp-nav-actions">
          <EntrarButton className="btn btn-outline btn-sm">Entrar</EntrarButton>
          <CriarContaButton className="btn btn-primary btn-sm">
            Criar conta
          </CriarContaButton>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ Hero */

function Hero() {
  return (
    <section className="lp-hero">
      <div className="lp-wrap lp-hero-inner">
        <div>
          <p className="lp-pill">
            <span>
              <Icon name="sparkles" size={12} /> SaaS
            </span>
            Software como Serviço para Imobiliárias
          </p>

          {/*
            Só a palavra "Imobiliária" leva o destaque do gradiente da marca; o
            resto da frase fica neutro (com dois destaques a linha perde o ponto
            focal). A inicial maiúscula é intencional — trata a palavra como o
            nome do público, sem gritar em caixa alta.
          */}
          <h1 className="lp-h1">
            A plataforma que administra a sua <em>Imobiliária</em> de ponta a
            ponta
          </h1>

          <p className="lp-lead">
            Imóveis, pessoas, contratos, cobrança, condomínios e financeiro em um
            sistema só, feito para o dia a dia da imobiliária. O contrato
            assinado já muda o imóvel de status, gera as parcelas e alimenta o
            financeiro — você lança uma vez e o resto acontece.
          </p>

          <div className="lp-cta">
            <CriarContaButton className="btn btn-primary">
              Começar agora
              <Icon name="arrowRight" size={16} />
            </CriarContaButton>
            <EntrarButton className="btn btn-outline">Já tenho conta</EntrarButton>
          </div>

          <p className="lp-note">
            Login seguro com e-mail, senha ou Google — autenticação gerenciada
            pelo Clerk.
          </p>

          <div className="lp-proof">
            <div>
              <strong>20+</strong>
              <span>recursos disponíveis hoje</span>
            </div>
            <div>
              <strong>24/7</strong>
              <span>copiloto de IA à disposição</span>
            </div>
            <div>
              <strong>Multi-tenant</strong>
              <span>isolamento aplicado no banco</span>
            </div>
          </div>
        </div>

        <MockPainel />
      </div>
    </section>
  );
}

/** Arte do hero: um recorte estilizado do painel. Puramente decorativo. */
function MockPainel() {
  const barras = [42, 58, 36, 72, 54, 88, 66, 94];
  return (
    <div className="lp-mock" aria-hidden="true">
      <div className="lp-mock-bar">
        <i />
        <i />
        <i />
        <b>Painel · Visão geral</b>
      </div>
      <div className="lp-mock-body">
        <div className="lp-mock-kpis">
          <div className="lp-mock-kpi">
            <span>Imóveis ativos</span>
            <strong>248</strong>
          </div>
          <div className="lp-mock-kpi">
            <span>Contratos vigentes</span>
            <strong>163</strong>
          </div>
          <div className="lp-mock-kpi">
            <span>A receber no mês</span>
            <strong>R$ 412 mil</strong>
          </div>
        </div>

        <div className="lp-mock-chart">
          <span className="text-xs subtle">Recebimentos por mês</span>
          <div className="lp-mock-bars">
            {barras.map((h, i) => (
              <i key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
        </div>

        <div className="lp-mock-row">
          <span className="stat-icon accent">
            <Icon name="bot" size={16} />
          </span>
          <b>Copiloto respondeu sobre 3 imóveis</b>
          <em>agora</em>
        </div>
        <div className="lp-mock-row">
          <span className="stat-icon">
            <Icon name="contract" size={16} />
          </span>
          <b>Contrato #1042 assinado eletronicamente</b>
          <em>há 12 min</em>
        </div>
        <div className="lp-mock-row">
          <span className="stat-icon">
            <Icon name="receipt" size={16} />
          </span>
          <b>Repasse ao proprietário gerado</b>
          <em>há 1 h</em>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- Módulos */

const MODULOS: { icon: string; tone: string; titulo: string; texto: string }[] =
  [
    {
      icon: "building",
      tone: "tone-ciano",
      titulo: "Imóveis",
      texto:
        "Ficha completa de venda e locação, fotos, características, donos vinculados e status que muda sozinho quando o contrato entra em vigor.",
    },
    {
      icon: "users",
      tone: "tone-indigo",
      titulo: "Pessoas",
      texto:
        "Locadores, locatários, fiadores e compradores num cadastro único de pessoa, com papéis, endereço e documentos — sem duplicar ninguém.",
    },
    {
      icon: "contract",
      tone: "tone-azul",
      titulo: "Contratos",
      texto:
        "Modelos próprios, assinaturas, reajuste por índice e geração automática das parcelas de aluguel a cada competência.",
    },
    {
      icon: "key",
      tone: "tone-ambar",
      titulo: "Aluguel",
      texto:
        "Cobrança por boleto e PIX, controle de vencimentos, inadimplência e repasse ao proprietário após a compensação.",
    },
    {
      icon: "wallet",
      tone: "tone-esmeralda",
      titulo: "Financeiro",
      texto:
        "Bancos, contas a pagar e a receber, saldo e valores em trânsito. Cada lançamento amarrado ao contrato que o originou.",
    },
    {
      icon: "home",
      tone: "tone-teal",
      titulo: "Condomínios",
      texto:
        "Consulta de condôminos, despesas lançadas por competência e visão de quem responde por cada unidade.",
    },
    {
      icon: "broker",
      tone: "tone-rosa",
      titulo: "Corretores e equipe",
      texto:
        "Cadastro de corretores e funcionários, distribuição de leads e estatísticas de desempenho por profissional.",
    },
    {
      icon: "bot",
      tone: "tone-violeta",
      titulo: "Agentes de IA",
      texto:
        "Atendimento multicanal, recomendação de imóveis, descrições de anúncio e leitura de documentos — com handoff para humano quando precisa.",
    },
  ];

function Modulos() {
  return (
    <section className="lp-section" id="modulos">
      <div className="lp-wrap">
        <div className="lp-section-head">
          <span className="eyebrow">Módulos</span>
          <h2 className="lp-h2">Tudo que a imobiliária opera, no mesmo lugar</h2>
          <p className="lp-sub">
            Cada módulo conversa com o próximo: o contrato assinado muda o status
            do imóvel, gera as parcelas e alimenta o financeiro. Você lança uma
            vez — o sistema propaga.
          </p>
        </div>

        <div className="lp-grid">
          {MODULOS.map((m) => (
            <article key={m.titulo} className={`lp-feature ${m.tone}`}>
              <span className="stat-icon">
                <Icon name={m.icon} />
              </span>
              <h3>{m.titulo}</h3>
              <p>{m.texto}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------- Como funciona */

function ComoFunciona() {
  return (
    <section className="lp-section alt" id="como-funciona">
      <div className="lp-wrap">
        <div className="lp-section-head lp-center">
          <span className="eyebrow">Como funciona</span>
          <h2 className="lp-h2">
            Do Cadastro do Imóvel ao Repasse para o Proprietário
          </h2>
        </div>

        <div className="lp-steps">
          <div className="lp-step">
            <h3>Cadastre o essencial</h3>
            <p>
              Imóveis, proprietários e inquilinos. Endereço por CEP, máscaras e
              validação — o cadastro já sai limpo na primeira digitação.
            </p>
          </div>
          <div className="lp-step">
            <h3>Feche o contrato</h3>
            <p>
              Escolha o modelo, colete as assinaturas e o sistema marca o imóvel
              como alugado e cria as parcelas do período.
            </p>
          </div>
          <div className="lp-step">
            <h3>Cobre e repasse</h3>
            <p>
              Boleto e PIX emitidos sob demanda, baixa automática pelo webhook e
              repasse ao proprietário depois da compensação.
            </p>
          </div>
          <div className="lp-step">
            <h3>Deixe a IA assumir a rotina</h3>
            <p>
              Enquanto isso os agentes respondem interessados, qualificam leads e
              chamam um corretor quando a conversa esquenta.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* -------------------------------------------------------------------- IA */

function Inteligencia() {
  return (
    <section className="lp-section" id="ia">
      <div className="lp-wrap lp-ai">
        <div>
          <span className="eyebrow">Camada de IA</span>
          <h2 className="lp-h2">Agentes que trabalham no seu time</h2>
          <p className="lp-sub">
            Não é um chatbot de FAQ. Os agentes leem o seu estoque de imóveis, o
            histórico do cliente e as regras do contrato para agir com contexto.
          </p>

          <ul className="lp-list">
            <li>
              <Icon name="check" size={18} />
              <span>
                <b>Atendimento multicanal.</b> WhatsApp, site e portais no mesmo
                fluxo, 24 horas por dia.
              </span>
            </li>
            <li>
              <Icon name="check" size={18} />
              <span>
                <b>Qualificação de leads.</b> Perfil, orçamento e urgência
                capturados na conversa e distribuídos entre os corretores.
              </span>
            </li>
            <li>
              <Icon name="check" size={18} />
              <span>
                <b>Recomendação de imóveis.</b> Sugestões a partir do que o
                cliente disse — e do que ele já visitou.
              </span>
            </li>
            <li>
              <Icon name="check" size={18} />
              <span>
                <b>Anúncios e descrições.</b> Texto pronto para portal a partir
                da ficha do imóvel.
              </span>
            </li>
            <li>
              <Icon name="check" size={18} />
              <span>
                <b>Handoff para humano.</b> Sentimento negativo ou três
                tentativas sem resolver: um corretor entra na conversa.
              </span>
            </li>
          </ul>
        </div>

        <div className="lp-chat" aria-hidden="true">
          <div className="lp-chat-head">
            <span className="stat-icon accent" style={{ margin: 0 }}>
              <Icon name="bot" size={18} />
            </span>
            <b>Agente de atendimento</b>
            <span className="badge badge-green" style={{ marginLeft: "auto" }}>
              <i className="dot" /> online
            </span>
          </div>
          <div className="lp-bubble them">
            Oi! Vi o apartamento do Centro no portal, ainda está disponível?
          </div>
          <div className="lp-bubble us">
            Está sim! 2 quartos, 68 m², R$ 2.400 + condomínio. Prefere visitar
            amanhã de manhã ou à tarde?
          </div>
          <div className="lp-bubble them">De manhã, por volta das 10h.</div>
          <div className="lp-bubble us">
            Agendado para amanhã às 10h com a Paula. Já separei outros 2 imóveis
            no mesmo bairro na sua faixa de preço.
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- Segurança */

function Seguranca() {
  return (
    <section className="lp-section alt" id="seguranca">
      <div className="lp-wrap">
        <div className="lp-section-head lp-center">
          <span className="eyebrow">Confiança</span>
          <h2 className="lp-h2">Cada imobiliária no seu próprio cofre</h2>
          <p className="lp-sub">
            Multi-tenant de verdade: o isolamento é aplicado no banco de dados,
            não só na aplicação.
          </p>
        </div>

        <div className="lp-trust">
          <div>
            <span className="stat-icon">
              <Icon name="shield" />
            </span>
            <h3>Isolamento por tenant</h3>
            <p>
              Row-Level Security no Postgres: toda consulta é filtrada pela
              imobiliária da sessão, sem exceção.
            </p>
          </div>
          <div>
            <span className="stat-icon accent">
              <Icon name="refresh" />
            </span>
            <h3>Backup automático</h3>
            <p>
              Cópias diárias e criptografadas em outro servidor, retidas por
              tempo suficiente para voltar no dia certo. Nem incêndio na sede,
              nem computador roubado, nem exclusão por engano tiram a sua
              imobiliária do ar.
            </p>
          </div>
          <div>
            <span className="stat-icon">
              <Icon name="list" />
            </span>
            <h3>Auditoria</h3>
            <p>
              Registro de quem criou, alterou e excluiu cada dado — com exclusão
              lógica para não perder histórico.
            </p>
          </div>
          <div>
            <span className="stat-icon">
              <Icon name="database" />
            </span>
            <h3>Seus dados, sempre seus</h3>
            <p>
              Exportação dos cadastros e conformidade com a LGPD desde o desenho
              do produto.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- CTA final */

function CtaFinal() {
  return (
    <section className="lp-final">
      <div className="lp-wrap">
        <h2>Pronto para tirar a imobiliária da planilha?</h2>
        <p>
          Crie sua conta, cadastre a imobiliária e comece pelos imóveis. Leva
          menos tempo do que fechar uma visita.
        </p>
        <div className="lp-cta">
          <CriarContaButton className="btn lp-btn-light">
            Criar conta
            <Icon name="arrowRight" size={16} />
          </CriarContaButton>
          <EntrarButton className="btn btn-outline lp-btn-onDark">
            Entrar na plataforma
          </EntrarButton>
        </div>
      </div>
    </section>
  );
}

function Rodape() {
  return (
    <footer className="lp-foot">
      <div className="lp-wrap lp-foot-inner">
        <span className="lp-brand" style={{ fontSize: "0.92rem" }}>
          <span className="lp-brand-mark" style={{ width: 28, height: 28 }}>
            <Icon name="building" size={15} />
          </span>
          Offices AI Imobiliária
        </span>

        <div className="lp-foot-social">
          <a
            href="https://instagram.com/offices_aplicativos"
            target="_blank"
            rel="noopener noreferrer"
          >
            <BrandIcon name="instagram" size={16} />
            @offices_aplicativos
          </a>
          {/* wa.me exige o número em E.164 sem símbolos: 55 (BR) + 35 (DDD). */}
          <a
            href="https://wa.me/5535992527113"
            target="_blank"
            rel="noopener noreferrer"
          >
            <BrandIcon name="whatsapp" size={16} />
            (35) 99252-7113
          </a>
        </div>

        <span>
          © {new Date().getFullYear()} Offices AI · Plataforma de gestão
          imobiliária com agentes de IA
        </span>
      </div>
    </footer>
  );
}
