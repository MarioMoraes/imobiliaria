"use client";

import { useState } from "react";
import Link from "next/link";
import { Icon } from "../../../components/Icon";
import { Modal } from "../../../components/Modal";
import type { Bank } from "../../../lib/api";
import { BankManager } from "./BankManager";

/**
 * Grid do Financeiro: um card por área. "Bancos" abre um popup (Modal) com o
 * gerenciador de contas bancárias (lista + cadastro/edição + remoção); "Gestão
 * Financeira" e "Pagamento de Proprietários" são cards de navegação para as
 * subpáginas. Mesmo padrão de cards de /tabelas.
 */
export function FinanceiroGrid({
  banks,
  live,
  notice,
  pendingPayouts,
}: {
  banks: Bank[];
  live: boolean;
  /** Diagnóstico da falha de carga, repassado aos gerenciadores. */
  notice?: string | null;
  /** Repasses em aberto — o badge do card de proprietários. */
  pendingPayouts: number;
}) {
  const [banksOpen, setBanksOpen] = useState(false);

  return (
    <>
      <div className="grid grid-3">
        <button
          type="button"
          className="lookup-card reveal"
          onClick={() => setBanksOpen(true)}
        >
          <span className="stat-icon blue">
            <Icon name="banknote" />
          </span>
          <div className="stack" style={{ gap: 4 }}>
            <span className="lookup-card-title">Bancos</span>
            <span className="subtle text-sm">Contas bancárias da imobiliária (código, agência, conta).</span>
          </div>
          <div className="lookup-card-foot">
            <span className="badge badge-slate">
              {banks.length} {banks.length === 1 ? "conta" : "contas"}
            </span>
            <span className="row gap-8 text-sm strong">
              Gerenciar <Icon name="arrowRight" size={15} />
            </span>
          </div>
        </button>

        <Link href="/financeiro/proprietarios" className="lookup-card reveal">
          <span className="stat-icon accent">
            <Icon name="banknote" />
          </span>
          <div className="stack" style={{ gap: 4 }}>
            <span className="lookup-card-title">Pagamento de Proprietários</span>
            <span className="subtle text-sm">
              Repasse do aluguel recebido, já com a taxa de administração deduzida.
            </span>
          </div>
          <div className="lookup-card-foot">
            <span className="badge badge-slate">
              {pendingPayouts} em aberto
            </span>
            <span className="row gap-8 text-sm strong">
              Abrir <Icon name="arrowRight" size={15} />
            </span>
          </div>
        </Link>

        {/* Gestão Financeira fica por último: é a visão consolidada, depois das
            áreas operacionais. */}
        <Link href="/financeiro/gestao" className="lookup-card reveal">
          <span className="stat-icon success">
            <Icon name="wallet" />
          </span>
          <div className="stack" style={{ gap: 4 }}>
            <span className="lookup-card-title">Gestão Financeira</span>
            <span className="subtle text-sm">Fluxo de caixa, contas a receber, DRE e repasses.</span>
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
        open={banksOpen}
        onClose={() => setBanksOpen(false)}
        title="Bancos"
        icon="banknote"
      >
        <BankManager banks={banks} live={live} notice={notice} />
      </Modal>
    </>
  );
}
