"use client";

import { useState } from "react";
import { Icon } from "../../../../components/Icon";
import { PeriodDialog } from "./PeriodDialog";

/**
 * Grid dos relatórios do financeiro: um card por documento, e todos abrem o
 * MESMO popup de período — o que muda é o título e para onde o "Gerar" aponta.
 *
 * Cada card abre um popup em vez de navegar: o relatório não tem tela, ele é um
 * PDF. Uma subpágina só para hospedar dois campos de data faria o usuário sair e
 * voltar quatro vezes para emitir os quatro documentos do fechamento.
 */

interface ReportCard {
  /** Casa com a chave de `FINANCE_REPORTS` em `lib/api.ts`. */
  kind: string;
  title: string;
  description: string;
  icon: string;
  tone: string;
  /** O que o rodapé do card promete — o recorte que o período aplica. */
  hint: string;
}

const REPORTS: ReportCard[] = [
  {
    kind: "movimento-do-caixa",
    title: "Movimento do Caixa",
    description:
      "Extrato do período: tudo que entrou e saiu da conta, com saldo acumulado.",
    icon: "wallet",
    tone: "blue",
    hint: "Por data do movimento",
  },
  {
    kind: "resultados",
    title: "Resultados",
    description:
      "Receitas e despesas próprias da imobiliária por natureza, com margem e evolução.",
    icon: "trendingUp",
    tone: "success",
    hint: "Por data do movimento",
  },
  {
    kind: "receitas",
    title: "Receitas",
    description:
      "Cobranças do período por natureza: previsto, recebido, em aberto e vencido.",
    icon: "banknote",
    tone: "accent",
    hint: "Por vencimento",
  },
  {
    kind: "contas-a-pagar",
    title: "Contas a Pagar",
    description:
      "Agenda de pagamentos por favorecido: o que vence, o que já saiu e o que atrasou.",
    icon: "receipt",
    tone: "warning",
    hint: "Por vencimento",
  },
];

export function ReportsGrid() {
  const [open, setOpen] = useState<ReportCard | null>(null);

  return (
    <>
      <div className="grid grid-3">
        {REPORTS.map((report) => (
          <button
            key={report.kind}
            type="button"
            className="lookup-card reveal"
            onClick={() => setOpen(report)}
          >
            <span className={`stat-icon ${report.tone}`}>
              <Icon name={report.icon} />
            </span>
            <div className="stack" style={{ gap: 4 }}>
              <span className="lookup-card-title">{report.title}</span>
              <span className="subtle text-sm">{report.description}</span>
            </div>
            <div className="lookup-card-foot">
              <span className="badge badge-slate">{report.hint}</span>
              <span className="row gap-8 text-sm strong">
                Emitir <Icon name="arrowRight" size={15} />
              </span>
            </div>
          </button>
        ))}
      </div>

      {open && (
        <PeriodDialog
          kind={open.kind}
          title={open.title}
          onClose={() => setOpen(null)}
        />
      )}
    </>
  );
}
