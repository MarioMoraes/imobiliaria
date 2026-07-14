"use client";

import { useState } from "react";
import { Icon } from "../../../components/Icon";
import { Modal } from "../../../components/Modal";
import type { Clause, InspectionItem, PropertyType } from "../../../lib/api";
import { SingleFieldManager } from "./SingleFieldManager";
import { ClauseManager } from "./ClauseManager";
import {
  createItemAction,
  createTypeAction,
  deleteItemAction,
  deleteTypeAction,
} from "./actions";

type CardKey = "types" | "clauses" | "items";

interface CardMeta {
  key: CardKey;
  title: string;
  icon: string;
  tone: "blue" | "accent" | "success" | "warning";
  description: string;
  count: number;
  live: boolean;
}

/**
 * Grid de tabelas auxiliares: um card por cadastro. Clicar em um card abre um
 * popup (Modal) com o gerenciador do item selecionado (lista + inclusão +
 * remoção). Reutiliza os managers existentes dentro do modal.
 */
export function TabelasGrid({
  types,
  clauses,
  items,
  liveTypes,
  liveClauses,
  liveItems,
}: {
  types: PropertyType[];
  clauses: Clause[];
  items: InspectionItem[];
  liveTypes: boolean;
  liveClauses: boolean;
  liveItems: boolean;
}) {
  const [open, setOpen] = useState<CardKey | null>(null);

  const cards: CardMeta[] = [
    {
      key: "types",
      title: "Tipos de Imóvel",
      icon: "building",
      tone: "blue",
      description: "Apartamento, Casa, Sala comercial…",
      count: types.length,
      live: liveTypes,
    },
    {
      key: "clauses",
      title: "Cláusulas Contratuais",
      icon: "contract",
      tone: "accent",
      description: "Cláusulas reaproveitadas nos contratos.",
      count: clauses.length,
      live: liveClauses,
    },
    {
      key: "items",
      title: "Itens de Vistoria",
      icon: "list",
      tone: "success",
      description: "Itens conferidos na vistoria do imóvel.",
      count: items.length,
      live: liveItems,
    },
  ];

  const active = cards.find((c) => c.key === open) ?? null;

  return (
    <>
      <div className="grid grid-3">
        {cards.map((c) => (
          <button
            key={c.key}
            type="button"
            className="lookup-card reveal"
            onClick={() => setOpen(c.key)}
          >
            <span className={`stat-icon ${c.tone}`}>
              <Icon name={c.icon} />
            </span>
            <div className="stack" style={{ gap: 4 }}>
              <span className="lookup-card-title">{c.title}</span>
              <span className="subtle text-sm">{c.description}</span>
            </div>
            <div className="lookup-card-foot">
              <span className="badge badge-slate">
                {c.count} {c.count === 1 ? "registro" : "registros"}
              </span>
              <span className="row gap-8 text-sm strong">
                Gerenciar <Icon name="arrowRight" size={15} />
              </span>
            </div>
          </button>
        ))}
      </div>

      <Modal
        open={active !== null}
        onClose={() => setOpen(null)}
        title={active?.title ?? ""}
        icon={active?.icon}
      >
        {active?.key === "types" && (
          <SingleFieldManager
            rows={types.map((t) => ({ id: t.id, label: t.name }))}
            fieldName="name"
            placeholder="Novo tipo (ex.: Cobertura)"
            emptyLabel="Nenhum tipo cadastrado."
            live={liveTypes}
            createAction={createTypeAction}
            deleteAction={deleteTypeAction}
          />
        )}
        {active?.key === "clauses" && (
          <ClauseManager clauses={clauses} live={liveClauses} />
        )}
        {active?.key === "items" && (
          <SingleFieldManager
            rows={items.map((i) => ({ id: i.id, label: i.description }))}
            fieldName="description"
            placeholder="Novo item (ex.: Pintura externa)"
            emptyLabel="Nenhum item cadastrado."
            live={liveItems}
            createAction={createItemAction}
            deleteAction={deleteItemAction}
          />
        )}
      </Modal>
    </>
  );
}
