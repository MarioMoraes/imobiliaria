"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../../../components/Icon";
import { StatusBadge } from "../../../../../components/ui";
import { useToast } from "../../../../../components/Toast";
// Só o TIPO vem de lib/api (apagado na compilação). Importar um VALOR de lá
// puxaria o Clerk server para o bundle do client — ver lib/format.ts.
import type { Receivable } from "../../../../../lib/api";
import { formatPrice } from "../../../../../lib/format";
import { issueCondoBoletoAction, syncCondoChargeAction } from "./actions";

/** Conta em aberto com vencimento passado é exibida como vencida. */
function displayStatus(charge: Receivable, today: string): string {
  return charge.status === "ABERTO" && charge.dueDate < today ? "VENCIDO" : charge.status;
}

/**
 * Célula de cobrança de um condômino: a conta de condomínio mais recente da
 * unidade, com o botão de boleto.
 *
 * Mostra só a última porque a lista é de condôminos, não de cobranças — uma
 * linha por imóvel. Períodos anteriores continuam na Gestão Financeira, e a
 * contagem avisa quando existem.
 */
export function CondoChargeCell({
  condominiumId,
  charges,
  canIssue,
  today,
}: {
  condominiumId: string;
  /** Cobranças da unidade, da mais recente para a mais antiga. */
  charges: Receivable[];
  /** `finance:write` — sem isso a cobrança aparece, mas sem os botões. */
  canIssue: boolean;
  today: string;
}) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<"boleto" | "sync" | null>(null);
  const [charge, setCharge] = useState<Receivable | null>(charges[0] ?? null);

  if (!charge) {
    return <span className="subtle text-sm">—</span>;
  }

  const emitido = Boolean(charge.asaasChargeId);
  const bloqueada =
    charge.status === "CANCELADO" ||
    charge.status === "ESTORNADO" ||
    (charge.status === "PAGO" && !emitido);

  async function abrirBoleto() {
    if (!charge) return;

    // Cobrança já emitida: abre o PDF na hora, sem ida ao servidor.
    const jaTemPdf = charge.boletoUrl ?? charge.invoiceUrl;
    if (jaTemPdf) {
      window.open(jaTemPdf, "_blank", "noopener");
      return;
    }

    // Primeira emissão: a aba precisa ser aberta AGORA, no gesto do clique —
    // depois do `await` o navegador já não considera a chamada uma ação do
    // usuário e o bloqueador de pop-up a barra em silêncio. Abrimos vazia e
    // navegamos quando a cobrança responde.
    //
    // Sem `noopener` aqui de propósito: com essa feature o `window.open` devolve
    // `null` por especificação, e sem a referência da aba não há como navegá-la
    // depois — era o que fazia o boleto abrir na PRÓPRIA aba. O desacoplamento
    // é feito zerando o `opener` da aba nova.
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;

    setBusy("boleto");
    const res = await issueCondoBoletoAction(charge.id);
    setBusy(null);

    if (!res.ok || !res.url) {
      tab?.close();
      toast.error(res.error ?? "Não foi possível emitir o boleto.");
      return;
    }

    // Guarda os links na linha: o próximo clique abre direto, sem reemitir.
    setCharge({
      ...charge,
      asaasChargeId: res.asaasChargeId ?? charge.asaasChargeId,
      boletoUrl: res.boletoUrl ?? null,
      invoiceUrl: res.invoiceUrl ?? null,
    });

    const url = res.boletoUrl ?? res.url;
    if (tab) {
      tab.location.href = url;
      return;
    }
    // Pop-up bloqueado de verdade: a cobrança já foi emitida e o link ficou
    // salvo, então basta liberar o bloqueio e clicar de novo.
    toast.info("Libere os pop-ups deste site e clique novamente para abrir o boleto.");
  }

  /**
   * Pergunta ao Asaas se a cobrança já foi paga. Pago lá vira baixa aqui, e a
   * baixa entra no saldo do condomínio — que é derivado dos recebimentos.
   */
  async function sincronizar() {
    if (!charge) return;
    setBusy("sync");
    const res = await syncCondoChargeAction(condominiumId, charge.id);
    setBusy(null);

    if (!res.ok) {
      toast.error(res.error ?? "Não foi possível consultar a cobrança.");
      return;
    }
    // O Server Component relê a cobrança e o saldo. A resposta do sync não diz
    // o novo estado, então recarregar é o que mostra a baixa (ou a ausência dela).
    router.refresh();
    toast.info("Situação consultada no Asaas.");
  }

  return (
    <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
      <div className="stack" style={{ gap: 2, alignItems: "flex-end" }}>
        <span className="strong">{formatPrice(charge.amountCents)}</span>
        {/* Sem o vencimento aqui: ele tem coluna própria na tabela. */}
        <span className="subtle text-xs">
          {charge.competence ?? "—"}
          {charges.length > 1 ? ` · +${charges.length - 1} anterior(es)` : ""}
        </span>
      </div>
      <StatusBadge status={displayStatus(charge, today)} />
      {canIssue && (
        <>
          <button
            className="icon-btn"
            style={{ width: 30, height: 30 }}
            type="button"
            onClick={() => void abrirBoleto()}
            disabled={busy !== null || bloqueada}
            aria-label={`${emitido ? "Abrir" : "Emitir"} boleto do condomínio · competência ${charge.competence ?? ""}`}
            title={
              bloqueada
                ? "Cobrança cancelada ou quitada não gera boleto."
                : emitido
                  ? "Abrir o PDF do boleto para impressão"
                  : "Emitir a cobrança no Asaas e abrir o boleto para impressão"
            }
          >
            <Icon
              name={busy === "boleto" ? "loader" : "printer"}
              className={busy === "boleto" ? "spin" : undefined}
              size={15}
            />
          </button>

          {/* Só faz sentido com cobrança emitida e ainda não quitada: é ela que
              tem estado a consultar no provedor. */}
          {emitido && charge.status !== "PAGO" && (
            <button
              className="icon-btn"
              style={{ width: 30, height: 30 }}
              type="button"
              onClick={() => void sincronizar()}
              disabled={busy !== null}
              aria-label={`Sincronizar cobrança do condomínio · competência ${charge.competence ?? ""}`}
              title="Consultar o Asaas: se estiver pago, dá a baixa e credita o saldo do condomínio"
            >
              <Icon
                name={busy === "sync" ? "loader" : "refresh"}
                className={busy === "sync" ? "spin" : undefined}
                size={15}
              />
            </button>
          )}
        </>
      )}
    </div>
  );
}
