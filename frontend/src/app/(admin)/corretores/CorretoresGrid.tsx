"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "../../../components/Icon";
import { Modal } from "../../../components/Modal";
import type { Broker } from "../../../lib/api";
import { BrokerManager } from "./BrokerManager";

/**
 * Grid de Corretores (mesmo padrão de /financeiro): "Cadastro de Corretores"
 * abre um popup (Modal) com o gerenciador (lista + cadastro/edição + remoção);
 * "Estatísticas" navega para o ranking/indicadores em /corretores/estatisticas.
 */
export function CorretoresGrid({
  brokers,
  live,
  notice,
}: {
  brokers: Broker[];
  live: boolean;
  /** Diagnóstico da falha de carga, repassado aos gerenciadores. */
  notice?: string | null;
}) {
  const [cadastroOpen, setCadastroOpen] = useState(false);

  return (
    <>
      <div className="grid grid-3">
        <button
          type="button"
          className="lookup-card reveal"
          onClick={() => setCadastroOpen(true)}
        >
          <span className="stat-icon blue">
            <Icon name="broker" />
          </span>
          <div className="stack" style={{ gap: 4 }}>
            <span className="lookup-card-title">Cadastro de Corretores</span>
            <span className="subtle text-sm">Corretores parceiros: contato, documentos e comissão.</span>
          </div>
          <div className="lookup-card-foot">
            <span className="badge badge-slate">
              {brokers.length} {brokers.length === 1 ? "corretor" : "corretores"}
            </span>
            <span className="row gap-8 text-sm strong">
              Gerenciar <Icon name="arrowRight" size={15} />
            </span>
          </div>
        </button>

        <Link href="/corretores/estatisticas" className="lookup-card reveal">
          <span className="stat-icon accent">
            <Icon name="trendingUp" />
          </span>
          <div className="stack" style={{ gap: 4 }}>
            <span className="lookup-card-title">Estatísticas</span>
            <span className="subtle text-sm">Ranking de comissão, negócios fechados e conversão.</span>
          </div>
          <div className="lookup-card-foot">
            <span className="badge badge-slate">Dashboard</span>
            <span className="row gap-8 text-sm strong">
              Abrir <Icon name="arrowRight" size={15} />
            </span>
          </div>
        </Link>
      </div>

      <Modal
        open={cadastroOpen}
        onClose={() => setCadastroOpen(false)}
        title="Cadastro de Corretores"
        icon="broker"
        maxWidth={900}
      >
        <BrokerManager brokers={brokers} live={live} notice={notice} />
      </Modal>
    </>
  );
}
