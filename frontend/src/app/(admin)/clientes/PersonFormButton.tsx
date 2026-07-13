"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "../../../components/Icon";
import { AddressBlock } from "./AddressBlock";
import { createPersonAction, type NewPersonInput, type PersonRole } from "./actions";

const ROLES: { value: PersonRole; label: string }[] = [
  { value: "LOCADOR", label: "Locador (proprietário)" },
  { value: "LOCATARIO", label: "Locatário" },
  { value: "FIADOR", label: "Fiador" },
  { value: "COMPRADOR", label: "Comprador" },
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

/**
 * Botão + modal com a ficha COMPLETA de pessoa (MOD-PESSOA), compartilhado pelas
 * views por papel (Proprietários/Clientes/Fiadores). `defaultRoles` pré-marca o
 * papel da tela. Paridade com a tela legada "Cadastro de Locadores": PF/PJ, RG +
 * órgão emissor, cônjuge (RG/CPF/profissão/nascimento), dados bancários +
 * autorização de recebimento, endereços residencial e comercial (com CEP/ViaCEP)
 * e observações. Envia para POST /v1/persons via Server Action.
 */
export function PersonFormButton({
  defaultRoles = [],
  label = "Novo cadastro",
  title = "Novo cadastro de pessoa",
}: {
  defaultRoles?: PersonRole[];
  label?: string;
  title?: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const empty = useMemo(() => makeEmpty(defaultRoles), [defaultRoles]);
  const [form, setForm] = useState<NewPersonInput>(empty);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setMounted(true), []);

  const set = (patch: Partial<NewPersonInput>) => setForm((f) => ({ ...f, ...patch }));

  const toggleRole = (r: PersonRole) =>
    setForm((f) => ({
      ...f,
      roles: f.roles.includes(r) ? f.roles.filter((x) => x !== r) : [...f.roles, r],
    }));

  function close() {
    setOpen(false);
    setError(null);
  }

  function submit() {
    setError(null);
    startTransition(async () => {
      const res = await createPersonAction(form);
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar.");
        return;
      }
      setForm(makeEmpty(defaultRoles));
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
        className="card card-pad stack"
        onClick={(e) => e.stopPropagation()}
        style={{ gap: 14, width: 680, maxWidth: "96vw", boxShadow: "0 20px 60px rgba(0,0,0,.30)" }}
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <strong>{title}</strong>
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

        {/* Identificação */}
        <div className="grid grid-3" style={{ gap: 12 }}>
          <div className="field">
            <label>Tipo</label>
            <select className="input" value={form.personType} onChange={(e) => set({ personType: e.target.value as "PF" | "PJ" })}>
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
            <label>CPF / CNPJ</label>
            <input className="input" value={form.cpfCnpj} onChange={(e) => set({ cpfCnpj: e.target.value })} placeholder="Somente números" inputMode="numeric" />
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
                <input className="input" value={form.spouseCpf} onChange={(e) => set({ spouseCpf: e.target.value })} inputMode="numeric" />
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

        {/* Dados bancários */}
        <div className="stack" style={{ gap: 10 }}>
          <span className="text-sm strong">Dados bancários (repasse)</span>
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
        </div>

        {/* Endereços */}
        <div className="stack" style={{ gap: 10 }}>
          <span className="text-sm strong">Dados residenciais</span>
          <AddressBlock title="" value={form.residential} onChange={(patch) => set({ residential: { ...form.residential, ...patch } })} />
        </div>
        <div className="stack" style={{ gap: 10 }}>
          <span className="text-sm strong">Dados comerciais</span>
          <AddressBlock title="" value={form.commercial} onChange={(patch) => set({ commercial: { ...form.commercial, ...patch } })} />
        </div>
        <span className="text-xs subtle">Informe ao menos um contato (e-mail ou telefone/celular) nos dados residenciais.</span>

        {/* Observações */}
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

        {/* Perfil de busca (locatário/comprador) */}
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

        {error && <span className="text-sm" style={{ color: "var(--danger, #dc2626)" }}>{error}</span>}

        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button className="btn btn-ghost btn-sm" type="button" onClick={close} disabled={pending}>
            Cancelar
          </button>
          <button className="btn btn-primary btn-sm" type="button" onClick={submit} disabled={pending}>
            {pending ? "Salvando…" : "Salvar cadastro"}
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button className="btn btn-primary btn-sm" type="button" onClick={() => setOpen(true)}>
        <Icon name="plus" /> {label}
      </button>
      {open && mounted && createPortal(modal, document.body)}
    </>
  );
}
