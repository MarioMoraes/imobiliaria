"use client";

import { useState } from "react";
import { Icon } from "../../../components/Icon";
import type { AddressInput } from "./actions";

type Locked = Partial<Record<"street" | "district" | "city" | "state", boolean>>;

interface ViaCepResponse {
  logradouro?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
  erro?: boolean;
}

/**
 * Bloco de endereço (Dados Residenciais/Comerciais) com preenchimento por CEP.
 * Fluxo pedido: informa o CEP primeiro → consulta viacep.com.br → preenche
 * logradouro/bairro/cidade/UF e DESABILITA esses campos (só o número fica
 * editável). "Editar" reabre os campos caso o CEP retorne algo errado.
 */
export function AddressBlock({
  title,
  value,
  onChange,
}: {
  title: string;
  value: AddressInput;
  onChange: (patch: Partial<AddressInput>) => void;
}) {
  const [locked, setLocked] = useState<Locked>({});
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function lookup(cepRaw: string) {
    const cep = (cepRaw ?? "").replace(/\D/g, "");
    if (cep.length !== 8) return;
    setLoading(true);
    setMsg(null);
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const data = (await res.json()) as ViaCepResponse;
      if (data.erro) {
        setMsg("CEP não encontrado.");
        setLocked({});
        return;
      }
      onChange({
        street: data.logradouro ?? "",
        district: data.bairro ?? "",
        city: data.localidade ?? "",
        state: data.uf ?? "",
      });
      // Só trava os campos que vieram preenchidos.
      setLocked({
        street: Boolean(data.logradouro),
        district: Boolean(data.bairro),
        city: Boolean(data.localidade),
        state: Boolean(data.uf),
      });
    } catch {
      setMsg("Falha ao consultar o CEP.");
    } finally {
      setLoading(false);
    }
  }

  const anyLocked = Object.values(locked).some(Boolean);

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
        <span className="text-sm strong">{title}</span>
        {anyLocked && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ padding: "2px 8px" }} onClick={() => setLocked({})}>
            <Icon name="edit" size={12} /> editar
          </button>
        )}
      </div>

      <div className="grid grid-3" style={{ gap: 12 }}>
        <div className="field">
          <label>CEP {loading && <span className="text-xs subtle">buscando…</span>}</label>
          <input
            className="input"
            value={value.zip ?? ""}
            inputMode="numeric"
            placeholder="00000-000"
            onChange={(e) => onChange({ zip: e.target.value })}
            onBlur={(e) => lookup(e.target.value)}
          />
        </div>
        <div className="field" style={{ gridColumn: "span 2" }}>
          <label>Endereço</label>
          <input
            className="input"
            value={value.street ?? ""}
            disabled={locked.street}
            onChange={(e) => onChange({ street: e.target.value })}
          />
        </div>
      </div>

      <div className="grid grid-3" style={{ gap: 12 }}>
        <div className="field">
          <label>Número</label>
          <input className="input" value={value.number ?? ""} onChange={(e) => onChange({ number: e.target.value })} />
        </div>
        <div className="field">
          <label>Bairro</label>
          <input
            className="input"
            value={value.district ?? ""}
            disabled={locked.district}
            onChange={(e) => onChange({ district: e.target.value })}
          />
        </div>
        <div className="field">
          <label>Cidade / UF</label>
          <div className="row" style={{ gap: 6 }}>
            <input
              className="input"
              value={value.city ?? ""}
              disabled={locked.city}
              onChange={(e) => onChange({ city: e.target.value })}
            />
            <input
              className="input"
              style={{ width: 60 }}
              maxLength={2}
              value={value.state ?? ""}
              disabled={locked.state}
              onChange={(e) => onChange({ state: e.target.value.toUpperCase() })}
            />
          </div>
        </div>
      </div>

      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field">
          <label>Telefone</label>
          <input className="input" value={value.phone ?? ""} onChange={(e) => onChange({ phone: e.target.value })} />
        </div>
        <div className="field">
          <label>Celular</label>
          <input className="input" value={value.mobile ?? ""} onChange={(e) => onChange({ mobile: e.target.value })} />
        </div>
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field">
          <label>Fax</label>
          <input className="input" value={value.fax ?? ""} onChange={(e) => onChange({ fax: e.target.value })} />
        </div>
        <div className="field">
          <label>E-mail</label>
          <input className="input" value={value.email ?? ""} onChange={(e) => onChange({ email: e.target.value })} placeholder="contato@email.com" />
        </div>
      </div>

      {msg && <span className="text-xs" style={{ color: "var(--danger, #dc2626)" }}>{msg}</span>}
    </div>
  );
}
