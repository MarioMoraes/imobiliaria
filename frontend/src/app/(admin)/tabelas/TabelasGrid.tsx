"use client";

import { useState } from "react";
import { Icon } from "../../../components/Icon";
import { Modal } from "../../../components/Modal";
import type {
  Clause,
  ContractTemplate,
  District,
  Event,
  InspectionItem,
  MergeField,
  PropertyType,
} from "../../../lib/api";
import { SingleFieldManager } from "./SingleFieldManager";
import { ClauseManager } from "./ClauseManager";
import { ContractTemplateManager } from "./ContractTemplateManager";
import { EventManager } from "./EventManager";
import {
  createDistrictAction,
  createItemAction,
  createTypeAction,
  deleteDistrictAction,
  deleteItemAction,
  deleteTypeAction,
} from "./actions";

type CardKey = "types" | "clauses" | "templates" | "items" | "districts" | "events";

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
  templates,
  mergeFields,
  items,
  districts,
  events,
  liveTypes,
  liveClauses,
  liveTemplates,
  liveItems,
  liveDistricts,
  liveEvents,
}: {
  types: PropertyType[];
  clauses: Clause[];
  templates: ContractTemplate[];
  mergeFields: MergeField[];
  items: InspectionItem[];
  districts: District[];
  events: Event[];
  liveTypes: boolean;
  liveClauses: boolean;
  liveTemplates: boolean;
  liveItems: boolean;
  liveDistricts: boolean;
  liveEvents: boolean;
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
      key: "templates",
      title: "Modelos de Contrato",
      icon: "fileText",
      tone: "blue",
      description: "HTML com variáveis dinâmicas do contrato.",
      count: templates.length,
      live: liveTemplates,
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
    {
      key: "districts",
      title: "Bairros",
      icon: "mapPin",
      tone: "warning",
      description: "Bairros usados nos endereços.",
      count: districts.length,
      live: liveDistricts,
    },
    {
      key: "events",
      title: "Eventos",
      icon: "receipt",
      tone: "accent",
      description: "Eventos financeiros de cobrança (juros/multa).",
      count: events.length,
      live: liveEvents,
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
        {active?.key === "templates" && (
          <ContractTemplateManager
            templates={templates}
            mergeFields={mergeFields}
            live={liveTemplates}
          />
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
        {active?.key === "districts" && (
          <SingleFieldManager
            rows={districts.map((d) => ({ id: d.id, label: d.name }))}
            fieldName="name"
            placeholder="Novo bairro (ex.: Centro)"
            emptyLabel="Nenhum bairro cadastrado."
            live={liveDistricts}
            createAction={createDistrictAction}
            deleteAction={deleteDistrictAction}
          />
        )}
        {active?.key === "events" && (
          <EventManager events={events} live={liveEvents} />
        )}
      </Modal>
    </>
  );
}
