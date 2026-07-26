"use client";

import { Icon } from "../../../components/Icon";
import type { AiCredits } from "../../../lib/api";

/**
 * Painel de créditos de IA (conteúdo do popup em /agentes).
 *
 * A leitura que interessa a quem abre isso é uma só: "quanto ainda dá para
 * usar?". Por isso o disponível vem grande e sozinho no topo, e o resto
 * (saldo, reservado, consumido) fica embaixo como apoio — os quatro números
 * lado a lado, com o mesmo peso, obrigavam a pessoa a fazer a conta na cabeça.
 *
 * A barra mede o CONSUMO sobre o pacote (`used / (used + balance)`), não o
 * disponível sobre o saldo: com nada reservado, "disponível sobre saldo" é
 * sempre 100% e não informa nada. Assim ela se move conforme o uso e antecipa
 * a recarga.
 */
export function CreditsPanel({ credits }: { credits: AiCredits | null }) {
  if (!credits) {
    return (
      <div className="credits-panel">
        <p className="subtle text-sm">
          Não foi possível consultar o saldo agora. Verifique se o seu perfil tem acesso ao
          assistente.
        </p>
      </div>
    );
  }

  const format = (n: number) => n.toLocaleString("pt-BR");

  // Total do pacote = o que sobrou + o que já foi gasto.
  const total = credits.balance + credits.used;
  const consumedPct = total > 0 ? Math.round((credits.used / total) * 100) : 0;

  // O alerta acompanha o que RESTA, não o que foi gasto: é o que muda a decisão
  // de recarregar. Abaixo de 15% a barra fica vermelha, abaixo de 40% âmbar.
  const remainingPct = 100 - consumedPct;
  const tone = remainingPct <= 15 ? "danger" : remainingPct <= 40 ? "warning" : "ok";

  return (
    <div className="credits-panel">
      <div className="credits-hero">
        <span className="credits-hero-label">Disponível agora</span>
        <span className="credits-hero-value">{format(credits.available)}</span>
        <span className="credits-hero-unit">
          {credits.available === 1 ? "crédito" : "créditos"}
        </span>
      </div>

      <div className={`credits-meter credits-meter-${tone}`}>
        <div className="bar">
          <span style={{ width: `${Math.min(consumedPct, 100)}%` }} />
        </div>
        <div className="credits-meter-foot">
          <span>{consumedPct}% do pacote consumido</span>
          <span>{format(total)} no total</span>
        </div>
      </div>

      {tone !== "ok" ? (
        <p className={`credits-alert credits-alert-${tone}`}>
          {/* O set de ícones do projeto não tem "warning"; `bell` é o mais
              próximo em semântica de alerta e já é usado no topbar. */}
          <Icon name="bell" size={15} />
          {tone === "danger"
            ? "Saldo baixo — o assistente para de responder quando os créditos acabam."
            : "O saldo está entrando na reserva. Vale programar a recarga."}
        </p>
      ) : null}

      <div className="credits-tiles">
        <div className="credits-tile">
          <span className="credits-tile-label">Saldo</span>
          <span className="credits-tile-value">{format(credits.balance)}</span>
          <span className="credits-tile-hint">já descontado o consumo</span>
        </div>
        <div className="credits-tile">
          <span className="credits-tile-label">Reservado</span>
          <span className="credits-tile-value">{format(credits.reserved)}</span>
          <span className="credits-tile-hint">
            {credits.reserved > 0 ? "perguntas em andamento" : "nada em andamento"}
          </span>
        </div>
        <div className="credits-tile">
          <span className="credits-tile-label">Consumido</span>
          <span className="credits-tile-value">{format(credits.used)}</span>
          <span className="credits-tile-hint">desde o início</span>
        </div>
      </div>

      <p className="credits-note text-xs subtle">
        Um crédito equivale a mil tokens processados, somando pergunta e resposta. Na
        prática, uma consulta ao inventário costuma custar de 4 a 8 créditos — perguntas
        que exigem várias buscas custam mais. O valor reservado é devolvido quando a
        resposta falha.
      </p>
    </div>
  );
}
