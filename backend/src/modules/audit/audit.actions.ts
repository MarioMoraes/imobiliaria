/**
 * Tradução de rota → nome de ação da trilha (`entidade.acao`).
 *
 * A captura é automática (ver gateway/audit.hook.ts), então a maioria das rotas
 * nem aparece aqui: o nome é DERIVADO do caminho e do método
 * (`POST /v1/properties` → `property.created`,
 *  `DELETE /v1/properties/:id/photos/:photoId` → `property.photo_deleted`).
 *
 * O mapa de exceções existe para os nomes que os PRDs exigem literalmente —
 * `payment.received`, `transfer.executed`, `role.changed`,
 * `config.integrations.updated`, `document.purged` — e para as rotas que não
 * devem entrar na trilha (pré-visualização, conversa com o copiloto).
 */

export interface AuditAction {
  action: string;
  entity: string;
}

/** Plural da rota → entidade no singular. Fallback: tira o "s" final. */
const ENTITIES: Record<string, string> = {
  properties: "property",
  "property-types": "property_type",
  persons: "person",
  contracts: "contract",
  "contract-templates": "contract_template",
  receivables: "receivable",
  payables: "payable",
  documents: "document",
  employees: "employee",
  users: "user",
  brokers: "broker",
  banks: "bank",
  condominiums: "condominium",
  districts: "district",
  clauses: "clause",
  events: "event",
  "inspection-items": "inspection_item",
  tenant: "tenant",
  tenants: "tenant",
  "payment-settings": "config",
  "signature-settings": "config",
  ai: "ai",
  audit: "audit",
};

/**
 * Exceções por `MÉTODO caminho-template`. `null` = não auditar.
 * O caminho é o da rota registrada (com prefixo e parâmetros nomeados).
 */
const OVERRIDES: Record<string, AuditAction | null> = {
  // Financeiro (PRD 11): os nomes são os do contábil, não os do HTTP.
  "POST /v1/receivables/:id/settle": { action: "payment.received", entity: "receivable" },
  "POST /v1/receivables/:id/boleto": { action: "charge.issued", entity: "receivable" },
  "POST /v1/receivables/:id/sync-charge": { action: "charge.synced", entity: "receivable" },
  "POST /v1/payables/:id/settle": { action: "transfer.executed", entity: "payable" },
  "POST /v1/payables/:id/transfer": { action: "transfer.executed", entity: "payable" },
  // PIX único de vários repasses: a trilha registra o mesmo fato (dinheiro
  // saindo), com os ids do lote no payload.
  "POST /v1/payables/transfer-batch": { action: "transfer.executed", entity: "payable" },
  "POST /v1/payables/:id/sync-transfer": { action: "transfer.synced", entity: "payable" },
  "POST /v1/payables/:id/cancel": { action: "payable.canceled", entity: "payable" },
  "POST /v1/payables/generate": { action: "payable.generated", entity: "payable" },

  // Contratos (PRD 08).
  "POST /v1/contracts/:id/send-to-sign": { action: "contract.sent_to_sign", entity: "contract" },
  "POST /v1/contracts/:id/sync-signature": { action: "contract.signature_synced", entity: "contract" },
  "POST /v1/contracts/:id/generate": { action: "contract.pdf_generated", entity: "contract" },
  "POST /v1/contracts/:id/receivables": { action: "contract.receivables_generated", entity: "contract" },
  // Só renderiza uma prévia — não muda nada no tenant.
  "POST /v1/contracts/preview": null,
  "POST /v1/properties/:id/administration-contract": {
    action: "contract.administration_issued",
    entity: "property",
  },
  "PUT /v1/properties/:id/inspection": { action: "inspection.recorded", entity: "property" },

  // Identidade e acesso (PRD 01 e 06).
  "PATCH /v1/users/:id/role": { action: "role.changed", entity: "user" },
  "PATCH /v1/employees/:id/access": { action: "employee.access_changed", entity: "employee" },
  "POST /v1/employees/:id/invite/resend": { action: "user.invited", entity: "employee" },

  // Configuração do tenant: credenciais de terceiros (PRD 01 seção 9).
  "PUT /v1/payment-settings": { action: "config.integrations.updated", entity: "config" },
  "DELETE /v1/payment-settings": { action: "config.integrations.removed", entity: "config" },
  "PUT /v1/signature-settings": { action: "config.integrations.updated", entity: "config" },
  "DELETE /v1/signature-settings": { action: "config.integrations.removed", entity: "config" },

  // Documental (PRD 09): DELETE aqui é expurgo LGPD, não exclusão comum.
  "DELETE /v1/documents/:id": { action: "document.purged", entity: "document" },

  // IA (PRD 20): cada pergunta e cada ferramenta já viram `agent_tool_calls`.
  // Duplicar aqui só encheria a trilha com o texto das conversas.
  "POST /v1/ai/chat": null,
  "POST /v1/ai/rag/reindex": { action: "ai.reindexed", entity: "ai" },
};

const VERBS: Record<string, string> = {
  POST: "created",
  PUT: "updated",
  PATCH: "updated",
  DELETE: "deleted",
};

function singular(segment: string): string {
  const known = ENTITIES[segment];
  if (known) return known;
  const base = segment.replace(/-/g, "_");
  if (base.endsWith("ies")) return `${base.slice(0, -3)}y`;
  if (base.endsWith("sses")) return base.slice(0, -2);
  return base.endsWith("s") ? base.slice(0, -1) : base;
}

/**
 * Nome da ação para o par método/rota, ou null quando a rota não é auditável.
 * `routeUrl` é o template do Fastify (`req.routeOptions.url`), não a URL crua —
 * `/v1/properties/:id` e não `/v1/properties/8f3…`.
 */
export function describeAction(method: string, routeUrl: string): AuditAction | null {
  const key = `${method.toUpperCase()} ${routeUrl}`;
  if (key in OVERRIDES) return OVERRIDES[key] ?? null;

  const verb = VERBS[method.toUpperCase()];
  if (!verb) return null;

  const segments = routeUrl.split("/").filter(Boolean);
  // Fora de /v1 (webhooks, /admin) a captura automática não vale: lá o registro
  // é explícito, com o tenant vindo da URL.
  if (segments[0] !== "v1" || segments.length < 2) return null;

  const root = segments[1]!;
  const entity = ENTITIES[root] ?? singular(root);

  // Sub-recurso: o último segmento nomeado depois da raiz
  // (`/v1/persons/:id/addresses` → `person.address_created`).
  const tail = segments.slice(2).filter((s) => !s.startsWith(":")).pop();
  const action = tail ? `${entity}.${singular(tail)}_${verb}` : `${entity}.${verb}`;
  return { action, entity };
}

/**
 * Ações "sensíveis" destacadas no painel do Super Admin (PRD 19): mexem em
 * acesso, em dinheiro ou apagam coisa. O padrão SQL correspondente vive no
 * repositório — mantenha os dois em sintonia.
 */
export const SENSITIVE_ACTIONS = [
  "role.changed",
  "user.invited",
  "user.activated",
  "employee.access_changed",
  "config.integrations.updated",
  "config.integrations.removed",
  "tenant.updated",
  "tenant.suspended",
  "document.purged",
  "payment.received",
  "transfer.executed",
  "contract.sent_to_sign",
  "contract.signed",
] as const;

/** true se a ação é sensível (lista acima ou qualquer exclusão). */
export function isSensitive(action: string): boolean {
  return (
    (SENSITIVE_ACTIONS as readonly string[]).includes(action) ||
    action.endsWith("deleted") ||
    action.endsWith("removed")
  );
}
