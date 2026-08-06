"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { useConfirm } from "../../../components/ConfirmDialog";
import { useToast } from "../../../components/Toast";
import { formatCep, formatCpf } from "../../../lib/br-doc";
import {
  deleteSaleAction,
  loadSaleAction,
  saveSaleAction,
  type SaleFormInput,
} from "./actions";
import type { Broker, PaymentMethod, Property, Sale } from "../../../lib/api";

/**
 * Cadastro da Venda do imóvel — espelha a tela legada "Vendas": comprador,
 * cônjuge, forma de pagamento, comissão e valor.
 *
 * Os dados do comprador são digitados aqui e gravados na própria venda, sem
 * vínculo com o cadastro de pessoas: o que vai para a escritura é o que foi
 * acertado no dia do fechamento, e editar a ficha de alguém meses depois não
 * pode reescrever o que já foi lavrado.
 *
 * Salvar dispara o fechamento no backend — o imóvel passa a VENDIDO e as
 * comissões (imobiliária + corretor) nascem a partir de Valor × Comissão.
 *
 * Abre POR CIMA do formulário de imóvel (zIndex acima do modal do form, como a
 * vistoria e o seletor de proprietários).
 */

const EMPTY: SaleFormInput = {
  soldAt: "",
  buyerName: "",
  buyerNationality: "BRASILEIRA",
  buyerMaritalStatus: "SOLTEIRO",
  buyerOccupation: "",
  buyerAddress: "",
  buyerDistrict: "",
  buyerCity: "",
  buyerState: "",
  buyerZip: "",
  buyerCpf: "",
  buyerRg: "",
  spouseName: "",
  spouseNationality: "",
  spouseOccupation: "",
  spouseCpf: "",
  spouseRg: "",
  marriageRegime: "",
  paymentMethodId: "",
  paymentNotes: "",
  commissionPercent: "",
  valueReais: "",
  brokerId: "",
};

const MARITAL_STATUS = [
  { value: "SOLTEIRO", label: "Solteiro(a)" },
  { value: "CASADO", label: "Casado(a)" },
  { value: "DIVORCIADO", label: "Divorciado(a)" },
  { value: "VIUVO", label: "Viúvo(a)" },
  { value: "UNIAO_ESTAVEL", label: "União estável" },
];

const UFS = [
  "AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG",
  "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO",
];

const money = (cents: number | null | undefined) =>
  cents != null ? (cents / 100).toFixed(2).replace(".", ",") : "";
const txt = (s: string | null | undefined) => s ?? "";

/** Preenche o formulário a partir de uma venda já registrada. */
function fromSale(s: Sale): SaleFormInput {
  return {
    soldAt: txt(s.soldAt),
    buyerName: s.buyerName,
    buyerNationality: txt(s.buyerNationality),
    buyerMaritalStatus: txt(s.buyerMaritalStatus),
    buyerOccupation: txt(s.buyerOccupation),
    buyerAddress: txt(s.buyerAddress),
    buyerDistrict: txt(s.buyerDistrict),
    buyerCity: txt(s.buyerCity),
    buyerState: txt(s.buyerState),
    buyerZip: txt(s.buyerZip),
    buyerCpf: txt(s.buyerCpf),
    buyerRg: txt(s.buyerRg),
    spouseName: txt(s.spouseName),
    spouseNationality: txt(s.spouseNationality),
    spouseOccupation: txt(s.spouseOccupation),
    spouseCpf: txt(s.spouseCpf),
    spouseRg: txt(s.spouseRg),
    marriageRegime: txt(s.marriageRegime),
    paymentMethodId: txt(s.paymentMethodId),
    paymentNotes: txt(s.paymentNotes),
    commissionPercent: String(s.commissionPercent).replace(".", ","),
    valueReais: money(s.valueCents),
    brokerId: txt(s.brokerId),
  };
}

interface ViaCepResponse {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

export default function SaleFormModal({
  property,
  onClose,
}: {
  property: Property;
  onClose: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);
  const [form, setForm] = useState<SaleFormInput>(EMPTY);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [brokers, setBrokers] = useState<Broker[]>([]);

  const set = (patch: Partial<SaleFormInput>) => setForm((f) => ({ ...f, ...patch }));

  /**
   * Preço de venda do cadastro. O imóvel guarda UM preço (`priceCents`) e é a
   * finalidade que diz o que ele significa — a mesma regra do merge field
   * `imovel.valor_venda`. Fora da venda, aquele número é um aluguel.
   */
  const askingPriceCents = property.purpose === "sale" ? property.priceCents : null;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadSaleAction(property.id).then((res) => {
      if (!alive) return;
      if (!res.ok) {
        setError(res.error ?? "Não foi possível carregar a venda.");
      } else {
        setSale(res.sale ?? null);
        // Venda nova nasce com o preço pedido no cadastro do imóvel — é o
        // ponto de partida da negociação, e digitá-lo de novo só convida ao
        // erro de digitação. Continua editável: o que fecha o negócio é o
        // valor acordado, quase sempre diferente do anunciado.
        //
        // Venda JÁ registrada não é reescrita pelo cadastro: ali o valor é o
        // que foi fechado, e mexer no anúncio depois não pode alterá-lo.
        setForm(
          res.sale
            ? fromSale(res.sale)
            : { ...EMPTY, valueReais: money(askingPriceCents) },
        );
        setPaymentMethods(res.paymentMethods ?? []);
        setBrokers(res.brokers ?? []);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [property.id, askingPriceCents]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  /** Endereço do COMPRADOR pelo CEP — mesmo auxílio do cadastro do imóvel. */
  async function lookupCep(cepRaw: string) {
    const cep = (cepRaw ?? "").replace(/\D/g, "");
    if (cep.length !== 8) return;
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = (await res.json()) as ViaCepResponse;
      if (data.erro) return;
      set({
        buyerAddress: data.logradouro ?? form.buyerAddress,
        buyerDistrict: data.bairro ?? form.buyerDistrict,
        buyerCity: data.localidade ?? form.buyerCity,
        buyerState: data.uf ?? form.buyerState,
      });
    } catch {
      /* silencioso — o usuário pode preencher à mão */
    }
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await saveSaleAction(property.id, sale?.id ?? null, form);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar a venda.");
        return;
      }
      toast.success(sale ? "Venda atualizada." : "Venda registrada — imóvel marcado como vendido.");
      router.refresh();
      onClose();
    });
  }

  async function handleDelete() {
    if (!sale) return;
    const ok = await confirm({
      eyebrow: "Exclusão",
      title: "Desfazer esta venda?",
      message:
        "O imóvel volta para Disponível. As comissões já lançadas permanecem no financeiro — cancele-as por lá, se for o caso.",
      confirmLabel: "Desfazer venda",
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteSaleAction(sale.id);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível desfazer a venda.");
        return;
      }
      toast.success("Venda desfeita — imóvel de volta à vitrine.");
      router.refresh();
      onClose();
    });
  }

  const enderecoImovel = [property.address, property.number].filter(Boolean).join(", ");

  const modal = (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "5vh 16px",
        overflowY: "auto",
        zIndex: 2500,
      }}
    >
      <div
        className="card card-pad stack modal-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{ gap: 14, width: 1040, maxWidth: "96vw", boxShadow: "0 20px 60px rgba(0,0,0,.30)" }}
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="insp-title">
            <span className="insp-title-chip">
              <Icon name="creci" size={16} />
            </span>
            <span className="insp-title-text">Venda do Imóvel</span>
          </span>
          <button className="icon-btn" type="button" aria-label="Fechar" onClick={onClose}>
            <Icon name="close" size={15} />
          </button>
        </div>

        {/* Cabeçalho só-leitura: Nro/Cód/Endereço/Bairro da tela legada saem do
            imóvel — a venda não os redigita. */}
        <div className="insp-hero">
          <div className="insp-hero-grid">
            <div className="insp-hero-seq">
              <span>Nº</span>
              <strong>{sale?.code ?? "—"}</strong>
            </div>
            <div className="insp-hero-sep" />
            <div className="insp-hero-item">
              <div className="insp-hero-label">Imóvel</div>
              <div className="insp-hero-value">{property.code ?? "—"}</div>
            </div>
            <div className="insp-hero-item grow">
              <div className="insp-hero-label">Endereço</div>
              <div className="insp-hero-value">{enderecoImovel || "—"}</div>
            </div>
            <div className="insp-hero-item">
              <div className="insp-hero-label">Bairro</div>
              <div className="insp-hero-value">{property.district ?? "—"}</div>
            </div>
          </div>
        </div>

        <div className="modal-scroll">
          {loading ? (
            <div className="row" style={{ gap: 8, padding: "24px 0", justifyContent: "center" }}>
              <Icon name="loader" size={16} className="spin" />
              <span className="subtle text-sm">Carregando…</span>
            </div>
          ) : (
            <div className="stack" style={{ gap: 12 }}>
              {/* ── Comprador ──────────────────────────────────────── */}
              <div className="stack" style={{ gap: 12 }}>
                <span className="text-sm strong">Comprador</span>
                <div className="grid grid-3" style={{ gap: 12 }}>
                  <Text label="Comprador" value={form.buyerName} onChange={(v) => set({ buyerName: v })} autoFocus maxLength={200} />
                  <Text label="Nacionalidade" value={form.buyerNationality} onChange={(v) => set({ buyerNationality: v })} maxLength={60} />
                  <Select label="Estado Civil" value={form.buyerMaritalStatus} onChange={(v) => set({ buyerMaritalStatus: v })}>
                    <option value="">—</option>
                    {MARITAL_STATUS.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </Select>
                </div>
                <div className="grid grid-3" style={{ gap: 12 }}>
                  <Text label="Profissão" value={form.buyerOccupation} onChange={(v) => set({ buyerOccupation: v })} maxLength={120} />
                  <Text
                    label="CEP"
                    value={form.buyerZip}
                    onChange={(v) => set({ buyerZip: formatCep(v) })}
                    onBlur={(v) => void lookupCep(v)}
                    inputMode="numeric"
                    maxLength={9}
                  />
                  <Text label="Endereço" value={form.buyerAddress} onChange={(v) => set({ buyerAddress: v })} maxLength={200} />
                </div>
                <div className="grid grid-3" style={{ gap: 12 }}>
                  <Text label="Bairro" value={form.buyerDistrict} onChange={(v) => set({ buyerDistrict: v })} maxLength={120} />
                  <Text label="Cidade" value={form.buyerCity} onChange={(v) => set({ buyerCity: v })} maxLength={120} />
                  <Select label="UF" value={form.buyerState} onChange={(v) => set({ buyerState: v })}>
                    <option value="">—</option>
                    {UFS.map((uf) => (
                      <option key={uf} value={uf}>{uf}</option>
                    ))}
                  </Select>
                </div>
                <div className="grid grid-2" style={{ gap: 12 }}>
                  <Text
                    label="CPF"
                    value={form.buyerCpf}
                    onChange={(v) => set({ buyerCpf: formatCpf(v) })}
                    inputMode="numeric"
                    maxLength={14}
                  />
                  <Text label="RG" value={form.buyerRg} onChange={(v) => set({ buyerRg: v })} maxLength={20} />
                </div>
              </div>

              {/* ── Cônjuge ────────────────────────────────────────── */}
              <div className="stack" style={{ gap: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <span className="text-sm strong">Cônjuge</span>
                <div className="grid grid-3" style={{ gap: 12 }}>
                  <Text label="Cônjuge" value={form.spouseName} onChange={(v) => set({ spouseName: v })} maxLength={200} />
                  <Text label="Nacionalidade" value={form.spouseNationality} onChange={(v) => set({ spouseNationality: v })} maxLength={60} />
                  <Text label="Profissão" value={form.spouseOccupation} onChange={(v) => set({ spouseOccupation: v })} maxLength={120} />
                </div>
                <div className="grid grid-3" style={{ gap: 12 }}>
                  <Text
                    label="CPF"
                    value={form.spouseCpf}
                    onChange={(v) => set({ spouseCpf: formatCpf(v) })}
                    inputMode="numeric"
                    maxLength={14}
                  />
                  <Text label="RG" value={form.spouseRg} onChange={(v) => set({ spouseRg: v })} maxLength={20} />
                  <Text label="Regime de Casamento" value={form.marriageRegime} onChange={(v) => set({ marriageRegime: v })} maxLength={120} />
                </div>
              </div>

              {/* ── Negócio ────────────────────────────────────────── */}
              <div className="stack" style={{ gap: 12, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                <span className="text-sm strong">Negócio</span>
                <div className="grid grid-2" style={{ gap: 12 }}>
                  <div className="stack" style={{ gap: 12 }}>
                    <Select label="Forma de Pagamento" value={form.paymentMethodId} onChange={(v) => set({ paymentMethodId: v })}>
                      <option value="">—</option>
                      {paymentMethods.map((m) => (
                        <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
                      ))}
                    </Select>
                    <Text label="Valor (R$)" value={form.valueReais} onChange={(v) => set({ valueReais: v })} inputMode="decimal" placeholder="0,00" />
                    <Text label="Comissão (%)" value={form.commissionPercent} onChange={(v) => set({ commissionPercent: v })} inputMode="decimal" placeholder="0,00" />
                    <Text label="Data da Venda" value={form.soldAt} onChange={(v) => set({ soldAt: v })} type="date" />
                    {/* O corretor não estava na tela legada, mas é ele que
                        divide a comissão: o percentual do cadastro dele vira a
                        parte que sai, e o resto fica com a imobiliária. */}
                    <Select label="Corretor" value={form.brokerId} onChange={(v) => set({ brokerId: v })}>
                      <option value="">—</option>
                      {brokers.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="field" style={{ display: "flex", flexDirection: "column" }}>
                    <label>Observações do Pagamento</label>
                    <textarea
                      className="input"
                      value={form.paymentNotes}
                      onChange={(e) => set({ paymentNotes: e.target.value })}
                      maxLength={4000}
                      style={{ flex: 1, minHeight: 200, resize: "vertical", fontFamily: "inherit" }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {error && (
          <span className="text-sm" style={{ color: "var(--danger, #dc2626)" }}>
            {error}
          </span>
        )}

        <div
          className="row"
          style={{
            justifyContent: "space-between",
            gap: 8,
            borderTop: "1px solid var(--border)",
            paddingTop: 12,
          }}
        >
          <div className="row" style={{ gap: 8 }}>
            {sale && (
              <button
                className="btn btn-outline btn-sm"
                type="button"
                onClick={() => void handleDelete()}
                disabled={pending}
              >
                <Icon name="trash" size={14} /> Desfazer Venda
              </button>
            )}
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-ghost btn-sm" type="button" onClick={onClose} disabled={pending}>
              Fechar
            </button>
            <button
              className="btn btn-primary btn-sm"
              type="button"
              onClick={submit}
              disabled={pending || loading}
            >
              {pending ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}

/* ------------------------------------------------------------- Campos */

function Text({
  label,
  value,
  onChange,
  onBlur,
  placeholder,
  inputMode,
  maxLength,
  type,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: (v: string) => void;
  placeholder?: string;
  inputMode?: "numeric" | "decimal" | "text";
  maxLength?: number;
  type?: string;
  autoFocus?: boolean;
}) {
  return (
    <div className="field">
      <label>{label}</label>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur ? (e) => onBlur(e.target.value) : undefined}
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
