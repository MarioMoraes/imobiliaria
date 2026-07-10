"use client";

import { useActionState } from "react";
import { Icon } from "../../../components/Icon";
import { createGuarantorAction, type FormState } from "./actions";

const initial: FormState = {};

export function GuarantorForm() {
  const [state, action, pending] = useActionState(createGuarantorAction, initial);

  return (
    <form action={action} className="card-pad stack" style={{ gap: 14 }}>
      <div className="field">
        <label>Nome / Razão social *</label>
        <input className="input" name="fullName" placeholder="José Fiador da Silva" required />
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field">
          <label>Tipo</label>
          <select className="input" name="personType" defaultValue="PF">
            <option value="PF">Pessoa Física</option>
            <option value="PJ">Pessoa Jurídica</option>
          </select>
        </div>
        <div className="field">
          <label>CPF / CNPJ *</label>
          <input className="input" name="cpfCnpj" placeholder="Somente números" required />
        </div>
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field">
          <label>Estado civil</label>
          <select className="input" name="maritalStatus" defaultValue="">
            <option value="">—</option>
            <option value="SOLTEIRO">Solteiro(a)</option>
            <option value="CASADO">Casado(a)</option>
            <option value="DIVORCIADO">Divorciado(a)</option>
            <option value="VIUVO">Viúvo(a)</option>
            <option value="UNIAO_ESTAVEL">União estável</option>
          </select>
        </div>
        <div className="field">
          <label>Cônjuge (se casado)</label>
          <input className="input" name="spouseName" placeholder="Nome do cônjuge" />
        </div>
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field">
          <label>E-mail</label>
          <input className="input" name="email" type="email" placeholder="fiador@email.com" />
        </div>
        <div className="field">
          <label>Celular</label>
          <input className="input" name="mobile" placeholder="(35) 99999-0000" />
        </div>
      </div>
      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field">
          <label>Cidade (residencial)</label>
          <input className="input" name="city" placeholder="Poços de Caldas" />
        </div>
        <div className="field">
          <label>UF</label>
          <input className="input" name="state" maxLength={2} placeholder="MG" />
        </div>
      </div>

      {state.error && (
        <div className="badge badge-red" style={{ padding: "8px 12px" }}>
          <Icon name="x" size={14} /> {state.error}
        </div>
      )}
      {state.ok && (
        <div className="badge badge-green" style={{ padding: "8px 12px" }}>
          <Icon name="check" size={14} /> Fiador cadastrado com sucesso.
        </div>
      )}

      <button className="btn btn-primary" type="submit" disabled={pending}>
        {pending ? <Icon name="loader" className="spin" /> : <Icon name="plus" />}
        {pending ? "Salvando…" : "Cadastrar fiador"}
      </button>
    </form>
  );
}
