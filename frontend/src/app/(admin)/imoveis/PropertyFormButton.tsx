"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { formatCep } from "../../../lib/br-doc";
import type { Property, PropertyPhoto } from "../../../lib/api";
import {
  addOwnerAction,
  addPhotoAction,
  createPropertyAction,
  listPhotosAction,
  removeOwnerAction,
  removePhotoAction,
  updatePropertyAction,
  type PropertyFormInput,
} from "./actions";

/**
 * Lê um arquivo de imagem, redimensiona (lado maior ≤ maxDim) e comprime em
 * JPEG — devolve um data URL leve para enviar/guardar embutido (Fase 0).
 */
async function fileToDataUrl(file: File, maxDim = 1400, quality = 0.72): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/jpeg", quality);
}

/** Item de dropdown (id + rótulo) para tipos/condomínios/bairros/funcionários. */
export interface Opt {
  id: string;
  label: string;
}

const STREET_TYPES = ["Rua", "Avenida", "Alameda", "Travessa", "Praça", "Rodovia", "Estrada", "Viela", "Largo"];

const EMPTY: PropertyFormInput = {
  title: "",
  purpose: "rent",
  status: "available",
  propertyTypeId: "",
  condominiumId: "",
  contractNumber: "",
  isCommercial: false,
  streetType: "",
  zip: "",
  address: "",
  district: "",
  city: "",
  state: "",
  keysLocation: "",
  hasSign: false,
  positionFront: false,
  positionBack: false,
  bedrooms: "",
  builtArea: "",
  landArea: "",
  floorInfo: "",
  ceilingInfo: "",
  electricityMeter: "",
  waterMeter: "",
  dependencies: "",
  allowPets: false,
  allowStudents: false,
  priceReais: "",
  condoFeeReais: "",
  iptuReais: "",
  iptuChargedTo: "",
  iptuReimburseOwner: false,
  iptuInstallments: "",
  iptuInstallmentReais: "",
  adminFeePercent: "",
  chargeAdminFee: false,
  isGuaranteed: false,
  leaseTermMonths: "",
  leaseStart: "",
  penaltyInfo: "",
  hasCommission: false,
  commissionType: "",
  entryDate: "",
  brokerId: "",
  capturerId: "",
  extraData: "",
  publishWeb: false,
  hasPhotos: false,
  notes: "",
};

const money = (cents: number | null | undefined) =>
  cents != null ? (cents / 100).toFixed(2).replace(".", ",") : "";
const numStr = (n: number | null | undefined) =>
  n != null ? String(n).replace(".", ",") : "";
const txt = (s: string | null | undefined) => s ?? "";

/** Preenche o formulário a partir de um imóvel existente (modo edição). */
function fromProperty(p: Property): PropertyFormInput {
  return {
    title: p.title,
    purpose: p.purpose ?? "rent",
    status: p.status,
    propertyTypeId: txt(p.propertyTypeId),
    condominiumId: txt(p.condominiumId),
    contractNumber: txt(p.contractNumber),
    isCommercial: !!p.isCommercial,
    streetType: txt(p.streetType),
    zip: txt(p.zip),
    address: txt(p.address),
    district: txt(p.district),
    city: txt(p.city),
    state: txt(p.state),
    keysLocation: txt(p.keysLocation),
    hasSign: !!p.hasSign,
    positionFront: !!p.positionFront,
    positionBack: !!p.positionBack,
    bedrooms: numStr(p.bedrooms),
    builtArea: numStr(p.builtArea),
    landArea: numStr(p.landArea),
    floorInfo: txt(p.floorInfo),
    ceilingInfo: txt(p.ceilingInfo),
    electricityMeter: txt(p.electricityMeter),
    waterMeter: txt(p.waterMeter),
    dependencies: txt(p.dependencies),
    allowPets: !!p.allowPets,
    allowStudents: !!p.allowStudents,
    priceReais: money(p.priceCents),
    condoFeeReais: money(p.condoFeeCents),
    iptuReais: money(p.iptuCents),
    iptuChargedTo: txt(p.iptuChargedTo),
    iptuReimburseOwner: !!p.iptuReimburseOwner,
    iptuInstallments: numStr(p.iptuInstallments),
    iptuInstallmentReais: money(p.iptuInstallmentCents),
    adminFeePercent: numStr(p.adminFeePercent),
    chargeAdminFee: !!p.chargeAdminFee,
    isGuaranteed: !!p.isGuaranteed,
    leaseTermMonths: numStr(p.leaseTermMonths),
    leaseStart: txt(p.leaseStart),
    penaltyInfo: txt(p.penaltyInfo),
    hasCommission: !!p.hasCommission,
    commissionType: txt(p.commissionType),
    entryDate: txt(p.entryDate),
    brokerId: txt(p.brokerId),
    capturerId: txt(p.capturerId),
    extraData: txt(p.extraData),
    publishWeb: !!p.publishWeb,
    hasPhotos: !!p.hasPhotos,
    notes: txt(p.notes),
  };
}

const TABS = [
  { id: "dados", label: "Dados" },
  { id: "endereco", label: "Endereço" },
  { id: "caracteristicas", label: "Características" },
  { id: "valores", label: "Valores" },
  { id: "locacao", label: "Locação & Comissão" },
  { id: "captacao", label: "Captação & Obs" },
  { id: "proprietarios", label: "Proprietários" },
  { id: "fotos", label: "Fotos" },
] as const;
type TabId = (typeof TABS)[number]["id"];

interface Props {
  property?: Property;
  types: Opt[];
  condominiums: Opt[];
  districts: Opt[];
  employees: Opt[];
  /** Pessoas com papel LOCADOR, candidatas a proprietário. */
  ownerCandidates: Opt[];
  /** Desabilita o gatilho (ex.: backend offline). */
  disabled?: boolean;
}

interface ViaCepResponse {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

/**
 * Botão + modal em abas do cadastro "Imóveis a Alugar" (paridade com a tela
 * legada). Serve para criar (`property` ausente) e editar. A aba Proprietários
 * gere o vínculo imóvel↔dono (só no modo edição — precisa do id do imóvel).
 */
export function PropertyFormButton({ property, types, condominiums, districts, employees, ownerCandidates, disabled }: Props) {
  const isEdit = !!property;
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [ownerPending, startOwnerTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [tab, setTab] = useState<TabId>("dados");
  const [form, setForm] = useState<PropertyFormInput>(EMPTY);
  const [error, setError] = useState<string | null>(null);
  const [cepLoading, setCepLoading] = useState(false);
  // Estado local da aba Proprietários (vínculo é imediato, via server action).
  const [ownerPersonId, setOwnerPersonId] = useState("");
  const [ownerShare, setOwnerShare] = useState("100");
  const [ownerError, setOwnerError] = useState<string | null>(null);
  // Estado local da aba Fotos.
  const [photos, setPhotos] = useState<PropertyPhoto[]>([]);
  const [photosLoaded, setPhotosLoaded] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  // Índice da foto aberta no lightbox (null = fechado).
  const [lightbox, setLightbox] = useState<number | null>(null);

  useEffect(() => setMounted(true), []);

  const showPrev = () => setLightbox((i) => (i === null ? i : (i - 1 + photos.length) % photos.length));
  const showNext = () => setLightbox((i) => (i === null ? i : (i + 1) % photos.length));

  // Navegação por teclado no lightbox (← → Esc).
  useEffect(() => {
    if (lightbox === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setLightbox(null);
      else if (e.key === "ArrowLeft") showPrev();
      else if (e.key === "ArrowRight") showNext();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lightbox, photos.length]);

  // Carrega as fotos ao abrir a aba (lazy — não pesa o list nem as outras abas).
  useEffect(() => {
    if (!open || !property || tab !== "fotos" || photosLoaded) return;
    let alive = true;
    (async () => {
      const res = await listPhotosAction(property.id);
      if (!alive) return;
      if (res.ok) setPhotos(res.photos);
      else setPhotoError(res.error ?? "Falha ao carregar fotos.");
      setPhotosLoaded(true);
    })();
    return () => {
      alive = false;
    };
  }, [open, property, tab, photosLoaded]);

  async function refreshPhotos() {
    if (!property) return;
    const res = await listPhotosAction(property.id);
    if (res.ok) setPhotos(res.photos);
  }

  async function onPickPhotos(files: FileList | null) {
    if (!property || !files || files.length === 0) return;
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith("image/")) continue;
        const dataUrl = await fileToDataUrl(file);
        const res = await addPhotoAction(property.id, dataUrl);
        if (!res.ok) {
          setPhotoError(res.error ?? "Falha ao enviar foto.");
          break;
        }
      }
      await refreshPhotos();
    } catch {
      setPhotoError("Não foi possível processar a imagem.");
    } finally {
      setPhotoBusy(false);
    }
  }

  async function onRemovePhoto(photoId: string) {
    if (!property) return;
    setPhotoError(null);
    setPhotoBusy(true);
    try {
      const res = await removePhotoAction(property.id, photoId);
      if (!res.ok) {
        setPhotoError(res.error ?? "Falha ao remover foto.");
        return;
      }
      await refreshPhotos();
    } finally {
      setPhotoBusy(false);
    }
  }

  const set = (patch: Partial<PropertyFormInput>) => setForm((f) => ({ ...f, ...patch }));

  // Donos já vinculados (vêm do prop `property`, atualizado a cada router.refresh).
  const owners = property?.owners ?? [];
  const availableOwners = ownerCandidates.filter((c) => !owners.some((o) => o.personId === c.id));

  function addOwner() {
    if (!property || !ownerPersonId) return;
    setOwnerError(null);
    startOwnerTransition(async () => {
      const res = await addOwnerAction(property.id, ownerPersonId, Number(ownerShare) || 100);
      if (!res.ok) {
        setOwnerError(res.error ?? "Falha ao vincular.");
        return;
      }
      setOwnerPersonId("");
      setOwnerShare("100");
      router.refresh();
    });
  }

  function removeOwner(personId: string) {
    if (!property) return;
    setOwnerError(null);
    startOwnerTransition(async () => {
      const res = await removeOwnerAction(property.id, personId);
      if (!res.ok) {
        setOwnerError(res.error ?? "Falha ao remover.");
        return;
      }
      router.refresh();
    });
  }

  async function lookupCep(cepRaw: string) {
    const cep = (cepRaw ?? "").replace(/\D/g, "");
    if (cep.length !== 8) return;
    setCepLoading(true);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = (await res.json()) as ViaCepResponse;
      if (data.erro) return;
      set({
        address: data.logradouro ?? form.address,
        district: data.bairro ?? form.district,
        city: data.localidade ?? form.city,
        state: data.uf ?? form.state,
      });
    } catch {
      /* silencioso — o usuário pode preencher à mão */
    } finally {
      setCepLoading(false);
    }
  }

  function openModal() {
    setForm(property ? fromProperty(property) : EMPTY);
    setTab("dados");
    setError(null);
    setOwnerError(null);
    setOwnerPersonId("");
    setOwnerShare("100");
    setPhotos([]);
    setPhotosLoaded(false);
    setPhotoError(null);
    setPhotoBusy(false);
    setLightbox(null);
    setOpen(true);
  }

  function close() {
    setOpen(false);
    setError(null);
  }

  function submit() {
    setError(null);
    if (form.title.trim().length < 3) {
      setTab("dados");
      setError("Informe o título/descrição do imóvel (mín. 3 caracteres).");
      return;
    }
    startTransition(async () => {
      const res = property
        ? await updatePropertyAction(property.id, form)
        : await createPropertyAction(form);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  }

  const modal = (
    <div
      onClick={close}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "5vh 16px",
        overflowY: "auto",
        zIndex: 2000,
      }}
    >
      <div
        className="card card-pad stack"
        onClick={(e) => e.stopPropagation()}
        style={{ gap: 14, width: 920, maxWidth: "96vw", boxShadow: "0 20px 60px rgba(0,0,0,.30)" }}
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>
            {isEdit ? "Editar Imóvel" : "Novo Imóvel"}
            {property?.code != null && <span className="subtle text-sm"> · Cód. {property.code}</span>}
          </strong>
          <button className="icon-btn" type="button" aria-label="Fechar" onClick={close}>
            <Icon name="close" size={15} />
          </button>
        </div>

        {/* Abas */}
        <div className="row" style={{ gap: 4, flexWrap: "wrap", borderBottom: "1px solid var(--border)" }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="btn btn-sm"
              onClick={() => setTab(t.id)}
              style={{
                borderRadius: 0,
                background: "transparent",
                whiteSpace: "nowrap",
                flex: "0 0 auto",
                borderBottom: tab === t.id ? "2px solid var(--primary)" : "2px solid transparent",
                color: tab === t.id ? "var(--primary)" : "var(--muted-text, #64748b)",
                fontWeight: tab === t.id ? 600 : 500,
              }}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* ── Aba: Dados ─────────────────────────────────────────── */}
        {tab === "dados" && (
          <div className="stack" style={{ gap: 12 }}>
            <Text label="Título / Descrição *" value={form.title} onChange={(v) => set({ title: v })} placeholder="Apartamento 2 quartos no Centro" autoFocus />
            <div className="grid grid-3" style={{ gap: 12 }}>
              <Select label="Tipo" value={form.propertyTypeId} onChange={(v) => set({ propertyTypeId: v })}>
                <option value="">—</option>
                {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </Select>
              <Select label="Finalidade" value={form.purpose} onChange={(v) => set({ purpose: v })}>
                <option value="rent">Locação</option>
                <option value="sale">Venda</option>
                <option value="season">Temporada</option>
              </Select>
              <Select label="Situação" value={form.status} onChange={(v) => set({ status: v })}>
                <option value="available">Disponível</option>
                <option value="reserved">Reservado</option>
                <option value="rented">Alugado</option>
                <option value="sold">Vendido</option>
                <option value="inactive">Suspenso</option>
              </Select>
            </div>
            <div className="grid grid-3" style={{ gap: 12 }}>
              <Select label="Condomínio" value={form.condominiumId} onChange={(v) => set({ condominiumId: v })}>
                <option value="">—</option>
                {condominiums.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </Select>
              <Text label="Contrato" value={form.contractNumber} onChange={(v) => set({ contractNumber: v })} />
              <div className="field" style={{ justifyContent: "flex-end", paddingBottom: 8 }}>
                <Check label="Comércio" checked={form.isCommercial} onChange={(v) => set({ isCommercial: v })} />
              </div>
            </div>
          </div>
        )}

        {/* ── Aba: Endereço ──────────────────────────────────────── */}
        {tab === "endereco" && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="grid grid-3" style={{ gap: 12 }}>
              <div className="field">
                <label>CEP {cepLoading && <span className="text-xs subtle">buscando…</span>}</label>
                <input
                  className="input"
                  value={form.zip}
                  inputMode="numeric"
                  maxLength={9}
                  placeholder="00000-000"
                  onChange={(e) => set({ zip: formatCep(e.target.value) })}
                  onBlur={(e) => lookupCep(e.target.value)}
                />
              </div>
              <Select label="Logradouro" value={form.streetType} onChange={(v) => set({ streetType: v })}>
                <option value="">—</option>
                {STREET_TYPES.map((s) => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Text label="Endereço" value={form.address} onChange={(v) => set({ address: v })} placeholder="Nome + número" />
            </div>
            <div className="grid grid-3" style={{ gap: 12 }}>
              <div className="field">
                <label>Bairro</label>
                <input
                  className="input"
                  list="districts-list"
                  value={form.district}
                  onChange={(e) => set({ district: e.target.value })}
                />
                <datalist id="districts-list">
                  {districts.map((d) => <option key={d.id} value={d.label} />)}
                </datalist>
              </div>
              <Text label="Cidade" value={form.city} onChange={(v) => set({ city: v })} />
              <Text label="UF" value={form.state} onChange={(v) => set({ state: v.toUpperCase().slice(0, 2) })} maxLength={2} />
            </div>
            <div className="grid grid-2" style={{ gap: 12 }}>
              <Text label="Chaves" value={form.keysLocation} onChange={(v) => set({ keysLocation: v })} placeholder="Onde estão as chaves" />
              <div className="field">
                <label>Localização</label>
                <div className="row" style={{ gap: 16, paddingTop: 6 }}>
                  <Check label="Placa" checked={form.hasSign} onChange={(v) => set({ hasSign: v })} />
                  <Check label="Frente" checked={form.positionFront} onChange={(v) => set({ positionFront: v })} />
                  <Check label="Fundos" checked={form.positionBack} onChange={(v) => set({ positionBack: v })} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Aba: Características ─────────────────────────────────── */}
        {tab === "caracteristicas" && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="grid grid-3" style={{ gap: 12 }}>
              <Text label="Quartos" value={form.bedrooms} onChange={(v) => set({ bedrooms: v })} inputMode="numeric" />
              <Text label="Área construída (m²)" value={form.builtArea} onChange={(v) => set({ builtArea: v })} inputMode="decimal" />
              <Text label="Área terreno (m²)" value={form.landArea} onChange={(v) => set({ landArea: v })} inputMode="decimal" />
            </div>
            <div className="grid grid-2" style={{ gap: 12 }}>
              <Text label="Piso" value={form.floorInfo} onChange={(v) => set({ floorInfo: v })} />
              <Text label="Teto" value={form.ceilingInfo} onChange={(v) => set({ ceilingInfo: v })} />
            </div>
            <div className="grid grid-2" style={{ gap: 12 }}>
              <Text label="Luz (instalação)" value={form.electricityMeter} onChange={(v) => set({ electricityMeter: v })} />
              <Text label="Água (instalação)" value={form.waterMeter} onChange={(v) => set({ waterMeter: v })} />
            </div>
            <Text label="Dependências" value={form.dependencies} onChange={(v) => set({ dependencies: v })} placeholder="Ex.: 2 vagas, área de serviço, sacada" />
            <div className="row" style={{ gap: 20, paddingTop: 4 }}>
              <Check label="Aceita animais" checked={form.allowPets} onChange={(v) => set({ allowPets: v })} />
              <Check label="Aceita estudantes" checked={form.allowStudents} onChange={(v) => set({ allowStudents: v })} />
            </div>
          </div>
        )}

        {/* ── Aba: Valores ───────────────────────────────────────── */}
        {tab === "valores" && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="grid grid-3" style={{ gap: 12 }}>
              <Text label="Preço / Aluguel (R$)" value={form.priceReais} onChange={(v) => set({ priceReais: v })} inputMode="decimal" placeholder="0,00" />
              <Text label="Valor condomínio (R$)" value={form.condoFeeReais} onChange={(v) => set({ condoFeeReais: v })} inputMode="decimal" placeholder="0,00" />
              <Text label="IPTU (R$)" value={form.iptuReais} onChange={(v) => set({ iptuReais: v })} inputMode="decimal" placeholder="0,00" />
            </div>
            <div className="grid grid-3" style={{ gap: 12 }}>
              <Select label="Descontar IPTU de" value={form.iptuChargedTo} onChange={(v) => set({ iptuChargedTo: v })}>
                <option value="">—</option>
                <option value="LOCATARIO">Locatário</option>
                <option value="LOCADOR">Locador</option>
              </Select>
              <Text label="Nº parcelas IPTU" value={form.iptuInstallments} onChange={(v) => set({ iptuInstallments: v })} inputMode="numeric" />
              <Text label="Valor parcela IPTU (R$)" value={form.iptuInstallmentReais} onChange={(v) => set({ iptuInstallmentReais: v })} inputMode="decimal" placeholder="0,00" />
            </div>
            <div className="grid grid-2" style={{ gap: 12 }}>
              <Text label="Taxa de administração (%)" value={form.adminFeePercent} onChange={(v) => set({ adminFeePercent: v })} inputMode="decimal" placeholder="10" />
              <div className="field">
                <label>Encargos</label>
                <div className="row" style={{ gap: 16, paddingTop: 6, flexWrap: "wrap" }}>
                  <Check label="Cobrar taxa adm." checked={form.chargeAdminFee} onChange={(v) => set({ chargeAdminFee: v })} />
                  <Check label="Ressarcir locador (IPTU)" checked={form.iptuReimburseOwner} onChange={(v) => set({ iptuReimburseOwner: v })} />
                  <Check label="Garantido" checked={form.isGuaranteed} onChange={(v) => set({ isGuaranteed: v })} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Aba: Locação & Comissão ────────────────────────────── */}
        {tab === "locacao" && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="grid grid-3" style={{ gap: 12 }}>
              <Text label="Prazo de locação (meses)" value={form.leaseTermMonths} onChange={(v) => set({ leaseTermMonths: v })} inputMode="numeric" />
              <Text label="Início" value={form.leaseStart} onChange={(v) => set({ leaseStart: v })} type="date" />
              <Text label="Entrada" value={form.entryDate} onChange={(v) => set({ entryDate: v })} type="date" />
            </div>
            <Text label="Multa" value={form.penaltyInfo} onChange={(v) => set({ penaltyInfo: v })} placeholder="Ex.: 3 aluguéis" />
            <div className="grid grid-2" style={{ gap: 12 }}>
              <Text label="Tipo de comissão" value={form.commissionType} onChange={(v) => set({ commissionType: v })} placeholder="Ex.: 1º mês de aluguel" />
              <div className="field">
                <label>Comissão</label>
                <div className="row" style={{ paddingTop: 6 }}>
                  <Check label="Cobra comissão" checked={form.hasCommission} onChange={(v) => set({ hasCommission: v })} />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ── Aba: Captação & Obs ────────────────────────────────── */}
        {tab === "captacao" && (
          <div className="stack" style={{ gap: 12 }}>
            <div className="grid grid-2" style={{ gap: 12 }}>
              <Select label="Corretor" value={form.brokerId} onChange={(v) => set({ brokerId: v })}>
                <option value="">—</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
              </Select>
              <Select label="Captador" value={form.capturerId} onChange={(v) => set({ capturerId: v })}>
                <option value="">—</option>
                {employees.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
              </Select>
            </div>
            <Text label="Dados" value={form.extraData} onChange={(v) => set({ extraData: v })} placeholder="Informação livre" />
            <div className="row" style={{ gap: 20, paddingTop: 2 }}>
              <Check label="Publicar / Internet" checked={form.publishWeb} onChange={(v) => set({ publishWeb: v })} />
              <Check label="Com foto" checked={form.hasPhotos} onChange={(v) => set({ hasPhotos: v })} />
            </div>
            <div className="field">
              <label>Observações</label>
              <textarea
                className="input"
                rows={4}
                value={form.notes}
                onChange={(e) => set({ notes: e.target.value })}
                style={{ resize: "vertical" }}
              />
            </div>
          </div>
        )}

        {/* ── Aba: Proprietários ─────────────────────────────────── */}
        {tab === "proprietarios" && (
          <div className="stack" style={{ gap: 12 }}>
            {!isEdit ? (
              <p className="text-sm subtle" style={{ padding: "8px 0" }}>
                <Icon name="user" size={14} /> Salve o imóvel primeiro para vincular os proprietários.
              </p>
            ) : (
              <>
                <div className="stack" style={{ gap: 8 }}>
                  <span className="text-sm strong">Donos vinculados</span>
                  {owners.length === 0 ? (
                    <span className="text-sm subtle">Nenhum proprietário vinculado.</span>
                  ) : (
                    owners.map((o) => (
                      <div
                        key={o.id}
                        className="row"
                        style={{ justifyContent: "space-between", alignItems: "center", border: "1px solid var(--border)", borderRadius: 8, padding: "8px 12px" }}
                      >
                        <span className="text-sm">
                          <span className="strong">{o.personName}</span>
                          <span className="subtle"> · {o.sharePercent}%</span>
                        </span>
                        <button
                          type="button"
                          className="icon-btn"
                          style={{ width: 28, height: 28 }}
                          aria-label={`Remover ${o.personName}`}
                          disabled={ownerPending}
                          onClick={() => removeOwner(o.personId)}
                        >
                          <Icon name={ownerPending ? "loader" : "trash"} className={ownerPending ? "spin" : undefined} size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>

                <div className="stack" style={{ gap: 8, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
                  <span className="text-sm strong">Vincular proprietário</span>
                  {availableOwners.length === 0 ? (
                    <span className="text-xs subtle">
                      Sem pessoas LOCADOR disponíveis. Cadastre-as em Proprietários (papel LOCADOR).
                    </span>
                  ) : (
                    <div className="row" style={{ gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}>
                      <div className="field" style={{ flex: "1 1 240px" }}>
                        <label>Pessoa (LOCADOR)</label>
                        <select className="input" value={ownerPersonId} onChange={(e) => setOwnerPersonId(e.target.value)}>
                          <option value="">Selecione…</option>
                          {availableOwners.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                      </div>
                      <div className="field" style={{ width: 100 }}>
                        <label>Participação %</label>
                        <input
                          className="input"
                          value={ownerShare}
                          inputMode="numeric"
                          onChange={(e) => setOwnerShare(e.target.value)}
                        />
                      </div>
                      <button
                        className="btn btn-primary btn-sm"
                        type="button"
                        disabled={ownerPending || !ownerPersonId}
                        onClick={addOwner}
                      >
                        {ownerPending ? "…" : "Vincular"}
                      </button>
                    </div>
                  )}
                  {ownerError && <span className="text-xs" style={{ color: "var(--danger, #dc2626)" }}>{ownerError}</span>}
                </div>
              </>
            )}
          </div>
        )}

        {/* ── Aba: Fotos ─────────────────────────────────────────── */}
        {tab === "fotos" && (
          <div className="stack" style={{ gap: 12 }}>
            {!isEdit ? (
              <p className="text-sm subtle" style={{ padding: "8px 0" }}>
                <Icon name="upload" size={14} /> Salve o imóvel primeiro para enviar fotos.
              </p>
            ) : (
              <>
                <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
                  <span className="text-sm strong">
                    Fotos do imóvel {photosLoaded && <span className="subtle">· {photos.length}</span>}
                  </span>
                  <label className="btn btn-primary btn-sm" style={{ cursor: photoBusy ? "default" : "pointer", opacity: photoBusy ? 0.6 : 1 }}>
                    <Icon name={photoBusy ? "loader" : "upload"} className={photoBusy ? "spin" : undefined} size={14} />
                    {photoBusy ? " Enviando…" : " Adicionar fotos"}
                    <input
                      type="file"
                      accept="image/*"
                      multiple
                      disabled={photoBusy}
                      style={{ display: "none" }}
                      onChange={(e) => {
                        void onPickPhotos(e.target.files);
                        e.target.value = ""; // permite re-selecionar o mesmo arquivo
                      }}
                    />
                  </label>
                </div>

                {!photosLoaded ? (
                  <span className="text-sm subtle">Carregando…</span>
                ) : photos.length === 0 ? (
                  <div
                    className="stack"
                    style={{ alignItems: "center", justifyContent: "center", gap: 6, padding: "28px 0", border: "1px dashed var(--border)", borderRadius: 10 }}
                  >
                    <Icon name="upload" size={22} />
                    <span className="text-sm subtle">Nenhuma foto ainda. Envie imagens (JPG, PNG, WebP).</span>
                  </div>
                ) : (
                  <div
                    className="grid"
                    style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 10 }}
                  >
                    {photos.map((ph, i) => (
                      <div
                        key={ph.id}
                        style={{ position: "relative", aspectRatio: "4 / 3", borderRadius: 10, overflow: "hidden", border: "1px solid var(--border)", background: "var(--surface, #f8fafc)" }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={ph.url}
                          alt={ph.caption ?? "Foto do imóvel"}
                          onClick={() => setLightbox(i)}
                          style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", cursor: "zoom-in" }}
                        />
                        <button
                          type="button"
                          className="icon-btn"
                          aria-label="Remover foto"
                          disabled={photoBusy}
                          onClick={(e) => { e.stopPropagation(); void onRemovePhoto(ph.id); }}
                          style={{ position: "absolute", top: 6, right: 6, width: 28, height: 28, background: "rgba(0,0,0,.55)", color: "#fff", borderRadius: 8 }}
                        >
                          <Icon name="trash" size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <span className="text-xs subtle">
                  As imagens são redimensionadas e comprimidas no navegador antes de salvar.
                </span>
                {photoError && <span className="text-xs" style={{ color: "var(--danger, #dc2626)" }}>{photoError}</span>}
              </>
            )}
          </div>
        )}

        {error && <span className="text-sm" style={{ color: "var(--danger, #dc2626)" }}>{error}</span>}

        <div className="row" style={{ justifyContent: "flex-end", gap: 8, borderTop: "1px solid var(--border)", paddingTop: 12 }}>
          <button className="btn btn-ghost btn-sm" type="button" onClick={close} disabled={pending}>
            Cancelar
          </button>
          <button className="btn btn-primary btn-sm" type="button" onClick={submit} disabled={pending}>
            {pending ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );

  const current = lightbox !== null ? photos[lightbox] : undefined;
  const lightboxEl = current && (
    <div
      onClick={() => setLightbox(null)}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.86)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 3000,
      }}
    >
      {/* Fechar */}
      <button
        type="button"
        className="icon-btn"
        aria-label="Fechar"
        onClick={(e) => { e.stopPropagation(); setLightbox(null); }}
        style={{ position: "absolute", top: 16, right: 16, width: 40, height: 40, background: "rgba(255,255,255,.12)", color: "#fff", borderRadius: 10 }}
      >
        <Icon name="close" size={20} />
      </button>

      {/* Anterior */}
      {photos.length > 1 && (
        <button
          type="button"
          className="icon-btn"
          aria-label="Foto anterior"
          onClick={(e) => { e.stopPropagation(); showPrev(); }}
          style={{ position: "absolute", left: 16, top: "50%", transform: "translateY(-50%)", width: 48, height: 48, background: "rgba(255,255,255,.12)", color: "#fff", borderRadius: "50%" }}
        >
          <Icon name="chevronRight" size={26} style={{ transform: "rotate(180deg)" }} />
        </button>
      )}

      {/* Imagem + legenda */}
      <div onClick={(e) => e.stopPropagation()} style={{ maxWidth: "90vw", maxHeight: "90vh", display: "flex", flexDirection: "column", alignItems: "center", gap: 10 }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.url}
          alt={current.caption ?? "Foto do imóvel"}
          style={{ maxWidth: "90vw", maxHeight: "82vh", objectFit: "contain", borderRadius: 8, boxShadow: "0 10px 40px rgba(0,0,0,.5)" }}
        />
        <div className="row" style={{ gap: 10, color: "rgba(255,255,255,.85)", fontSize: "0.85rem" }}>
          <span>{(lightbox ?? 0) + 1} / {photos.length}</span>
          {current.caption && <span>· {current.caption}</span>}
        </div>
      </div>

      {/* Próxima */}
      {photos.length > 1 && (
        <button
          type="button"
          className="icon-btn"
          aria-label="Próxima foto"
          onClick={(e) => { e.stopPropagation(); showNext(); }}
          style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", width: 48, height: 48, background: "rgba(255,255,255,.12)", color: "#fff", borderRadius: "50%" }}
        >
          <Icon name="chevronRight" size={26} />
        </button>
      )}
    </div>
  );

  return (
    <>
      {isEdit ? (
        <button className="icon-btn" style={{ width: 30, height: 30 }} type="button" onClick={openModal} disabled={disabled} aria-label={`Editar ${property.title}`}>
          <Icon name="edit" size={15} />
        </button>
      ) : (
        <button className="btn btn-primary btn-sm" type="button" onClick={openModal} disabled={disabled}>
          <Icon name="plus" /> Novo Imóvel
        </button>
      )}
      {open && mounted && createPortal(modal, document.body)}
      {mounted && lightbox !== null && createPortal(lightboxEl, document.body)}
    </>
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
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
