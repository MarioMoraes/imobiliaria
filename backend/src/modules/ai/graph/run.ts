import { classifyIntent } from "./classify-intent.js";
import { ragLookup } from "./rag-lookup.js";
import { respond } from "./respond.js";
import { checkHandoff } from "./check-handoff.js";
import type { AgentDeps, AgentState, Node } from "./state.js";

/**
 * Executor do grafo.
 *
 * O grafo do PRD é uma sequência: classificar → recuperar → responder →
 * avaliar handoff. Sem ramificação, sem ciclo — o único laço real (pedir
 * ferramenta, executar, continuar) vive dentro do nó `respond`, tocado pelo
 * tool runner do provedor.
 *
 * Por isso um array de nós tipados basta, e é o argumento inteiro para não
 * trazer um framework de grafos: o dia em que houver ramificação de verdade,
 * este arquivo é o único que muda.
 */
const PIPELINE: Node[] = [classifyIntent, ragLookup, respond, checkHandoff];

export async function runGraph(state: AgentState, deps: AgentDeps): Promise<AgentState> {
  let current = state;
  for (const node of PIPELINE) {
    current = await node(current, deps);
  }
  return current;
}
