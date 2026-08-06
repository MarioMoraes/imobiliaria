"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../../components/Icon";
import { Modal } from "../../../../components/Modal";
import { useConfirm } from "../../../../components/ConfirmDialog";
import { useToast } from "../../../../components/Toast";
// Só o TIPO vem de lib/api (apagado na compilação). Importar um VALOR de lá
// puxaria o Clerk server para o bundle do client — ver lib/format.ts.
import type { CashFlowMovement } from "../../../../lib/api";
import { formatDay, formatPrice } from "../../../../lib/format";
import { deleteCashFlowEntryAction } from "../actions";

/**
 * O extrato do mês.
 *
 * A coluna "Conta em" é o que impede a leitura errada: um movimento pode ser
 * caixa (passou pelo banco), resultado (é receita ou despesa nossa) ou os dois.
 * A taxa de administração é só resultado — ela já veio dentro do aluguel
 * recebido, e somá-la ao caixa contaria o mesmo dinheiro duas vezes.
 *
 * O detalhe da linha mora num popup (ícone de olho) em vez de uma coluna: a
 * descrição varia muito de tamanho entre as origens e espremia as colunas de
 * valor. No popup ela cabe inteira.
 */

/** Só o lançamento manual pode ser removido — o resto é derivado da origem. */
function isManual(m: CashFlowMovement): boolean {
  return m.source === "MANUAL";
}

interface Tag {
  label: string;
  cls: string;
  title: string;
}

function tagsOf(m: CashFlowMovement): Tag[] {
  const tags: Tag[] = [];
  if (m.affectsCash) {
    tags.push({ label: "Caixa", cls: "badge-blue", title: "Passou pela conta bancária" });
  }
  if (m.affectsResult) {
    tags.push({
      label: "Resultado",
      cls: "badge-green",
      title: "É receita ou despesa da imobiliária",
    });
  }
  if (!m.affectsResult && m.affectsCash) {
    tags.push({
      label: "Terceiros",
      cls: "badge-slate",
      title: "Dinheiro de terceiros: passa pela conta, mas não é nosso",
    });
  }
  return tags;
}

/** Nome legível da origem — de onde o lançamento veio. */
const ORIGEM: Record<CashFlowMovement["source"], string> = {
  RECEBIMENTO: "Baixa de Conta a Receber",
  TAXA_ADM: "Repasse ao Proprietário",
  JUROS_MULTA: "Baixa de Conta a Receber",
  REPASSE: "Repasse ao Proprietário",
  COMISSAO: "Comissão",
  MANUAL: "Lançamento Manual",
};

export function MovementsTable({
  movements,
  monthLabel,
}: {
  movements: CashFlowMovement[];
  /** Mês por extenso ("Julho/2026") — usado nas mensagens da tela. */
  monthLabel: string;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [, startRemove] = useTransition();
  const [removingKey, setRemovingKey] = useState<string | null>(null);
  const [detail, setDetail] = useState<CashFlowMovement | null>(null);

  async function handleDelete(m: CashFlowMovement) {
    const ok = await confirm({
      title: "Excluir este lançamento?",
      message:
        `"${m.description ?? m.label}" (${formatPrice(m.amountCents)}) sai do fluxo ` +
        `de caixa de ${monthLabel} e o resultado do mês é recalculado.`,
      eyebrow: "Exclusão",
      confirmLabel: "Excluir",
    });
    if (!ok || !m.sourceId) return;

    setRemovingKey(m.key);
    startRemove(async () => {
      try {
        const res = await deleteCashFlowEntryAction(m.sourceId!);
        if (!res.ok) {
          toast.error(res.error ?? "Falha ao excluir o lançamento.");
          return;
        }
        toast.success("Lançamento excluído.");
        setDetail(null);
        router.refresh();
      } finally {
        setRemovingKey(null);
      }
    });
  }

  return (
    <>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Data</th>
              <th>Natureza</th>
              <th>Conta em</th>
              <th style={{ textAlign: "right" }}>Valor</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {movements.map((m) => (
              <tr key={m.key}>
                <td className="text-sm subtle">{formatDay(m.date)}</td>
                <td className="strong">{m.label}</td>
                <td>
                  <span className="row gap-8">
                    {tagsOf(m).map((tag) => (
                      <span key={tag.label} className={`badge ${tag.cls}`} title={tag.title}>
                        {tag.label}
                      </span>
                    ))}
                  </span>
                </td>
                <td
                  className="strong num"
                  style={{
                    textAlign: "right",
                    color: m.direction === "SAIDA" ? "var(--danger)" : undefined,
                  }}
                >
                  {m.direction === "SAIDA" ? "−" : "+"}
                  {formatPrice(m.amountCents)}
                </td>
                <td style={{ width: 80, textAlign: "right" }}>
                  <span className="row gap-8" style={{ justifyContent: "flex-end" }}>
                    <button
                      className="icon-btn"
                      style={{ width: 30, height: 30 }}
                      type="button"
                      onClick={() => setDetail(m)}
                      aria-label={`Ver Detalhes de ${m.label}`}
                    >
                      <Icon name="eye" size={15} />
                    </button>
                    {isManual(m) && (
                      <button
                        className="icon-btn"
                        style={{ width: 30, height: 30 }}
                        type="button"
                        onClick={() => void handleDelete(m)}
                        disabled={removingKey !== null}
                        aria-label={`Excluir ${m.description ?? m.label}`}
                      >
                        <Icon
                          name={removingKey === m.key ? "loader" : "trash"}
                          className={removingKey === m.key ? "spin" : undefined}
                          size={15}
                        />
                      </button>
                    )}
                  </span>
                </td>
              </tr>
            ))}
            {movements.length === 0 && (
              <tr>
                <td colSpan={5} className="text-sm subtle">
                  Nenhum movimento neste mês. O aluguel recebido e a taxa de
                  administração entram aqui quando uma parcela recebe baixa; as
                  despesas do escritório, por &quot;Novo Lançamento&quot;.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail?.label ?? "Detalhes"}
        subtitle={detail ? formatDay(detail.date) : undefined}
        icon="receipt"
        centered
      >
        {detail && (
          <MovementDetail
            movement={detail}
            onDelete={() => void handleDelete(detail)}
            deleting={removingKey === detail.key}
          />
        )}
      </Modal>
    </>
  );
}

/* ------------------------------------------------------------- Detalhe */

function Row({
  label,
  value,
  last = false,
}: {
  label: string;
  value: React.ReactNode;
  /** Última linha: sem o fio embaixo, que encostaria na borda do popup. */
  last?: boolean;
}) {
  return (
    <div
      className="row-between"
      style={{
        paddingBottom: 8,
        borderBottom: last ? "none" : "1px solid var(--border)",
      }}
    >
      <span className="subtle text-sm">{label}</span>
      <span className="strong text-sm" style={{ textAlign: "right" }}>
        {value}
      </span>
    </div>
  );
}

function MovementDetail({
  movement,
  onDelete,
  deleting,
}: {
  movement: CashFlowMovement;
  onDelete: () => void;
  deleting: boolean;
}) {
  const saida = movement.direction === "SAIDA";

  return (
    <div className="card-pad stack" style={{ gap: 12 }}>
      <Row label="Data" value={formatDay(movement.date)} />
      <Row label="Natureza" value={movement.label} />
      <Row label="Descrição" value={movement.description ?? "—"} />
      {movement.source === "MANUAL" && (
        <Row label="Categoria" value={movement.categoryName ?? "Sem Categoria"} />
      )}
      <Row label="Origem" value={ORIGEM[movement.source]} />
      <Row label="Tipo" value={saida ? "Saída" : "Entrada"} />
      <Row
        label="Valor"
        value={
          <span className="num" style={saida ? { color: "var(--danger)" } : undefined}>
            {saida ? "−" : "+"}
            {formatPrice(movement.amountCents)}
          </span>
        }
      />
      <Row
        label="Conta em"
        last
        value={
          <span className="row gap-8" style={{ justifyContent: "flex-end" }}>
            {tagsOf(movement).map((tag) => (
              <span key={tag.label} className={`badge ${tag.cls}`}>
                {tag.label}
              </span>
            ))}
          </span>
        }
      />

      {isManual(movement) && (
        <div className="row" style={{ justifyContent: "flex-end" }}>
          <button
            className="btn btn-outline btn-sm"
            type="button"
            onClick={onDelete}
            disabled={deleting}
          >
            <Icon name={deleting ? "loader" : "trash"} className={deleting ? "spin" : undefined} />
            Excluir Lançamento
          </button>
        </div>
      )}
    </div>
  );
}
