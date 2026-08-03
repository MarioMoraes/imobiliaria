/**
 * Apresentação da trilha de auditoria — puro, compartilhado pela tela do tenant
 * (`/auditoria`, restrita ao SUPER_ADMIN) e pela global da plataforma
 * (`/superadmin/auditoria`).
 *
 * O backend grava a ação no formato técnico (`entidade.acao`, ver
 * `backend/src/modules/audit/audit.actions.ts`). Aqui ela vira português. Uma
 * ação sem tradução aparece como está: é melhor mostrar `condominium.expense_created`
 * do que esconder o registro.
 */

/**
 * Papéis que enxergam a trilha — espelha `audit:read` da matriz do backend
 * (`modules/rbac/permissions.ts`). Mora aqui para que o item do menu
 * (`lib/nav.ts`) e a guarda da página usem a MESMA lista: três cópias soltas
 * viram três respostas diferentes na primeira vez que a regra mudar.
 */
export const AUDIT_ROLES = ["SUPER_ADMIN", "ADMIN"];

interface AuditLike {
  action: string;
  entity: string;
  entityId: string | null;
  payload: unknown;
  status: "OK" | "DENIED";
  createdAt: string;
}

/** Entidades no plural técnico → nome de negócio. */
export const ENTITY_LABEL: Record<string, string> = {
  property: "Imóvel",
  property_type: "Tipo de imóvel",
  person: "Pessoa",
  contract: "Contrato",
  contract_template: "Modelo de contrato",
  receivable: "Conta a receber",
  payable: "Conta a pagar",
  document: "Documento",
  employee: "Funcionário",
  user: "Usuário",
  broker: "Corretor",
  bank: "Banco",
  condominium: "Condomínio",
  district: "Bairro",
  clause: "Cláusula",
  event: "Evento financeiro",
  inspection_item: "Item de vistoria",
  tenant: "Imobiliária",
  config: "Configuração",
  ai: "Copiloto",
};

/** Ações com nome próprio. O resto é traduzido pelo sufixo do verbo. */
export const ACTION_LABEL: Record<string, string> = {
  "payment.received": "Pagamento recebido",
  "charge.issued": "Cobrança emitida",
  "charge.synced": "Cobrança sincronizada",
  "transfer.executed": "Repasse executado",
  "transfer.synced": "Repasse sincronizado",
  "contract.sent_to_sign": "Contrato enviado para assinatura",
  "contract.signature_synced": "Assinatura sincronizada",
  "contract.pdf_generated": "Contrato gerado em PDF",
  "contract.receivables_generated": "Parcelas geradas",
  "contract.administration_issued": "Contrato de administração emitido",
  "inspection.recorded": "Vistoria registrada",
  "condominium.charges_generated": "Cobrança de condomínio gerada",
  "role.changed": "Papel alterado",
  "user.invited": "Convite enviado",
  "user.activated": "Acesso ativado",
  "employee.access_changed": "Acesso do funcionário alterado",
  "config.integrations.updated": "Integração configurada",
  "config.integrations.removed": "Integração removida",
  "document.downloaded": "Documento aberto",
  "document.purged": "Documento expurgado",
  "webhook.processed": "Retorno do provedor",
  "ai.reindexed": "Índice do copiloto reconstruído",
};

const VERB_LABEL: Record<string, string> = {
  created: "cadastrado",
  updated: "alterado",
  deleted: "excluído",
  removed: "removido",
};

/** Rótulo legível da ação: mapa explícito, senão `Entidade + verbo`. */
export function actionLabel(action: string): string {
  const known = ACTION_LABEL[action];
  if (known) return known;

  const [entity = "", rest = ""] = action.split(".");
  const parts = rest.split("_");
  const verb = VERB_LABEL[parts[parts.length - 1] ?? ""];
  const subject = parts.slice(0, -1).join(" ");
  const base = ENTITY_LABEL[entity] ?? entity;
  if (!verb) return action;
  return subject ? `${base} — ${subject} ${verb}` : `${base} ${verb}`;
}

/** Cor do selo: verde cria, âmbar altera, vermelho apaga/recusa, azul dinheiro. */
export function actionTone(log: Pick<AuditLike, "action" | "status">): string {
  if (log.status === "DENIED") return "badge-red";
  if (log.action.startsWith("payment.") || log.action.startsWith("transfer.")) return "badge-blue";
  if (log.action.startsWith("config.") || log.action === "role.changed") return "badge-amber";
  if (log.action.endsWith("deleted") || log.action.endsWith("removed")) return "badge-red";
  if (log.action.endsWith("created")) return "badge-green";
  if (log.action.endsWith("updated")) return "badge-cyan";
  return "badge-slate";
}

/** Campos do payload que valem como resumo do alvo, na ordem de preferência. */
const SUMMARY_KEYS = [
  "name",
  "fullName",
  "title",
  "description",
  "code",
  "role",
  "status",
  "kind",
  "event",
  "fileName",
];

/**
 * Uma linha curta sobre o alvo, tirada do payload redigido. Sem nada
 * aproveitável, mostra o id — que ainda serve para cruzar com o registro.
 */
export function describePayload(log: Pick<AuditLike, "payload" | "entityId">): string {
  const payload = log.payload;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    for (const key of SUMMARY_KEYS) {
      const value = record[key];
      if (typeof value === "string" && value.trim()) return value;
      if (typeof value === "number") return String(value);
    }
  }
  return log.entityId ?? "";
}

/** ISO → "21/07/2026 14:32". */
export function formatMoment(iso: string): string {
  const date = new Date(iso);
  return `${date.toLocaleDateString("pt-BR")} ${date.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}
