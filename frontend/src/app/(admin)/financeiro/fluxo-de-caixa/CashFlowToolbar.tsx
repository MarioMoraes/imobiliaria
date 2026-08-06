"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "../../../../components/Icon";
import { Modal } from "../../../../components/Modal";
import { useConfirm } from "../../../../components/ConfirmDialog";
import { useToast } from "../../../../components/Toast";
import type { Bank, CashFlowCategory } from "../../../../lib/api";
import {
  createCashFlowCategoryAction,
  createCashFlowEntryAction,
  deleteCashFlowCategoryAction,
  type CashFlowEntryFormInput,
} from "../actions";

/**
 * Ações do topo do Fluxo de Caixa: navegar entre meses, lançar uma receita ou
 * despesa avulsa e manter as categorias.
 *
 * O mês vive na URL (`?mes=YYYY-MM`) e não em estado local: assim a tela é
 * linkável, o botão voltar do navegador funciona e o Server Component busca o
 * mês certo na origem, em vez de filtrar no cliente uma lista já cortada.
 *
 * O seletor é o `<input type="month">` nativo, e o texto dele ("agosto de 2026")
 * é do navegador — sem capitalização e fora do padrão "Agosto/2026" do resto da
 * tela. Trocar por um `<select>` alinharia a grafia ao custo de limitar a
 * navegação a uma janela de meses; a escolha aqui foi manter o campo nativo.
 */
export function CashFlowToolbar({
  month,
  categories,
  banks,
  disabled,
}: {
  month: string;
  categories: CashFlowCategory[];
  banks: Bank[];
  disabled: boolean;
}) {
  const router = useRouter();
  const [entryOpen, setEntryOpen] = useState(false);
  const [categoriesOpen, setCategoriesOpen] = useState(false);

  return (
    <>
      <input
        className="input input-sm"
        type="month"
        value={month}
        aria-label="Mês do Fluxo de Caixa"
        onChange={(e) => {
          if (e.target.value) router.push(`/financeiro/fluxo-de-caixa?mes=${e.target.value}`);
        }}
      />
      <button
        className="btn btn-outline btn-sm"
        type="button"
        onClick={() => setCategoriesOpen(true)}
        disabled={disabled}
      >
        <Icon name="folder" /> Categorias
      </button>
      <button
        className="btn btn-primary btn-sm"
        type="button"
        onClick={() => setEntryOpen(true)}
        disabled={disabled}
      >
        <Icon name="plus" /> Novo Lançamento
      </button>

      <Modal
        open={entryOpen}
        onClose={() => setEntryOpen(false)}
        title="Novo Lançamento"
        subtitle="Receita ou despesa da imobiliária que o sistema não apura sozinho."
        icon="wallet"
      >
        <EntryForm
          month={month}
          categories={categories}
          banks={banks}
          onDone={() => {
            setEntryOpen(false);
            router.refresh();
          }}
        />
      </Modal>

      <Modal
        open={categoriesOpen}
        onClose={() => setCategoriesOpen(false)}
        title="Categorias"
        icon="folder"
      >
        <CategoryManager categories={categories} />
      </Modal>
    </>
  );
}

/* --------------------------------------------------- Lançamento manual */

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Data inicial: hoje, se hoje cair no mês que está sendo visto; senão o dia 1
 * daquele mês. Sem isso, lançar uma despesa enquanto se olha um mês fechado
 * criava o movimento no mês corrente e ele sumia da tela — parecendo que a ação
 * falhou.
 */
function defaultDate(month: string): string {
  const hoje = todayIso();
  return hoje.startsWith(month) ? hoje : `${month}-01`;
}

function EntryForm({
  month,
  categories,
  banks,
  onDone,
}: {
  month: string;
  categories: CashFlowCategory[];
  banks: Bank[];
  onDone: () => void;
}) {
  const toast = useToast();
  const [saving, startSave] = useTransition();
  const [form, setForm] = useState<CashFlowEntryFormInput>({
    entryDate: defaultDate(month),
    direction: "SAIDA",
    categoryId: "",
    bankId: "",
    amountReais: "",
    description: "",
    notes: "",
  });

  const set = <K extends keyof CashFlowEntryFormInput>(
    key: K,
    value: CashFlowEntryFormInput[K],
  ): void => setForm((f) => ({ ...f, [key]: value }));

  // A lista de categorias segue a direção escolhida: oferecer "Salários" numa
  // receita só cria lançamento classificado errado.
  const doTipo = categories.filter((c) => c.direction === form.direction && c.active);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startSave(async () => {
      const res = await createCashFlowEntryAction(form);
      if (!res.ok) {
        toast.error(res.error ?? "Falha ao lançar.");
        return;
      }
      toast.success("Lançamento registrado.");
      onDone();
    });
  }

  return (
    <form className="card-pad stack" style={{ gap: 14 }} onSubmit={handleSubmit}>
      <div className="grid grid-2">
        <div className="field">
          <label>Tipo</label>
          <select
            className="input"
            value={form.direction}
            onChange={(e) => {
              set("direction", e.target.value as "ENTRADA" | "SAIDA");
              // A categoria antiga é de outra direção — mantê-la salvaria uma
              // despesa classificada como receita.
              set("categoryId", "");
            }}
          >
            <option value="SAIDA">Despesa</option>
            <option value="ENTRADA">Receita</option>
          </select>
        </div>
        <div className="field">
          <label>Data</label>
          <input
            className="input"
            type="date"
            value={form.entryDate}
            onChange={(e) => set("entryDate", e.target.value)}
            required
          />
        </div>
      </div>

      <div className="field">
          <label>Descrição</label>
        <input
          className="input"
          value={form.description}
          onChange={(e) => set("description", e.target.value)}
          maxLength={200}
          required
          autoFocus
        />
      </div>

      <div className="grid grid-2">
        <div className="field">
          <label>Valor (R$)</label>
          <input
            className="input"
            inputMode="decimal"
            placeholder="0,00"
            value={form.amountReais}
            onChange={(e) => set("amountReais", e.target.value)}
            required
          />
        </div>
        <div className="field">
          <label>Categoria</label>
          <select
            className="input"
            value={form.categoryId}
            onChange={(e) => set("categoryId", e.target.value)}
          >
            <option value="">Sem Categoria</option>
            {doTipo.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-2">
        <div className="field">
          <label>Banco</label>
          <select
            className="input"
            value={form.bankId}
            onChange={(e) => set("bankId", e.target.value)}
          >
            <option value="">Não Informado</option>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Observações</label>
          <input
            className="input"
            value={form.notes}
            onChange={(e) => set("notes", e.target.value)}
            maxLength={1000}
          />
        </div>
      </div>

      <div className="row" style={{ justifyContent: "flex-end" }}>
        <button className="btn btn-primary" type="submit" disabled={saving}>
          {saving ? <Icon name="loader" className="spin" /> : <Icon name="check" />}
          Lançar
        </button>
      </div>
    </form>
  );
}

/* ------------------------------------------------------------ Categorias */

function CategoryManager({ categories }: { categories: CashFlowCategory[] }) {
  const router = useRouter();
  const confirm = useConfirm();
  const toast = useToast();
  const [saving, startSave] = useTransition();
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [direction, setDirection] = useState<"ENTRADA" | "SAIDA">("SAIDA");

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    startSave(async () => {
      const res = await createCashFlowCategoryAction({ name, direction });
      if (!res.ok) {
        toast.error(res.error ?? "Falha ao criar a categoria.");
        return;
      }
      setName("");
      toast.success("Categoria criada.");
      router.refresh();
    });
  }

  async function handleDelete(category: CashFlowCategory) {
    const ok = await confirm({
      title: `Excluir a categoria "${category.name}"?`,
      message:
        "Os lançamentos que a usavam continuam no fluxo de caixa e passam a " +
        'aparecer como "Sem categoria".',
      eyebrow: "Exclusão",
      confirmLabel: "Excluir",
    });
    if (!ok) return;

    setRemovingId(category.id);
    startSave(async () => {
      try {
        const res = await deleteCashFlowCategoryAction(category.id);
        if (!res.ok) {
          toast.error(res.error ?? "Falha ao excluir.");
          return;
        }
        toast.success("Categoria excluída.");
        router.refresh();
      } finally {
        setRemovingId(null);
      }
    });
  }

  return (
    <div className="card-pad stack" style={{ gap: 14 }}>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Cód.</th>
              <th>Nome</th>
              <th>Tipo</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {categories.length === 0 && (
              <tr>
                <td colSpan={4} className="text-sm subtle">
                  Nenhuma categoria ainda. Sem elas o lançamento continua valendo —
                  ele só agrupa como &quot;Sem categoria&quot;.
                </td>
              </tr>
            )}
            {categories.map((c) => (
              <tr key={c.id}>
                <td className="text-sm subtle">{c.code}</td>
                <td className="strong">{c.name}</td>
                <td>
                  <span
                    className={`badge ${
                      c.direction === "ENTRADA" ? "badge-green" : "badge-amber"
                    }`}
                  >
                    {c.direction === "ENTRADA" ? "Receita" : "Despesa"}
                  </span>
                </td>
                <td style={{ width: 44, textAlign: "right" }}>
                  <button
                    className="icon-btn"
                    style={{ width: 30, height: 30 }}
                    type="button"
                    onClick={() => void handleDelete(c)}
                    disabled={removingId !== null}
                    aria-label={`Excluir ${c.name}`}
                  >
                    <Icon
                      name={removingId === c.id ? "loader" : "trash"}
                      className={removingId === c.id ? "spin" : undefined}
                      size={15}
                    />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form className="row gap-8" onSubmit={handleCreate}>
        <input
          className="input"
          placeholder="Nova Categoria"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={120}
          required
          style={{ flex: 1 }}
        />
        <select
          className="input"
          value={direction}
          onChange={(e) => setDirection(e.target.value as "ENTRADA" | "SAIDA")}
          style={{ width: 140 }}
        >
          <option value="SAIDA">Despesa</option>
          <option value="ENTRADA">Receita</option>
        </select>
        <button className="btn btn-primary" type="submit" disabled={saving}>
          <Icon name="plus" /> Adicionar
        </button>
      </form>
    </div>
  );
}
