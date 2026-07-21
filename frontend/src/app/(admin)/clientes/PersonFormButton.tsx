"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { FieldBlock, TabBar } from "../../../components/ui";
import { AddressBlock } from "./AddressBlock";
import { formatCpf, formatCpfCnpj, validateCpfCnpj } from "../../../lib/br-doc";
import type { Person } from "../../../lib/api";
import {
  createPersonAction,
  loadPersonAction,
  updatePersonAction,
  type AddressInput,
  type NewPersonInput,
  type PersonRole,
} from "./actions";

const ROLES: { value: PersonRole; label: string }[] = [
  { value: "LOCADOR", label: "Locador" },
  { value: "LOCATARIO", label: "Locatário" },
  { value: "FIADOR", label: "Fiador" },
];

type TabKey = "pessoais" | "bancarios" | "residenciais" | "comerciais" | "observacoes";

/** Cada aba com a cor do seu tópico (escala compartilhada, globals.css). */
const TABS: { id: TabKey; label: string; tone: string }[] = [
  { id: "pessoais", label: "Dados Pessoais", tone: "tone-azul" },
  { id: "bancarios", label: "Dados Bancários", tone: "tone-esmeralda" },
  { id: "residenciais", label: "Dados Residenciais", tone: "tone-ciano" },
  { id: "comerciais", label: "Dados Comerciais", tone: "tone-teal" },
  { id: "observacoes", label: "Observações", tone: "tone-ardosia" },
];

function makeEmpty(defaultRoles: PersonRole[]): NewPersonInput {
  return {
    roles: [...defaultRoles],
    personType: "PF",
    fullName: "",
    cpfCnpj: "",
    rg: "",
    rgIssuer: "",
    gender: "",
    birthDate: "",
    maritalStatus: "",
    nationality: "BRASILEIRA",
    occupation: "",
    spouseName: "",
    spouseCpf: "",
    spouseRg: "",
    spouseOccupation: "",
    spouseBirthDate: "",
    bank: "",
    agency: "",
    account: "",
    holderName: "",
    paymentAuthorization: "",
    notes: "",
    references: "",
    source: "MANUAL",
    residential: {},
    commercial: {},
    intent: "",
    minPriceReais: "",
    maxPriceReais: "",
    districts: "",
    bedroomsMin: "",
  };
}

/** Só a data (YYYY-MM-DD) — `<input type="date">` não aceita ISO completo. */
const dateOnly = (v: string | null) => (v ? v.slice(0, 10) : "");

/** Extrai o bloco de endereço de um tipo para o formato do formulário. */
function addressOf(person: Person, kind: "RESIDENCIAL" | "COMERCIAL"): AddressInput {
  const a = person.addresses.find((x) => x.kind === kind);
  if (!a) return {};
  return {
    zip: a.zip ?? "",
    street: a.street ?? "",
    number: a.number ?? "",
    district: a.district ?? "",
    city: a.city ?? "",
    state: a.state ?? "",
    phone: a.phone ?? "",
    mobile: a.mobile ?? "",
    fax: a.fax ?? "",
    email: a.email ?? "",
  };
}

/** Ficha do backend → estado do formulário (com as máscaras já aplicadas). */
function toForm(person: Person): NewPersonInput {
  const personType = person.personType === "PJ" ? "PJ" : "PF";
  const profile = person.searchProfiles[0];
  const residential = addressOf(person, "RESIDENCIAL");
  // A ficha exige um contato nos dados residenciais; se a pessoa foi criada sem
  // bloco de endereço, cai no contato principal para não travar o "Salvar".
  if (!residential.email && !residential.mobile && !residential.phone) {
    residential.email = person.email ?? "";
    residential.mobile = person.mobile ?? "";
    residential.phone = person.phone ?? "";
  }
  return {
    roles: person.roles.filter((r): r is PersonRole =>
      ROLES.some((x) => x.value === r),
    ),
    personType,
    fullName: person.fullName,
    cpfCnpj: formatCpfCnpj(person.cpfCnpj ?? "", personType),
    rg: person.rg ?? "",
    rgIssuer: person.rgIssuer ?? "",
    gender: (person.gender ?? "") as NewPersonInput["gender"],
    birthDate: dateOnly(person.birthDate),
    maritalStatus: person.maritalStatus ?? "",
    nationality: person.nationality ?? "BRASILEIRA",
    occupation: person.occupation ?? "",
    spouseName: person.spouseName ?? "",
    spouseCpf: formatCpf(person.spouseCpf ?? ""),
    spouseRg: person.spouseRg ?? "",
    spouseOccupation: person.spouseOccupation ?? "",
    spouseBirthDate: dateOnly(person.spouseBirthDate),
    bank: person.bank ?? "",
    agency: person.agency ?? "",
    account: person.account ?? "",
    holderName: person.holderName ?? "",
    paymentAuthorization: person.paymentAuthorization ?? "",
    notes: person.notes ?? "",
    references: person.references ?? "",
    source: person.source,
    residential,
    commercial: addressOf(person, "COMERCIAL"),
    intent: profile?.intent ?? "",
    minPriceReais: profile?.minPriceCents ? String(profile.minPriceCents / 100) : "",
    maxPriceReais: profile?.maxPriceCents ? String(profile.maxPriceCents / 100) : "",
    districts: profile?.districts.join(", ") ?? "",
    bedroomsMin: profile?.bedroomsMin ? String(profile.bedroomsMin) : "",
  };
}

/**
 * Botão + modal com a ficha COMPLETA de pessoa (MOD-PESSOA), compartilhado pelas
 * views por papel (Proprietários/Clientes/Fiadores). `defaultRoles` pré-marca o
 * papel da tela. Paridade com a tela legada "Cadastro de Locadores": PF/PJ, RG +
 * órgão emissor, cônjuge (RG/CPF/profissão/nascimento), dados bancários +
 * autorização de recebimento, endereços residencial e comercial (com CEP/ViaCEP)
 * e observações.
 *
 * Com `person`, vira o botão de EDIÇÃO daquela linha (ícone de lápis): abre a
 * ficha carregada do backend (`GET /v1/persons/:id`, pois a listagem não traz
 * endereços) e salva via PATCH. Sem `person`, cria (POST /v1/persons).
 */
export function PersonFormButton({
  defaultRoles = [],
  label = "Novo Cadastro",
  title = "Novo Cadastro de Pessoa",
  person,
}: {
  defaultRoles?: PersonRole[];
  label?: string;
  title?: string;
  person?: { id: string; fullName: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const empty = useMemo(() => makeEmpty(defaultRoles), [defaultRoles]);
  const [form, setForm] = useState<NewPersonInput>(empty);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabKey>("pessoais");
  const [loading, setLoading] = useState(false);
  const isEdit = Boolean(person);

  useEffect(() => setMounted(true), []);

  /** Abre o modal — na edição, carrega a ficha completa antes de exibir. */
  function openModal() {
    setError(null);
    if (!person) {
      setForm(makeEmpty(defaultRoles));
      setOpen(true);
      return;
    }
    setLoading(true);
    setOpen(true);
    void loadPersonAction(person.id)
      .then((full) => {
        if (full) setForm(toForm(full));
        else setError("Não foi possível carregar a ficha.");
      })
      .catch(() => setError("Não foi possível carregar a ficha."))
      .finally(() => setLoading(false));
  }

  const set = (patch: Partial<NewPersonInput>) => setForm((f) => ({ ...f, ...patch }));

  // Validação inline do documento (CPF/CNPJ) — null = válido ou vazio (opcional).
  const docError = validateCpfCnpj(form.cpfCnpj ?? "", form.personType);

  /** Troca PF/PJ e reaplica a máscara correta ao documento já digitado. */
  const setPersonType = (personType: "PF" | "PJ") =>
    setForm((f) => ({ ...f, personType, cpfCnpj: formatCpfCnpj(f.cpfCnpj ?? "", personType) }));

  const toggleRole = (r: PersonRole) =>
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r],
    }));

  function close() {
    setOpen(false);
    setError(null);
    setTab("pessoais");
  }

  function submit() {
    setError(null);
    if (docError) {
      setError(docError);
      setTab("pessoais"); // o campo com erro (CPF/CNPJ) fica nessa aba
      return;
    }
    startTransition(async () => {
      const res = person
        ? await updatePersonAction(person.id, form)
        : await createPersonAction(form);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar.");
        return;
      }
      if (!person) setForm(makeEmpty(defaultRoles));
      setTab("pessoais");
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
        padding: "4vh 16px",
        overflowY: "auto",
        zIndex: 2000,
      }}
    >
      <div
        className="card card-pad stack modal-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{ gap: 14, width: 900, maxWidth: "96vw", boxShadow: "0 20px 60px rgba(0,0,0,.30)" }}
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>{isEdit ? `Editar ${person!.fullName}` : title}</strong>
          <button className="icon-btn" type="button" aria-label="Fechar" onClick={close}>
            <Icon name="x" size={15} />
          </button>
        </div>

        {/* Papéis */}
        <div className="field">
          <label>Papéis *</label>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {ROLES.map((r) => {
              const active = form.roles.includes(r.value);
              return (
                <button
                  key={r.value}
                  type="button"
                  className={`badge ${active ? "badge-blue" : "badge-slate"}`}
                  style={{ cursor: "pointer", padding: "6px 12px" }}
                  onClick={() => toggleRole(r.value)}
                >
                  {active ? <Icon name="check" size={13} /> : <Icon name="plus" size={13} />} {r.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Abas — cada grupo de campos numa aba (evita rolar a tela). Os painéis
            ficam sempre montados (display:none) para preservar estado local do
            AddressBlock (trava do CEP) ao alternar. */}
        <TabBar tabs={TABS} active={tab} onSelect={setTab} />

        <div className="modal-scroll">

        {loading && <span className="text-sm subtle">Carregando ficha…</span>}

        {/* Dados pessoais */}
        <div className="stack" style={{ gap: 14, display: tab === "pessoais" ? "flex" : "none" }}>
          <FieldBlock tone="tone-azul" icon="user" title="Identificação">
          <div className="grid grid-3" style={{ gap: 12 }}>
            <div className="field">
              <label>Tipo</label>
              <select className="input" value={form.personType} onChange={(e) => setPersonType(e.target.value as "PF" | "PJ")}>
                <option value="PF">Pessoa Física</option>
                <option value="PJ">Pessoa Jurídica</option>
              </select>
            </div>
            <div className="field" style={{ gridColumn: "span 2" }}>
              <label>Nome / Razão social *</label>
              <input className="input" value={form.fullName} onChange={(e) => set({ fullName: e.target.value })} placeholder="Ana Lima" />
            </div>
          </div>

          <div className="grid grid-3" style={{ gap: 12 }}>
            <div className="field">
              <label>{form.personType === "PJ" ? "CNPJ" : "CPF"}</label>
              <input
                className="input"
                value={form.cpfCnpj}
                onChange={(e) => set({ cpfCnpj: formatCpfCnpj(e.target.value, form.personType) })}
                placeholder={form.personType === "PJ" ? "00.000.000/0000-00" : "000.000.000-00"}
                inputMode={form.personType === "PJ" ? "text" : "numeric"}
                aria-invalid={docError ? true : undefined}
                style={docError ? { borderColor: "var(--danger, #dc2626)" } : undefined}
              />
              {docError && <span className="text-xs" style={{ color: "var(--danger, #dc2626)" }}>{docError}</span>}
            </div>
            <div className="field">
              <label>RG</label>
              <input className="input" value={form.rg} onChange={(e) => set({ rg: e.target.value })} />
            </div>
            <div className="field">
              <label>Órgão emissor</label>
              <input className="input" value={form.rgIssuer} onChange={(e) => set({ rgIssuer: e.target.value })} placeholder="SSP/MG" />
            </div>
          </div>

          <div className="grid grid-3" style={{ gap: 12 }}>
            <div className="field">
              <label>Nascimento</label>
              <input className="input" type="date" value={form.birthDate} onChange={(e) => set({ birthDate: e.target.value })} />
            </div>
            <div className="field">
              <label>Sexo</label>
              <select className="input" value={form.gender} onChange={(e) => set({ gender: e.target.value as NewPersonInput["gender"] })}>
                <option value="">—</option>
                <option value="M">Masculino</option>
                <option value="F">Feminino</option>
                <option value="OUTRO">Outro</option>
              </select>
            </div>
            <div className="field">
              <label>Nacionalidade</label>
              <input className="input" value={form.nationality} onChange={(e) => set({ nationality: e.target.value })} />
            </div>
          </div>

          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="field">
              <label>Estado civil</label>
              <select className="input" value={form.maritalStatus} onChange={(e) => set({ maritalStatus: e.target.value })}>
                <option value="">—</option>
                <option value="SOLTEIRO">Solteiro(a)</option>
                <option value="CASADO">Casado(a)</option>
                <option value="DIVORCIADO">Divorciado(a)</option>
                <option value="VIUVO">Viúvo(a)</option>
                <option value="UNIAO_ESTAVEL">União estável</option>
              </select>
            </div>
            <div className="field">
              <label>Profissão</label>
              <input className="input" value={form.occupation} onChange={(e) => set({ occupation: e.target.value })} />
            </div>
          </div>

          {form.maritalStatus === "CASADO" && (
            <div className="stack" style={{ gap: 10, borderLeft: "3px solid var(--border, #e5e7eb)", paddingLeft: 12 }}>
              <span className="text-sm strong">Cônjuge</span>
              <div className="grid grid-2" style={{ gap: 12 }}>
                <div className="field">
                  <label>Nome *</label>
                  <input className="input" value={form.spouseName} onChange={(e) => set({ spouseName: e.target.value })} />
                </div>
                <div className="field">
                  <label>CPF</label>
                  <input className="input" value={form.spouseCpf} onChange={(e) => set({ spouseCpf: formatCpf(e.target.value) })} placeholder="000.000.000-00" inputMode="numeric" />
                </div>
              </div>
              <div className="grid grid-3" style={{ gap: 12 }}>
                <div className="field">
                  <label>RG</label>
                  <input className="input" value={form.spouseRg} onChange={(e) => set({ spouseRg: e.target.value })} />
                </div>
                <div className="field">
                  <label>Profissão</label>
                  <input className="input" value={form.spouseOccupation} onChange={(e) => set({ spouseOccupation: e.target.value })} />
                </div>
                <div className="field">
                  <label>Nascimento</label>
                  <input className="input" type="date" value={form.spouseBirthDate} onChange={(e) => set({ spouseBirthDate: e.target.value })} />
                </div>
              </div>
            </div>
          )}
          </FieldBlock>
        </div>

        {/* Dados bancários (repasse) */}
        <div className="stack" style={{ gap: 12, display: tab === "bancarios" ? "flex" : "none" }}>
          <FieldBlock tone="tone-esmeralda" icon="banknote" title="Conta para repasse">
          <div className="grid grid-3" style={{ gap: 12 }}>
            <div className="field">
              <label>Banco</label>
              <input className="input" value={form.bank} onChange={(e) => set({ bank: e.target.value })} />
            </div>
            <div className="field">
              <label>Agência</label>
              <input className="input" value={form.agency} onChange={(e) => set({ agency: e.target.value })} />
            </div>
            <div className="field">
              <label>Conta corrente</label>
              <input className="input" value={form.account} onChange={(e) => set({ account: e.target.value })} />
            </div>
          </div>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="field">
              <label>Titular</label>
              <input className="input" value={form.holderName} onChange={(e) => set({ holderName: e.target.value })} />
            </div>
            <div className="field">
              <label>Autorização de recebimento</label>
              <input className="input" value={form.paymentAuthorization} onChange={(e) => set({ paymentAuthorization: e.target.value })} placeholder="Autorização de depósito bancário" />
            </div>
          </div>
          </FieldBlock>
        </div>

        {/* Dados residenciais */}
        <div className="stack" style={{ gap: 10, display: tab === "residenciais" ? "flex" : "none" }}>
          <FieldBlock
            tone="tone-ciano"
            icon="home"
            title="Endereço residencial"
            hint="ao menos um contato é obrigatório"
          >
            <AddressBlock title="" value={form.residential} onChange={(patch) => set({ residential: { ...form.residential, ...patch } })} />
            <span className="text-xs subtle">Informe ao menos um contato (e-mail ou telefone/celular) nos dados residenciais.</span>
          </FieldBlock>
        </div>

        {/* Dados comerciais */}
        <div className="stack" style={{ gap: 10, display: tab === "comerciais" ? "flex" : "none" }}>
          <FieldBlock tone="tone-teal" icon="store" title="Endereço comercial">
            <AddressBlock title="" value={form.commercial} onChange={(patch) => set({ commercial: { ...form.commercial, ...patch } })} />
          </FieldBlock>
        </div>

        {/* Observações + referências + perfil de busca */}
        <div className="stack" style={{ gap: 12, display: tab === "observacoes" ? "flex" : "none" }}>
          <FieldBlock tone="tone-ardosia" icon="list" title="Observações e referências">
          <div className="grid grid-2" style={{ gap: 12 }}>
            <div className="field">
              <label>Observações</label>
              <input className="input" value={form.notes} onChange={(e) => set({ notes: e.target.value })} />
            </div>
            <div className="field">
              <label>Referências</label>
              <input className="input" value={form.references} onChange={(e) => set({ references: e.target.value })} />
            </div>
          </div>

          <div className="field">
            <label>Intenção de busca (opcional)</label>
            <select className="input" value={form.intent} onChange={(e) => set({ intent: e.target.value as NewPersonInput["intent"] })}>
              <option value="">— sem perfil de busca</option>
              <option value="COMPRA">Compra</option>
              <option value="LOCACAO">Locação</option>
            </select>
          </div>
          {form.intent && (
            <>
              <div className="grid grid-2" style={{ gap: 12 }}>
                <div className="field">
                  <label>Orçamento mín. (R$)</label>
                  <input className="input" value={form.minPriceReais} onChange={(e) => set({ minPriceReais: e.target.value })} inputMode="numeric" />
                </div>
                <div className="field">
                  <label>Orçamento máx. (R$)</label>
                  <input className="input" value={form.maxPriceReais} onChange={(e) => set({ maxPriceReais: e.target.value })} inputMode="numeric" />
                </div>
              </div>
              <div className="grid grid-2" style={{ gap: 12 }}>
                <div className="field">
                  <label>Bairros (separados por vírgula)</label>
                  <input className="input" value={form.districts} onChange={(e) => set({ districts: e.target.value })} placeholder="Centro, Zona Sul" />
                </div>
                <div className="field">
                  <label>Quartos (mín.)</label>
                  <input className="input" value={form.bedroomsMin} onChange={(e) => set({ bedroomsMin: e.target.value })} inputMode="numeric" />
                </div>
              </div>
            </>
          )}
          </FieldBlock>
        </div>

        </div>

        {error && <span className="text-sm" style={{ color: "var(--danger, #dc2626)" }}>{error}</span>}

        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" type="button" onClick={close} disabled={pending}>
            Cancelar
          </button>
          <button
            className="btn btn-primary btn-sm"
            type="button"
            onClick={submit}
            disabled={pending || loading}
          >
            {pending ? "Salvando…" : isEdit ? "Salvar Alterações" : "Salvar Cadastro"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {isEdit ? (
        <button
          className="icon-btn"
          style={{ width: 30, height: 30 }}
          type="button"
          onClick={openModal}
          aria-label={`Editar ${person!.fullName}`}
          title="Editar"
        >
          <Icon name="edit" size={15} />
        </button>
      ) : (
        <button className="btn btn-primary btn-sm" type="button" onClick={openModal}>
          <Icon name="plus" /> {label}
        </button>
      )}
      {open && mounted && createPortal(modal, document.body)}
    </>
  );
}
