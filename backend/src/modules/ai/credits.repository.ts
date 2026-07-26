import { withTenant } from "../../shared/db.js";
import type { Credits } from "./ai.schema.js";

/**
 * Créditos de IA (MOD-AI-10, AC-01/AC-03).
 *
 * O ciclo é reservar → cobrar → (ou estornar). Cada operação é um único UPDATE
 * condicional: a atomicidade vem do próprio Postgres, sem SELECT-then-UPDATE
 * (que em READ COMMITTED deixaria duas perguntas simultâneas passarem pelo
 * mesmo teste de saldo e estourarem o limite juntas).
 *
 * `reserved` é o que separa "tem saldo" de "tem saldo disponível": enquanto a
 * chamada ao LLM está no ar o valor fica empenhado, e só vira `used` quando o
 * consumo real volta do provedor.
 */

/** 1 crédito = 1.000 tokens (entrada + saída), arredondado para cima. */
export function tokensToCredits(tokens: number): number {
  return Math.ceil(Math.max(tokens, 0) / 1000);
}

export async function getCredits(tenantId: string): Promise<Credits> {
  return withTenant(tenantId, async (client) => {
    const { rows } = await client.query<{ balance: string; reserved: string; used: string }>(
      "SELECT balance, reserved, used FROM ai_credits WHERE tenant_id = $1",
      [tenantId],
    );
    const row = rows[0];
    // Tenant sem linha ainda não comprou créditos: zero em tudo é a leitura
    // correta, e evita um 404 numa tela que só quer mostrar saldo.
    if (!row) return { balance: 0, reserved: 0, used: 0, available: 0 };
    const balance = Number(row.balance);
    const reserved = Number(row.reserved);
    return { balance, reserved, used: Number(row.used), available: balance - reserved };
  });
}

/**
 * Empenha `amount` créditos. Devolve false quando não há disponível — o service
 * traduz isso em 402 ERR_AI_006. O `WHERE balance - reserved >= $2` é o gate:
 * se a condição não casar, `rowCount` volta 0 e nada foi alterado.
 */
export async function reserve(tenantId: string, amount: number): Promise<boolean> {
  if (amount <= 0) return true;
  return withTenant(tenantId, async (client) => {
    const result = await client.query(
      `UPDATE ai_credits
          SET reserved = reserved + $2, updated_at = now()
        WHERE tenant_id = $1 AND balance - reserved >= $2`,
      [tenantId, amount],
    );
    return (result.rowCount ?? 0) > 0;
  });
}

/**
 * Confirma o gasto: libera a reserva e debita o consumo REAL.
 *
 * `reserved` e `used` andam com valores diferentes de propósito — a reserva foi
 * uma estimativa feita antes da resposta, o débito é o que o provedor cobrou. O
 * `GREATEST(...)` protege contra o consumo real superar o saldo (uma resposta
 * mais longa que o previsto): o pior caso é o saldo zerar, nunca ficar negativo
 * — o CHECK da tabela recusaria o UPDATE inteiro e a resposta já entregue
 * ficaria sem cobrança nenhuma.
 */
export async function commit(
  tenantId: string,
  reservedAmount: number,
  actualAmount: number,
): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE ai_credits
          SET reserved = GREATEST(reserved - $2, 0),
              used     = used + $3,
              balance  = GREATEST(balance - $3, 0),
              updated_at = now()
        WHERE tenant_id = $1`,
      [tenantId, reservedAmount, actualAmount],
    );
  });
}

/**
 * Devolve a reserva sem cobrar nada. É o caminho de quando o provedor falha:
 * uma pergunta que não foi respondida não pode consumir crédito.
 */
export async function refund(tenantId: string, amount: number): Promise<void> {
  if (amount <= 0) return;
  await withTenant(tenantId, async (client) => {
    await client.query(
      `UPDATE ai_credits
          SET reserved = GREATEST(reserved - $2, 0), updated_at = now()
        WHERE tenant_id = $1`,
      [tenantId, amount],
    );
  });
}

/** Usado pelo seed/testes e pela futura tela de recarga. */
export async function grant(tenantId: string, amount: number): Promise<void> {
  await withTenant(tenantId, async (client) => {
    await client.query(
      `INSERT INTO ai_credits (tenant_id, balance) VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO UPDATE SET balance = ai_credits.balance + $2, updated_at = now()`,
      [tenantId, amount],
    );
  });
}
