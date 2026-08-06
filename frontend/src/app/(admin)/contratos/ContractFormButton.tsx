"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { useConfirm } from "../../../components/ConfirmDialog";
import { useToast } from "../../../components/Toast";
import { FieldBlock, TabBar, initials } from "../../../components/ui";
import type { Contract } from "../../../lib/api";
import {
  addPartyAction,
  createContractAction,
  removePartyAction,
  terminateContractAction,
  updateContractAction,
  type ContractFormInput,
} from "./actions";
import { SignaturePanel } from "./SignaturePanel";
import { ReceivablesPanel } from "./ReceivablesPanel";

/** Item de dropdown/seletor (id + rótulo). */
export interface Opt {
  id: string;
  label: string;
  /** Linha secundária (ex.: CPF/telefone/cidade) — usada na busca do seletor. */
  sub?: string;
}

/** Minúsculas sem acento — para a busca tolerar "Joao"/"João". */
const fold = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/**
 * Situação do contrato — campo de LEITURA. Nasce RASCUNHO, vai a EM_ASSINATURA
 * no envio ao provedor e a VIGENTE quando todas as assinaturas são confirmadas;
 * ENCERRADO/DISTRATADO saem dos botões da própria ficha.
 */
const STATUS_LABEL: Record<string, string> = {
  RASCUNHO: "Rascunho",
  EM_ASSINATURA: "Em assinatura",
  VIGENTE: "Vigente",
  RENOVADO: "Renovado",
  ENCERRADO: "Encerrado",
  DISTRATADO: "Distratado",
};

const EMPTY: ContractFormInput = {
  propertyId: "",
  templateId: "",
  status: "RASCUNHO",
  startsAt: "",
  endsAt: "",
  termMonths: "",
  readjustIndex: "IPCA",
  readjustPeriodMonths: "",
  lastReadjustAt: "",
  ownerPayDay: "",
  tenantPayDay: "",
  terminatedAt: "",

  rentalValueReais: "",
  interestPercent: "",
  penaltyPercent: "",
  adminFeePercent: "",
  isAdministration: false,
  incomeTaxDeclaration: false,
  iptuChargedTo: "",
  commissionType: "",
  hasCommission: false,

  guaranteeKind: "",
  hasInsurance: false,
  insuranceDescription: "",
  insuranceValueReais: "",

  isSettled: false,
  hasEvictionOrder: false,
  hasJudicialExecution: false,
  processNumber: "",
  court: "",

  specialClauses: "",
  guarantorPropertyInfo: "",
};

/**
 * Vencimento da locação: início + N meses − 1 dia, ou seja, a véspera do
 * aniversário. Um contrato de 30 meses iniciado em 01/08/2026 vence em
 * 31/01/2029, cobrindo exatamente 30 meses de ocupação.
 *
 * Usa UTC para o fuso não deslocar o dia. Quando o aniversário não existe no
 * mês de destino (31/01 + 1 mês, ou 29/02 + 12 meses num ano comum), a véspera
 * é o último dia desse mês — não se subtrai mais nada, senão o contrato
 * perderia um dia.
 */
export function computeEndDate(startsAt: string, termMonths: string): string {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(startsAt.trim());
  const months = Number.parseInt(termMonths.trim(), 10);
  if (!date || !Number.isFinite(months) || months <= 0) return "";

  const [, y, m, d] = date;
  const start = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  if (Number.isNaN(start.getTime())) return "";

  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + months);
  if (end.getUTCDate() !== start.getUTCDate()) {
    // Estouro (ex.: 31/01 + 1 mês → 03/03): o dia 0 devolve o último dia do
    // mês de destino, que já é a véspera do aniversário inexistente.
    end.setUTCDate(0);
  } else {
    end.setUTCDate(end.getUTCDate() - 1);
  }

  return end.toISOString().slice(0, 10);
}

/**
 * Patch do vencimento para o `set` do formulário. Devolve objeto vazio quando
 * não dá para calcular — assim uma data digitada à mão não é apagada.
 */
function recalcEnd(startsAt: string, termMonths: string, current: string) {
  const endsAt = computeEndDate(startsAt, termMonths);
  return endsAt && endsAt !== current ? { endsAt } : {};
}

const money = (cents: number | null | undefined) =>
  cents != null ? (cents / 100).toFixed(2).replace(".", ",") : "";
const numStr = (n: number | null | undefined) => (n != null ? String(n).replace(".", ",") : "");
const txt = (s: string | null | undefined) => s ?? "";

/** Preenche o formulário a partir de um contrato existente (modo edição). */
function fromContract(c: Contract): ContractFormInput {
  return {
    propertyId: txt(c.propertyId),
    templateId: txt(c.templateId),
    status: c.status,
    startsAt: txt(c.startsAt),
    endsAt: txt(c.endsAt),
    termMonths: numStr(c.termMonths),
    readjustIndex: c.readjustIndex || "IPCA",
    readjustPeriodMonths: numStr(c.readjustPeriodMonths),
    lastReadjustAt: txt(c.lastReadjustAt),
    ownerPayDay: numStr(c.ownerPayDay),
    tenantPayDay: numStr(c.tenantPayDay),
    terminatedAt: txt(c.terminatedAt),

    rentalValueReais: money(c.rentalValueCents),
    interestPercent: numStr(c.interestPercent),
    penaltyPercent: numStr(c.penaltyPercent),
    adminFeePercent: numStr(c.adminFeePercent),
    isAdministration: !!c.isAdministration,
    incomeTaxDeclaration: !!c.incomeTaxDeclaration,
    iptuChargedTo: txt(c.iptuChargedTo),
    commissionType: txt(c.commissionType),
    hasCommission: !!c.hasCommission,

    guaranteeKind: txt(c.guaranteeKind),
    hasInsurance: !!c.hasInsurance,
    insuranceDescription: txt(c.insuranceDescription),
    insuranceValueReais: money(c.insuranceValueCents),

    isSettled: !!c.isSettled,
    hasEvictionOrder: !!c.hasEvictionOrder,
    hasJudicialExecution: !!c.hasJudicialExecution,
    processNumber: txt(c.processNumber),
    court: txt(c.court),

    specialClauses: txt(c.specialClauses),
    guarantorPropertyInfo: txt(c.guarantorPropertyInfo),
  };
}

type TabId =
  | "cabecalho"
  | "valores"
  | "situacao"
  | "locatarios"
  | "fiadores"
  | "clausulas"
  | "assinatura"
  | "alugueis";

/**
 * Cada aba carrega a classe do seu tópico (`tone-*`, em globals.css). A mesma
 * cor reaparece nos blocos de campos daquela aba — é o fio que orienta a
 * leitura da ficha.
 */
const TABS: { id: TabId; label: string; tone: string }[] = [
  { id: "cabecalho", label: "Cabeçalho", tone: "tone-azul" },
  { id: "valores", label: "Imóvel & Valores", tone: "tone-ciano" },
  { id: "situacao", label: "Situação", tone: "tone-ambar" },
  { id: "locatarios", label: "Locatários", tone: "tone-indigo" },
  { id: "fiadores", label: "Fiadores", tone: "tone-teal" },
  { id: "clausulas", label: "Cláusulas", tone: "tone-ardosia" },
  { id: "assinatura", label: "Assinatura", tone: "tone-esmeralda" },
  { id: "alugueis", label: "Aluguéis", tone: "tone-ciano" },
];

interface Props {
  contract?: Contract;
  properties: Opt[];
  templates: Opt[];
  locatarioCandidates: Opt[];
  fiadorCandidates: Opt[];
  /** Desabilita o gatilho (ex.: backend offline). */
  disabled?: boolean;
}

/**
 * Botão + modal em abas do cadastro "Contratos de Locação" (paridade com a tela
 * legada). Cria (`contract` ausente) e edita. As abas Locatários/Fiadores gerem
 * as partes (só no modo edição — precisam do id do contrato). O botão "Contrato
 * de Locação" gera o PDF a partir do template padrão preenchido.
 */
export function ContractFormButton({
  contract,
  properties,
  templates,
  locatarioCandidates,
  fiadorCandidates,
  disabled,
}: Props) {
  const isEdit = !!contract;
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [partyPending, startPartyTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<TabId>("cabecalho");
  const [form, setForm] = useState<ContractFormInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [partyError, setPartyError] = useState<string | null>(null);
  const [picker, setPicker] = useState<null | { role: "LOCATARIO" | "FIADOR" }>(null);

  useEffect(() => setMounted(true), []);

  const set = (patch: Partial<ContractFormInput>) => setForm((f) => ({ ...f, ...patch }));

  /**
   * Situação vem SEMPRE do servidor, nunca do formulário: quem a move é o fluxo
   * de assinatura. Ler de `form` deixava a tela mostrando o valor de quando o
   * modal foi aberto — e era esse valor velho que o Salvar reenviava, jogando
   * um contrato recém-assinado de volta para "Em assinatura".
   */
  const liveStatus = contract?.status ?? "RASCUNHO";
  const [terminating, setTerminating] = useState(false);

  async function terminate(status: "ENCERRADO" | "DISTRATADO") {
    if (!contract) return;
    const encerrando = status === "ENCERRADO";
    const numero = contract.code != null ? ` Nº ${contract.code}` : "";
    const ok = await confirm({
      eyebrow: encerrando ? "Encerramento" : "Distrato",
      title: encerrando
        ? `Encerrar o contrato${numero}?`
        : `Registrar o distrato do contrato${numero}?`,
      message:
        "O imóvel volta para Disponível e as parcelas de aluguel em aberto são canceladas.",
      confirmLabel: encerrando ? "Encerrar" : "Registrar distrato",
    });
    if (!ok) return;
    setError(null);
    setTerminating(true);
    startTransition(async () => {
      const res = await terminateContractAction(contract.id, status);
      setTerminating(false);
      if (!res.ok) {
        const msg = res.error ?? "Não foi possível encerrar o contrato.";
        setError(msg);
        toast.error(msg);
        return;
      }
      toast.success(encerrando ? "Contrato encerrado." : "Distrato registrado.");
      setOpen(false);
      router.refresh();
    });
  }

  const parties = contract?.parties ?? [];
  const locatarios = parties.filter((p) => p.role === "LOCATARIO");
  const fiadores = parties.filter((p) => p.role === "FIADOR");

  function openModal() {
    setForm(contract ? fromContract(contract) : EMPTY);
    setTab("cabecalho");
    setError(null);
    setPartyError(null);
    setPicker(null);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = contract
        ? await updateContractAction(contract.id, form)
        : await createContractAction(form);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  function addParty(role: "LOCATARIO" | "FIADOR", personId: string) {
    if (!contract || !personId) return;
    setPartyError(null);
    setPicker(null);
    startPartyTransition(async () => {
      const res = await addPartyAction(contract.id, role, personId);
      if (!res.ok) {
        setPartyError(res.error ?? "Falha ao vincular.");
        return;
      }
      router.refresh();
    });
  }

  function removeParty(partyId: string) {
    if (!contract) return;
    setPartyError(null);
    startPartyTransition(async () => {
      const res = await removePartyAction(contract.id, partyId);
      if (!res.ok) {
        setPartyError(res.error ?? "Falha ao remover.");
        return;
      }
      router.refresh();
    });
  }

  /** Lista de partes de um papel, com botão de adicionar (só em edição). */
  const partyList = (role: "LOCATARIO" | "FIADOR", items: typeof parties, candidates: Opt[]) => {
    const linked = new Set(items.map((p) => p.personId));
    const available = candidates.filter((c) => !linked.has(c.id));
    return (
      <div className="stack" style={{ gap: 10 }}>
        {!isEdit ? (
          <p className="text-sm subtle" style={{ padding: "8px 0" }}>
            <Icon name="plus" size={14} /> Salve o contrato primeiro para adicionar {role === "LOCATARIO" ? "locatários" : "fiadores"}.
          </p>
        ) : (
          <>
            {items.length === 0 ? (
              <div
                className="stack"
                style={{ alignItems: "center", gap: 6, padding: "22px 0", border: "1px dashed var(--border)", borderRadius: 10 }}
              >
                <Icon name="users" size={20} />
                <span className="text-sm subtle">Nenhum {role === "LOCATARIO" ? "locatário" : "fiador"} vinculado.</span>
              </div>
            ) : (
              <div className="stack" style={{ gap: 6 }}>
                {items.map((p) => (
                  <div
                    key={p.id}
                    className={`row ${role === "LOCATARIO" ? "tone-indigo" : "tone-teal"}`}
                    style={{ justifyContent: "space-between", alignItems: "center", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}
                  >
                    <span className="row gap-8">
                      <span className="avatar-initials">{initials(p.personName)}</span>
                      <span className="text-sm strong">{p.personName}</span>
                    </span>
                    <button
                      className="icon-btn"
                      type="button"
                      aria-label="Remover"
                      disabled={partyPending}
                      onClick={() => removeParty(p.id)}
                      style={{ width: 28, height: 28 }}
                    >
                      <Icon name="trash" size={14} />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <button
              className="btn btn-primary btn-sm"
              type="button"
              disabled={partyPending || available.length === 0}
              onClick={() => { setPartyError(null); setPicker({ role }); }}
              style={{ alignSelf: "flex-start" }}
            >
              <Icon name={partyPending ? "loader" : "plus"} className={partyPending ? "spin" : undefined} size={14} />
              {partyPending ? " Vinculando…" : role === "LOCATARIO" ? " Adicionar Locatário" : " Adicionar Fiador"}
            </button>
            {available.length === 0 && candidates.length > 0 && (
              <span className="text-xs subtle">Todos os cadastros disponíveis já estão vinculados.</span>
            )}
          </>
        )}
      </div>
    );
  };

  const modal = (
    <div
      onClick={close}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 16px", overflowY: "auto", zIndex: 2000 }}
    >
      <div
        className="card card-pad stack modal-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{ gap: 12, width: 1040, maxWidth: "96vw", boxShadow: "0 20px 60px rgba(0,0,0,.30)" }}
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>
            {isEdit ? "Editar Contrato" : "Novo Contrato"}
            {contract?.code != null && <span className="subtle text-sm"> · Nº {contract.code}</span>}
          </strong>
          <button className="icon-btn" type="button" aria-label="Fechar" onClick={close}>
            <Icon name="close" size={15} />
          </button>
        </div>

        {/* Abas — cada tópico acende a própria cor no marcador e no sublinhado. */}
        <TabBar tabs={TABS} active={tab} onSelect={setTab} />

        <div className="modal-scroll">

        {/* ── Aba: Cabeçalho ─────────────────────────────────────── */}
        {tab === "cabecalho" && (
          <div className="stack" style={{ gap: 12 }}>
            <FieldBlock tone="tone-azul" icon="contract" title="Identificação">
              <div className="grid grid-2" style={{ gap: 12 }}>
                <Select label="Imóvel" value={form.propertyId} onChange={(v) => set({ propertyId: v })}>
                  <option value="">—</option>
                  {properties.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                </Select>
                <div className="field">
                  <label>Situação</label>
                  <input className="input" value={STATUS_LABEL[liveStatus] ?? liveStatus} readOnly disabled />
                  {(liveStatus === "VIGENTE" || liveStatus === "RENOVADO") && (
                    <div className="row gap-8" style={{ marginTop: 8 }}>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={() => void terminate("ENCERRADO")}
                        disabled={terminating}
                      >
                        Encerrar
                      </button>
                      <button
                        className="btn btn-ghost btn-sm"
                        type="button"
                        onClick={() => void terminate("DISTRATADO")}
                        disabled={terminating}
                      >
                        Registrar Distrato
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </FieldBlock>

            <FieldBlock tone="tone-azul" icon="calendar" title="Vigência">
              <div className="grid grid-4" style={{ gap: 12 }}>
                <Text
                  label="Início"
                  value={form.startsAt}
                  onChange={(v) => set({ startsAt: v, ...recalcEnd(v, form.termMonths, form.endsAt) })}
                  type="date"
                />
                <Text
                  label="Meses"
                  value={form.termMonths}
                  onChange={(v) => set({ termMonths: v, ...recalcEnd(form.startsAt, v, form.endsAt) })}
                  inputMode="numeric"
                />
                <Text
                  label="Vencimento"
                  value={form.endsAt}
                  onChange={(v) => set({ endsAt: v })}
                  type="date"
                  computed={Boolean(computeEndDate(form.startsAt, form.termMonths))}
                />
                <Text label="Rescisão" value={form.terminatedAt} onChange={(v) => set({ terminatedAt: v })} type="date" />
              </div>
            </FieldBlock>

            {/* O modelo do contrato é escolhido na aba Assinatura, junto do
                envio do documento. */}
            <FieldBlock tone="tone-azul" icon="trendingUp" title="Reajuste e pagamento">
              <div className="grid grid-3" style={{ gap: 12 }}>
                <Select label="Índice" value={form.readjustIndex} onChange={(v) => set({ readjustIndex: v })}>
                  <option value="IPCA">IPCA</option>
                  <option value="IGP_M">IGP-M</option>
                  <option value="INPC">INPC</option>
                  <option value="FIXO">Fixo</option>
                </Select>
                <Text label="Periodicidade (Meses)" value={form.readjustPeriodMonths} onChange={(v) => set({ readjustPeriodMonths: v })} inputMode="numeric" />
                <Text label="Último Reajuste" value={form.lastReadjustAt} onChange={(v) => set({ lastReadjustAt: v })} type="date" />
                <Text label="Dia Prop." value={form.ownerPayDay} onChange={(v) => set({ ownerPayDay: v })} inputMode="numeric" placeholder="1–31" />
                <Text label="Dia Inq." value={form.tenantPayDay} onChange={(v) => set({ tenantPayDay: v })} inputMode="numeric" placeholder="1–31" />
              </div>
            </FieldBlock>
          </div>
        )}

        {/* ── Aba: Imóvel & Valores ──────────────────────────────── */}
        {tab === "valores" && (
          <div className="stack" style={{ gap: 12 }}>
            <FieldBlock tone="tone-ciano" icon="banknote" title="Valores">
              <div className="grid grid-4" style={{ gap: 12 }}>
                <Text label="Preço (R$)" value={form.rentalValueReais} onChange={(v) => set({ rentalValueReais: v })} inputMode="decimal" />
                <Text label="Juros (%)" value={form.interestPercent} onChange={(v) => set({ interestPercent: v })} inputMode="decimal" />
                <Text label="Multa (%)" value={form.penaltyPercent} onChange={(v) => set({ penaltyPercent: v })} inputMode="decimal" />
                <Text label="Taxa Adm (%)" value={form.adminFeePercent} onChange={(v) => set({ adminFeePercent: v })} inputMode="decimal" />
              </div>
            </FieldBlock>

            <FieldBlock tone="tone-ciano" icon="receipt" title="Encargos e comissão">
              <div className="grid grid-2" style={{ gap: 12 }}>
                <Select label="IPTU do" value={form.iptuChargedTo} onChange={(v) => set({ iptuChargedTo: v })}>
                  <option value="">—</option>
                  <option value="LOCATARIO">Locatário</option>
                  <option value="LOCADOR">Locador</option>
                </Select>
                <Text label="Tipo de Comissão" value={form.commissionType} onChange={(v) => set({ commissionType: v })} placeholder="Ex.: 1º Mês de Aluguel" />
              </div>
              <div className="row" style={{ gap: 20, paddingTop: 12, flexWrap: "wrap" }}>
                <Check label="Administração" checked={form.isAdministration} onChange={(v) => set({ isAdministration: v })} />
                <Check label="Dec. IR" checked={form.incomeTaxDeclaration} onChange={(v) => set({ incomeTaxDeclaration: v })} />
                <Check label="Comissão" checked={form.hasCommission} onChange={(v) => set({ hasCommission: v })} />
              </div>
            </FieldBlock>

            <FieldBlock tone="tone-teal" icon="shield" title="Garantia">
              <div className="grid grid-3" style={{ gap: 12 }}>
                <Select label="Modalidade" value={form.guaranteeKind} onChange={(v) => set({ guaranteeKind: v })}>
                  <option value="">—</option>
                  <option value="FIADOR">Fiador</option>
                  <option value="CAUCAO">Caução</option>
                  <option value="SEGURO_FIANCA">Seguro-fiança</option>
                  <option value="TITULO_CAP">Título de Capitalização</option>
                </Select>
                <Text label="Descrição do Seguro" value={form.insuranceDescription} onChange={(v) => set({ insuranceDescription: v })} />
                <Text label="Seguro (R$)" value={form.insuranceValueReais} onChange={(v) => set({ insuranceValueReais: v })} inputMode="decimal" />
              </div>
              <div className="row" style={{ paddingTop: 12 }}>
                <Check label="Seguro Fiança" checked={form.hasInsurance} onChange={(v) => set({ hasInsurance: v })} />
              </div>
            </FieldBlock>
          </div>
        )}

        {/* ── Aba: Situação ──────────────────────────────────────── */}
        {tab === "situacao" && (
          <div className="stack" style={{ gap: 12 }}>
            <FieldBlock tone="tone-ambar" icon="flag" title="Marcadores">
              <div className="row" style={{ gap: 20, flexWrap: "wrap" }}>
                <Check label="Liquidado" checked={form.isSettled} onChange={(v) => set({ isSettled: v })} />
                <Check label="Ordem de Despejo" checked={form.hasEvictionOrder} onChange={(v) => set({ hasEvictionOrder: v })} />
                <Check label="Execução Judicial" checked={form.hasJudicialExecution} onChange={(v) => set({ hasJudicialExecution: v })} />
              </div>
            </FieldBlock>
            <FieldBlock tone="tone-ambar" icon="folder" title="Processo judicial">
              <div className="grid grid-2" style={{ gap: 12 }}>
                <Text label="Nº Processo" value={form.processNumber} onChange={(v) => set({ processNumber: v })} />
                <Text label="Vara" value={form.court} onChange={(v) => set({ court: v })} placeholder="Ex.: 1ª Vara" />
              </div>
            </FieldBlock>
          </div>
        )}

        {/* ── Aba: Locatários ────────────────────────────────────── */}
        {tab === "locatarios" && partyList("LOCATARIO", locatarios, locatarioCandidates)}

        {/* ── Aba: Fiadores ──────────────────────────────────────── */}
        {tab === "fiadores" && (
          <div className="stack" style={{ gap: 12 }}>
            {partyList("FIADOR", fiadores, fiadorCandidates)}
            <div className="field" style={{ borderTop: "1px solid var(--border)", paddingTop: 12 }}>
              <label>Imóvel do Fiador</label>
              <textarea
                className="input"
                rows={3}
                value={form.guarantorPropertyInfo}
                onChange={(e) => set({ guarantorPropertyInfo: e.target.value })}
                placeholder="Descrição do imóvel dado em garantia pelo fiador"
              />
            </div>
          </div>
        )}

        {/* ── Aba: Cláusulas ─────────────────────────────────────── */}
        {tab === "clausulas" && (
          <FieldBlock tone="tone-ardosia" icon="list" title="Cláusulas especiais">
            <div className="field">
              <textarea
                className="input"
                rows={8}
                value={form.specialClauses}
                onChange={(e) => set({ specialClauses: e.target.value })}
                placeholder="Cláusulas adicionais que entram no contrato gerado."
              />
            </div>
          </FieldBlock>
        )}

        {/* ── Aba: Assinatura eletrônica (ZapSign) ───────────────── */}
        {tab === "assinatura" && (
          <SignaturePanel
            contractId={contract?.id}
            isEdit={isEdit}
            templates={templates}
            templateId={form.templateId}
            onTemplateChange={(v) => set({ templateId: v })}
            parties={parties}
          />
        )}

        {/* ── Aba: Aluguéis gerados (contas a receber) ────────────── */}
        {tab === "alugueis" && (
          <ReceivablesPanel contractId={contract?.id} isEdit={isEdit} status={liveStatus} />
        )}

        </div>

        {partyError && <span className="text-xs" style={{ color: "var(--danger, #dc2626)" }}>{partyError}</span>}
        {error && <span className="text-sm" style={{ color: "var(--danger, #dc2626)" }}>{error}</span>}

        <div className="row" style={{ justifyContent: "space-between", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 12, flexWrap: "wrap" }}>
          {!isEdit && (
            <span className="text-xs subtle">Salve para gerar o documento e adicionar partes.</span>
          )}
          {/* A geração do PDF vive na aba Assinatura, junto do modelo usado. */}
          <div className="row" style={{ gap: 8, marginLeft: "auto" }}>
            <button className="btn btn-ghost btn-sm" type="button" onClick={close} disabled={pending}>
              Cancelar
            </button>
            <button className="btn btn-primary btn-sm" type="button" onClick={submit} disabled={pending}>
              {pending ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {isEdit ? (
        <button className="icon-btn" style={{ width: 30, height: 30 }} type="button" onClick={openModal} disabled={disabled} aria-label={`Editar contrato ${contract.code ?? ""}`}>
          <Icon name="edit" size={15} />
        </button>
      ) : (
        <button className="btn btn-primary btn-sm" type="button" onClick={openModal} disabled={disabled}>
          <Icon name="plus" /> Novo Contrato
        </button>
      )}
      {open && mounted && createPortal(modal, document.body)}
      {open && mounted && picker &&
        createPortal(
          <PersonPicker
            title={picker.role === "LOCATARIO" ? "Adicionar Locatário" : "Adicionar Fiador"}
            candidates={(picker.role === "LOCATARIO" ? locatarioCandidates : fiadorCandidates).filter(
              (c) => !parties.some((p) => p.role === picker.role && p.personId === c.id),
            )}
            onPick={(personId) => addParty(picker.role, personId)}
            onClose={() => setPicker(null)}
          />,
          document.body,
        )}
    </>
  );
}

/**
 * Popup de escolha de pessoa: busca por nome (ou CPF/telefone) sobre os
 * candidatos já carregados e devolve o escolhido em um clique.
 */
function PersonPicker({
  title,
  candidates,
  onPick,
  onClose,
}: {
  title: string;
  candidates: Opt[];
  onPick: (personId: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const q = fold(query.trim());
  const results = q
    ? candidates.filter((c) => fold(c.label).includes(q) || fold(c.sub ?? "").includes(q))
    : candidates;

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "10vh 16px", overflowY: "auto", zIndex: 2500 }}
    >
      <div
        className="card card-pad stack"
        onClick={(e) => e.stopPropagation()}
        style={{ gap: 12, width: 600, maxWidth: "94vw", boxShadow: "0 20px 60px rgba(0,0,0,.30)" }}
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>{title}</strong>
          <button className="icon-btn" type="button" aria-label="Fechar" onClick={onClose}>
            <Icon name="close" size={15} />
          </button>
        </div>

        <input
          className="input"
          value={query}
          autoFocus
          placeholder="Buscar por nome, CPF/CNPJ ou telefone…"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && results[0]) onPick(results[0].id);
          }}
        />

        <div className="stack" style={{ gap: 6, maxHeight: "46vh", overflowY: "auto" }}>
          {results.length === 0 ? (
            <span className="text-sm subtle" style={{ padding: "12px 0" }}>
              Nenhuma pessoa encontrada para “{query}”.
            </span>
          ) : (
            results.map((c) => (
              <button
                key={c.id}
                type="button"
                className="row"
                onClick={() => onPick(c.id)}
                style={{ justifyContent: "space-between", alignItems: "center", gap: 8, width: "100%", textAlign: "left", cursor: "pointer", background: "transparent", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}
              >
                <span className="stack" style={{ gap: 2 }}>
                  <span className="text-sm strong">{c.label}</span>
                  {c.sub && <span className="text-xs subtle">{c.sub}</span>}
                </span>
                <Icon name="chevronRight" size={14} />
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------- campos reutilizáveis */
function Text({
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  maxLength,
  type,
  autoFocus,
  computed,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputMode?: "numeric" | "decimal" | "text";
  maxLength?: number;
  type?: string;
  autoFocus?: boolean;
  /** Campo preenchido pelo sistema — recebe destaque e a marca "automático". */
  computed?: boolean;
}) {
  return (
    <div className="field">
      <label>
        {label}
        {computed && <span className="field-auto"> · automático</span>}
      </label>
      <input
        className={`input${computed ? " is-computed" : ""}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        maxLength={maxLength}
        type={type}
        autoFocus={autoFocus}
      />
    </div>
  );
}

function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: ReactNode;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </div>
  );
}

function Check({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="row" style={{ gap: 8, cursor: "pointer", alignItems: "center" }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="text-sm">{label}</span>
    </label>
  );
}
