"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { StatusBadge } from "../../../components/ui";
// Só o TIPO vem de lib/api (apagado na compilação). Importar um VALOR de lá
// puxaria o Clerk server para o bundle do client — ver lib/format.ts.
import type { Receivable } from "../../../lib/api";
import { formatDay as dateBr, formatPrice } from "../../../lib/format";
import {
  generateReceivablesAction,
  issueBoletoAction,
  loadReceivablesAction,
  settleReceivableAction,
  syncChargeAction,
} from "./actions";

/** Parcela em aberto com vencimento passado é exibida como vencida. */
function displayStatus(r: Receivable, today: string): string {
  return r.status === "ABERTO" && r.dueDate < today ? "VENCIDO" : r.status;
}

/**
 * Boleto da parcela. O documento com código de barras válido é emitido e
 * hospedado pelo **Asaas** — nós só abrimos a URL dele para impressão.
 *
 * A cobrança nasce **sob demanda**, no primeiro clique: a partir daí o botão só
 * reabre o link já emitido. Sem a conta Asaas conectada o backend responde 422
 * dizendo o que configurar, e a mensagem aparece abaixo da lista.
 */
function BoletoButton({
  receivable,
  onError,
  onIssued,
}: {
  receivable: Receivable;
  onError: (message: string) => void;
  /** Recarrega a lista quando a cobrança acabou de ser criada. */
  onIssued: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const emitido = Boolean(receivable.asaasChargeId);
  const bloqueada =
    receivable.status === "CANCELADO" ||
    receivable.status === "ESTORNADO" ||
    (receivable.status === "PAGO" && !emitido);

  async function open() {
    onError(""); // limpa o aviso da tentativa anterior (string vazia = oculto)

    // Cobrança já emitida: abre o PDF na hora, sem ida ao servidor.
    const jaTemPdf = receivable.boletoUrl ?? receivable.invoiceUrl;
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
    setBusy(true);
    const res = await issueBoletoAction(receivable.id);
    setBusy(false);

    if (!res.ok || !res.url) {
      tab?.close();
      onError(res.error ?? "Não foi possível emitir o boleto.");
      return;
    }

    // O backend devolve o PDF do boleto quando ele existe; a fatura (boleto +
    // PIX) é o fallback de quem cobra só por PIX.
    const url = res.boletoUrl ?? res.url;
    if (!emitido) onIssued();

    if (tab) {
      tab.location.href = url;
      return;
    }
    // Pop-up bloqueado de verdade: a cobrança já foi emitida e o link ficou
    // salvo na parcela, então basta liberar o bloqueio e clicar de novo — não
    // tiramos o usuário da tela do contrato.
    onError("Libere os pop-ups deste site e clique novamente para abrir o boleto.");
  }

  return (
    <button
      className="icon-btn"
      style={{ width: 30, height: 30 }}
      type="button"
      onClick={open}
      disabled={busy || bloqueada}
      aria-label={`${emitido ? "Abrir" : "Emitir"} boleto da parcela ${receivable.installment ?? ""}`}
      title={
        bloqueada
          ? "Parcela cancelada ou quitada não gera boleto."
          : emitido
            ? "Abrir o PDF do boleto para impressão"
            : "Emitir a cobrança no Asaas e abrir o boleto para impressão"
      }
    >
      <Icon name={busy ? "loader" : "printer"} className={busy ? "spin" : undefined} size={15} />
    </button>
  );
}

/**
 * Copia o **link de pagamento** (fatura do Asaas, com boleto e PIX lado a lado)
 * para mandar ao inquilino por WhatsApp/e-mail. É o formato que costuma
 * converter melhor do que o PDF do boleto: o PIX compensa na hora.
 */
function CopyLinkButton({
  receivable,
  onError,
}: {
  receivable: Receivable;
  onError: (message: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const url = receivable.invoiceUrl;
  if (!url) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url!);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      onError("Não foi possível copiar o link.");
    }
  }

  return (
    <button
      className="icon-btn"
      style={{ width: 30, height: 30 }}
      type="button"
      onClick={() => void copy()}
      aria-label={`Copiar link de pagamento da parcela ${receivable.installment ?? ""}`}
      title="Copiar link de pagamento (boleto + PIX) para enviar ao inquilino"
    >
      <Icon name={copied ? "check" : "link"} size={15} />
    </button>
  );
}

/**
 * Consulta o Asaas e aplica o estado atual da cobrança. Enquanto o backend roda
 * em localhost o webhook do provedor não chega, então esta é a forma de a baixa
 * aparecer aqui depois de o inquilino pagar.
 */
function SyncChargeButton({
  receivable,
  onError,
  onSynced,
}: {
  receivable: Receivable;
  onError: (message: string) => void;
  onSynced: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function sync() {
    onError("");
    setBusy(true);
    const res = await syncChargeAction(receivable.id);
    setBusy(false);
    if (!res.ok) {
      onError(res.error ?? "Não foi possível sincronizar a cobrança.");
      return;
    }
    onSynced();
  }

  return (
    <button
      className="icon-btn"
      style={{ width: 30, height: 30 }}
      type="button"
      onClick={() => void sync()}
      disabled={busy}
      aria-label={`Sincronizar cobrança da parcela ${receivable.installment ?? ""}`}
      title="Consultar o Asaas e atualizar a situação desta parcela"
    >
      <Icon name={busy ? "loader" : "refresh"} className={busy ? "spin" : undefined} size={15} />
    </button>
  );
}

/**
 * Baixa manual em dois passos: o clique abre a **data do pagamento** (hoje por
 * padrão) e o ✓ confirma.
 *
 * O passo extra existe porque a baixa costuma ser retroativa — a parcela é
 * regularizada dias ou meses depois — e é essa data que decide em que mês o
 * valor entra no caixa ("Recebido por mês" agrupa por ela). Enquanto o botão
 * dava baixa direto, toda regularização de parcela antiga virava receita do dia
 * em que alguém clicou.
 */
function SettleButton({
  receivable,
  today,
  disabled,
  onSettle,
}: {
  receivable: Receivable;
  today: string;
  disabled: boolean;
  onSettle: (id: string, paidAt: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [paidAt, setPaidAt] = useState(today);

  if (!open) {
    return (
      <button
        className="btn btn-ghost btn-sm"
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        Dar baixa
      </button>
    );
  }

  return (
    <div className="row gap-8">
      <input
        className="input input-sm"
        type="date"
        value={paidAt}
        max={today}
        autoFocus
        onChange={(e) => setPaidAt(e.target.value)}
        aria-label={`Data do pagamento da parcela ${receivable.installment ?? ""}`}
      />
      <button
        className="icon-btn"
        style={{ width: 30, height: 30 }}
        type="button"
        disabled={disabled || !paidAt}
        onClick={() => onSettle(receivable.id, paidAt)}
        aria-label="Confirmar baixa"
        title="Confirmar a baixa nesta data"
      >
        <Icon name="check" size={15} />
      </button>
      <button
        className="icon-btn"
        style={{ width: 30, height: 30 }}
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Cancelar baixa"
      >
        <Icon name="x" size={15} />
      </button>
    </div>
  );
}

/**
 * Aba "Aluguéis" do contrato: as parcelas (contas a receber) geradas quando o
 * contrato entra em vigência — uma por mês do prazo, no valor do aluguel,
 * vencendo no dia do inquilino.
 *
 * O botão "Gerar aluguéis" cobre o contrato assinado antes de valor/prazo
 * estarem preenchidos; é idempotente no backend, então não duplica parcela.
 */
export function ReceivablesPanel({
  contractId,
  isEdit,
  status,
}: {
  contractId?: string;
  isEdit: boolean;
  /** Status do contrato — só o VIGENTE gera aluguéis. */
  status: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [receivables, setReceivables] = useState<Receivable[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const today = new Date().toISOString().slice(0, 10);

  const load = useCallback(async () => {
    if (!contractId) return;
    setLoading(true);
    const res = await loadReceivablesAction(contractId);
    if (!res.ok) setError(res.error ?? "Falha ao carregar os aluguéis.");
    else setReceivables(res.receivables ?? []);
    setLoading(false);
  }, [contractId]);

  useEffect(() => {
    void load();
  }, [load]);

  function generate() {
    if (!contractId) return;
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await generateReceivablesAction(contractId);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível gerar os aluguéis.");
        return;
      }
      setNotice(
        res.created
          ? `${res.created} parcela(s) gerada(s).`
          : "Nenhuma parcela nova — os aluguéis deste contrato já estão gerados.",
      );
      await load();
      router.refresh();
    });
  }

  function settle(id: string, paidAt: string) {
    setError(null);
    setNotice(null);
    startTransition(async () => {
      const res = await settleReceivableAction(id, paidAt);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível dar baixa.");
        return;
      }
      await load();
      router.refresh();
    });
  }

  if (!isEdit || !contractId) {
    return (
      <p className="text-sm subtle" style={{ padding: "8px 0" }}>
        <Icon name="plus" size={14} /> Salve o contrato primeiro — os aluguéis são gerados quando
        todas as assinaturas são confirmadas.
      </p>
    );
  }

  const sum = (list: Receivable[]) => list.reduce((acc, r) => acc + r.amountCents, 0);
  const abertas = receivables.filter((r) => r.status === "ABERTO");
  const pagas = receivables.filter((r) => r.status === "PAGO");

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ justifyContent: "flex-end", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <button
          className="btn btn-outline btn-sm"
          type="button"
          onClick={generate}
          disabled={pending || status !== "VIGENTE"}
          title={
            status === "VIGENTE"
              ? "Gera as parcelas que ainda faltam (não duplica as existentes)."
              : "Disponível só para contratos vigentes (todas as assinaturas confirmadas)."
          }
        >
          <Icon name={pending ? "loader" : "receipt"} className={pending ? "spin" : undefined} size={14} />
          {pending ? " Gerando…" : " Gerar aluguéis"}
        </button>
      </div>

      {/* Avisos ficam ACIMA da tabela: no rodapé, com uma dúzia de parcelas na
          frente, a mensagem nasce fora da área visível do modal e o clique
          parece não ter feito nada. */}
      {error && (
        <div className="badge badge-red" style={{ alignItems: "flex-start", whiteSpace: "normal", textAlign: "left" }}>
          <Icon name="x" size={13} /> {error}
        </div>
      )}
      {notice && (
        <div className="badge badge-green" style={{ whiteSpace: "normal", textAlign: "left" }}>
          <Icon name="check" size={13} /> {notice}
        </div>
      )}

      {loading ? (
        <span className="text-sm subtle">
          <Icon name="loader" className="spin" size={14} /> Carregando…
        </span>
      ) : receivables.length === 0 ? (
        <span className="text-xs subtle">
          As parcelas nascem sozinhas quando o contrato passa a Vigente: uma por mês do prazo, no
          valor do aluguel, vencendo no dia do inquilino definido no cabeçalho.
        </span>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 90 }}>Parcela</th>
                <th style={{ width: 120 }}>Competência</th>
                <th style={{ width: 130 }}>Vencimento</th>
                <th>Valor</th>
                <th style={{ width: 130 }}>Situação</th>
                <th style={{ width: 210 }} />
              </tr>
            </thead>
            <tbody>
              {receivables.map((r) => (
                <tr key={r.id}>
                  <td className="tabular strong">
                    {r.installment != null && r.installmentsTotal != null
                      ? `${r.installment}/${r.installmentsTotal}`
                      : "—"}
                  </td>
                  <td className="text-sm tabular">{r.competence ?? "—"}</td>
                  <td className="text-sm subtle tabular">{dateBr(r.dueDate)}</td>
                  <td className="strong tabular">{formatPrice(r.amountCents)}</td>
                  <td>
                    <StatusBadge status={displayStatus(r, today)} />
                  </td>
                  <td>
                    <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
                      <BoletoButton receivable={r} onError={setError} onIssued={load} />
                      <CopyLinkButton receivable={r} onError={setError} />
                      {r.asaasChargeId && r.status !== "PAGO" && (
                        <SyncChargeButton receivable={r} onError={setError} onSynced={load} />
                      )}
                      {r.status === "ABERTO" ? (
                        <SettleButton
                          receivable={r}
                          today={today}
                          disabled={pending}
                          onSettle={settle}
                        />
                      ) : (
                        <span className="text-xs subtle">{r.paidAt ? dateBr(r.paidAt) : ""}</span>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
            {/* Totais no rodapé, destacados do corpo da lista. */}
            <tfoot className="table-total">
              <tr>
                <td colSpan={3}>
                  {receivables.length} parcela(s) · {pagas.length} paga(s) · {abertas.length} em
                  aberto
                </td>
                <td className="tabular">{formatPrice(sum(receivables))}</td>
                <td colSpan={2} className="text-xs">
                  Recebido {formatPrice(sum(pagas))} · a receber {formatPrice(sum(abertas))}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

    </div>
  );
}
