/**
 * Contratos dos provedores de IA — o ponto de troca do módulo.
 *
 * Ficavam dentro de `anthropic.client.ts`, o que fazia sentido enquanto havia
 * um implementador só. Com um segundo (Gemini), manter o contrato no arquivo de
 * um dos provedores obrigaria o outro a importar dele — como se um fosse
 * derivado do outro. Aqui os dois são pares.
 *
 * É também o que permite testar o grafo sem rede: a suíte injeta duplos que
 * implementam estas mesmas interfaces.
 */

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * JSON Schema de entrada de uma ferramenta. Escrito à mão (não gerado do zod)
 * de propósito: o backend já usa zod na borda HTTP, e acoplar as tools ao
 * formato que cada SDK espera criaria um segundo lugar para brigar de versão.
 * Os dois provedores aceitam JSON Schema cru.
 */
export interface ToolInputProperty {
  type: "string" | "number" | "integer" | "boolean" | "array" | "object" | "null";
  description?: string;
  enum?: readonly string[];
  items?: ToolInputProperty;
}

export interface ToolInputSchema {
  type: "object";
  properties: Record<string, ToolInputProperty>;
  required?: readonly string[];
  additionalProperties?: boolean;
}

/** Definição de ferramenta já pronta para o provedor. */
export interface LlmTool {
  name: string;
  description: string;
  inputSchema: ToolInputSchema;
  /** Executa a ferramenta. Devolve o texto que volta ao modelo. */
  run: (input: Record<string, unknown>) => Promise<string>;
}

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmAnswer {
  text: string;
  usage: LlmUsage;
}

export interface LlmClient {
  /** true quando há credencial configurada. Sem ela, as rotas devolvem 503. */
  isConfigured(): boolean;
  /** Conversa com ferramentas: roda o laço até o modelo parar de chamá-las. */
  converse(params: {
    system: string;
    messages: LlmMessage[];
    tools: LlmTool[];
    maxTokens?: number;
  }): Promise<LlmAnswer>;
  /** Classificação com saída estruturada (modelo rápido). */
  classify<T>(params: {
    system: string;
    input: string;
    schema: Record<string, unknown>;
  }): Promise<T>;
}

/**
 * Dimensão do vetor no índice. É CONTRATO DE BANCO, não preferência do
 * provedor: a coluna é `rag_chunks.embedding vector(1024)`. Um provedor que não
 * consiga produzir exatamente esta dimensão exige recriar a tabela — por isso o
 * valor vive aqui, e não dentro de um cliente específico.
 */
export const EMBEDDING_DIMENSIONS = 1024;

export interface EmbeddingClient {
  isConfigured(): boolean;
  /**
   * `inputType` importa: documento e consulta são embedados em espaços
   * levemente diferentes, e usar o mesmo para os dois piora o recall.
   */
  embed(texts: string[], inputType: "document" | "query"): Promise<number[][]>;
}

/** Formato aceito pelo pgvector no bind de parâmetro: `[0.1,0.2,...]`. */
export function toVectorLiteral(embedding: number[]): string {
  return `[${embedding.join(",")}]`;
}
