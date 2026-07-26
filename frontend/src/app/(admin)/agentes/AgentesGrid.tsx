"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "../../../components/Icon";
import { Modal } from "../../../components/Modal";
import type { AiCredits } from "../../../lib/api";
import { CreditsPanel } from "./CreditsPanel";

/**
 * Grid de /agentes. "Copiloto" e "Conversas" são cards de navegação; "Créditos
 * de IA" abre um popup — é consulta rápida, não merece uma tela.
 *
 * Só importa TIPO de lib/api (`import type`): o módulo é server-only (o
 * `auth()` do Clerk vive lá) e importar um valor dele quebraria o build do
 * client component.
 */
export function AgentesGrid({
  credits,
  conversationCount,
}: {
  credits: AiCredits | null;
  conversationCount: number | null;
}) {
  const [creditsOpen, setCreditsOpen] = useState(false);

  const format = (n: number) => n.toLocaleString("pt-BR");

  return (
    <>
      <div className="grid grid-3">
        <Link href="/agentes/copiloto" className="lookup-card reveal">
          <span className="stat-icon accent">
            <Icon name="sparkles" />
          </span>
          <div className="stack" style={{ gap: 4 }}>
            <span className="lookup-card-title">Copiloto</span>
            <span className="subtle text-sm">
              Pergunte sobre o inventário e o cadastro em linguagem natural.
            </span>
          </div>
          <div className="lookup-card-foot">
            <span className="badge badge-slate">Assistente</span>
            <span className="row gap-8 text-sm strong">
              Abrir <Icon name="arrowRight" size={15} />
            </span>
          </div>
        </Link>

        <Link href="/agentes/conversas" className="lookup-card reveal">
          <span className="stat-icon blue">
            <Icon name="messageCircle" />
          </span>
          <div className="stack" style={{ gap: 4 }}>
            <span className="lookup-card-title">Conversas</span>
            <span className="subtle text-sm">
              Histórico das perguntas e das consultas que o agente executou.
            </span>
          </div>
          <div className="lookup-card-foot">
            <span className="badge badge-slate">
              {conversationCount === null
                ? "Histórico"
                : `${conversationCount} ${conversationCount === 1 ? "conversa" : "conversas"}`}
            </span>
            <span className="row gap-8 text-sm strong">
              Abrir <Icon name="arrowRight" size={15} />
            </span>
          </div>
        </Link>

        <button
          type="button"
          className="lookup-card reveal"
          onClick={() => setCreditsOpen(true)}
        >
          <span className="stat-icon success">
            <Icon name="wallet" />
          </span>
          <div className="stack" style={{ gap: 4 }}>
            <span className="lookup-card-title">Créditos de IA</span>
            <span className="subtle text-sm">
              Saldo disponível e consumo do assistente.
            </span>
          </div>
          <div className="lookup-card-foot">
            <span className="badge badge-slate">
              {credits ? `${format(credits.available)} disponíveis` : "Saldo"}
            </span>
            <span className="row gap-8 text-sm strong">
              Ver <Icon name="arrowRight" size={15} />
            </span>
          </div>
        </button>
      </div>

      <Modal
        open={creditsOpen}
        onClose={() => setCreditsOpen(false)}
        title="Créditos de IA"
        icon="wallet"
      >
        <CreditsPanel credits={credits} />
      </Modal>
    </>
  );
}
