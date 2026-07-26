import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../app.js";
import { withTenant } from "../../shared/db.js";
import * as credits from "./credits.repository.js";
import * as ragRepo from "./rag/rag.repository.js";
import * as aiRepo from "./ai.repository.js";
import { chat } from "./ai.service.js";
import { llmClient } from "./providers/index.js";
import {
  EMBEDDING_DIMENSIONS,
  type EmbeddingClient,
  type LlmClient,
  type LlmTool,
} from "./providers/types.js";

/**
 * Suíte do MOD-AI. Depende da infra de pé (`npm run infra:up`) — Postgres real
 * com pgvector, como o resto dos testes de integração do projeto.
 *
 * Nenhum teste chama API externa: os provedores são injetados como duplos. Essa
 * é a razão de `LlmClient`/`EmbeddingClient` serem interfaces e de o service
 * aceitar `deps` — sem isso, testar o grafo exigiria rede, e um teste que
 * depende de rede não roda no CI.
 *
 * Rode um só:
 *   node --import tsx --test backend/src/modules/ai/ai.test.ts
 */

const DEMO_TENANT = "00000000-0000-0000-0000-000000000001";
const OTHER_TENANT = "00000000-0000-0000-0000-0000000000ff";

/* ------------------------------------------------------------- duplos */

/** Vetor determinístico: mesma semente → mesmo vetor, sem rede. */
function fakeEmbedding(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSIONS }, (_, i) => Math.sin(seed + i) / 10);
}

function stubEmbeddings(seed = 1): EmbeddingClient {
  return {
    isConfigured: () => true,
    embed: async (texts) => texts.map(() => fakeEmbedding(seed)),
  };
}

interface StubLlmOptions {
  /** Ferramentas que o "modelo" decide chamar, na ordem. */
  callTools?: { name: string; input: Record<string, unknown> }[];
  answer?: string;
}

/** Guarda o que as ferramentas devolveram, para o teste inspecionar. */
interface StubLlm extends LlmClient {
  toolResults: string[];
  lastTools: LlmTool[];
}

function stubLlm(options: StubLlmOptions = {}): StubLlm {
  const stub: StubLlm = {
    toolResults: [],
    lastTools: [],
    isConfigured: () => true,
    classify: async () => ({ intent: "imovel", sentiment: "NEU" }) as never,
    converse: async ({ tools }) => {
      stub.lastTools = tools;
      for (const call of options.callTools ?? []) {
        const tool = tools.find((t) => t.name === call.name);
        assert.ok(tool, `ferramenta ${call.name} deveria estar declarada`);
        stub.toolResults.push(await tool.run(call.input));
      }
      return {
        text: options.answer ?? "resposta de teste",
        usage: { inputTokens: 1200, outputTokens: 800 },
      };
    },
  };
  return stub;
}

/* --------------------------------------------- 1. isolamento no RAG */

/**
 * O teste mais importante do módulo (SPEC 3.1 e 14; RN-04/AC-02 do PRD).
 *
 * O índice HNSW é global — o grafo ANN não conhece tenant. Quem separa é a
 * policy de RLS, aplicada sobre as linhas que o índice devolve. Este teste é o
 * que prova que essa separação funciona: indexa no tenant demo e busca pelo
 * MESMO vetor no outro tenant, onde a distância seria zero se vazasse.
 */
test("RAG: chunk indexado num tenant não é encontrado por outro", async () => {
  const entityId = randomUUID();
  const embedding = fakeEmbedding(42);

  await ragRepo.replaceChunks(
    DEMO_TENANT,
    "property",
    entityId,
    [
      {
        entityType: "property",
        entityId,
        chunkIndex: 0,
        content: "Apartamento de teste de isolamento, 2 quartos, bairro Centro.",
        embedding,
      },
    ],
    "hash-de-teste",
  );

  const mine = await ragRepo.searchSimilar(DEMO_TENANT, embedding, 10);
  assert.ok(
    mine.some((c) => c.entityId === entityId),
    "o tenant dono deve encontrar o próprio chunk",
  );

  const theirs = await ragRepo.searchSimilar(OTHER_TENANT, embedding, 10);
  assert.ok(
    !theirs.some((c) => c.entityId === entityId),
    "TENANT LEAKAGE: outro tenant não pode encontrar o chunk pela busca vetorial",
  );

  await ragRepo.removeEntity(DEMO_TENANT, "property", entityId);
});

test("RAG: metadados de indexação também não vazam entre tenants", async () => {
  const entityId = randomUUID();
  await ragRepo.replaceChunks(
    DEMO_TENANT,
    "property",
    entityId,
    [
      {
        entityType: "property",
        entityId,
        chunkIndex: 0,
        content: "conteúdo",
        embedding: fakeEmbedding(7),
      },
    ],
    "hash-abc",
  );

  assert.equal(await ragRepo.getIndexedHash(DEMO_TENANT, "property", entityId), "hash-abc");
  assert.equal(
    await ragRepo.getIndexedHash(OTHER_TENANT, "property", entityId),
    null,
    "TENANT LEAKAGE: o hash de indexação de outro tenant ficou visível",
  );

  await ragRepo.removeEntity(DEMO_TENANT, "property", entityId);
});

/* ----------------------------------------------------- 2. créditos */

test("créditos: reserva falha sem saldo disponível", async () => {
  const before = await credits.getCredits(DEMO_TENANT);
  const ok = await credits.reserve(DEMO_TENANT, before.available + 1000);
  assert.equal(ok, false, "não deveria reservar mais que o disponível");

  const after = await credits.getCredits(DEMO_TENANT);
  assert.equal(after.reserved, before.reserved, "uma reserva recusada não pode empenhar nada");
});

test("créditos: reserva → commit debita o consumo real", async () => {
  await credits.grant(DEMO_TENANT, 500);
  const before = await credits.getCredits(DEMO_TENANT);

  assert.equal(await credits.reserve(DEMO_TENANT, 100), true);
  const reserved = await credits.getCredits(DEMO_TENANT);
  assert.equal(reserved.reserved, before.reserved + 100);
  assert.equal(
    reserved.available,
    before.available - 100,
    "a reserva tem que sair do disponível na hora, senão duas perguntas simultâneas furam o saldo",
  );

  // Consumo real (30) menor que a reserva (100): é o caso comum, já que a
  // reserva estima pelo teto de max_tokens.
  await credits.commit(DEMO_TENANT, 100, 30);
  const after = await credits.getCredits(DEMO_TENANT);
  assert.equal(after.reserved, before.reserved, "a reserva tem que ser liberada");
  assert.equal(after.balance, before.balance - 30, "só o consumo real debita o saldo");
  assert.equal(after.used, before.used + 30);
});

test("créditos: estorno devolve a reserva sem cobrar", async () => {
  await credits.grant(DEMO_TENANT, 500);
  const before = await credits.getCredits(DEMO_TENANT);

  assert.equal(await credits.reserve(DEMO_TENANT, 200), true);
  await credits.refund(DEMO_TENANT, 200);

  const after = await credits.getCredits(DEMO_TENANT);
  assert.equal(after.balance, before.balance, "uma pergunta que falhou não pode custar nada");
  assert.equal(after.reserved, before.reserved);
  assert.equal(after.used, before.used);
});

/* -------------------------------------------------------- 3. grafo */

test("grafo: a conversa e a chamada de ferramenta ficam auditadas", async () => {
  await credits.grant(DEMO_TENANT, 1000);
  const llm = stubLlm({
    callTools: [{ name: "buscar_imoveis", input: { termo: "Centro" } }],
    answer: "Encontrei alguns imóveis no Centro.",
  });

  const result = await chat(
    DEMO_TENANT,
    { message: "Tem imóvel no Centro?", roles: ["ADMIN"] },
    { llm, embeddings: stubEmbeddings() },
  );

  assert.equal(result.answer, "Encontrei alguns imóveis no Centro.");
  assert.ok(result.creditsUsed > 0, "a resposta tem que debitar crédito");

  const detail = await aiRepo.findConversationDetail(DEMO_TENANT, result.conversationId);
  assert.ok(detail);
  assert.deepEqual(
    detail.messages.map((m) => m.role),
    ["user", "assistant"],
    "pergunta e resposta devem ficar gravadas, nessa ordem",
  );
  assert.equal(detail.messages[0]!.content, "Tem imóvel no Centro?");

  const call = detail.toolCalls.find((t) => t.tool === "buscar_imoveis");
  assert.ok(call, "a chamada de ferramenta tem que virar trilha de auditoria");
  assert.equal(call.status, "OK");
});

/**
 * O invariante que separa este módulo de um vazamento: as ferramentas rodam com
 * a permissão de QUEM PERGUNTOU. FINANCEIRO não tem `person:read`, então a
 * ferramenta de pessoas tem que ser recusada — e a recusa tem que voltar ao
 * modelo como texto, não estourar a requisição.
 */
test("grafo: ferramenta sem permissão é negada, e a conversa continua", async () => {
  await credits.grant(DEMO_TENANT, 1000);
  const llm = stubLlm({
    callTools: [{ name: "buscar_pessoas", input: { termo: "Maria" } }],
    answer: "Não tenho acesso a esses dados.",
  });

  const result = await chat(
    DEMO_TENANT,
    { message: "Quem é a inquilina do 101?", roles: ["FINANCEIRO"] },
    { llm, embeddings: stubEmbeddings() },
  );

  assert.match(
    llm.toolResults[0] ?? "",
    /Acesso negado/,
    "a ferramenta devolve a recusa AO MODELO em vez de lançar",
  );
  assert.ok(result.answer, "a requisição não pode falhar por causa da recusa");

  const detail = await aiRepo.findConversationDetail(DEMO_TENANT, result.conversationId);
  const call = detail!.toolCalls.find((t) => t.tool === "buscar_pessoas");
  assert.equal(call?.status, "DENIED", "a recusa tem que aparecer na auditoria");
});

test("grafo: falha do provedor estorna a reserva", async () => {
  await credits.grant(DEMO_TENANT, 1000);
  const before = await credits.getCredits(DEMO_TENANT);

  const failing: LlmClient = {
    isConfigured: () => true,
    classify: async () => ({ intent: "imovel", sentiment: "NEU" }) as never,
    converse: async () => {
      throw new Error("provedor fora do ar");
    },
  };

  await assert.rejects(
    chat(
      DEMO_TENANT,
      { message: "Alguma coisa?", roles: ["ADMIN"] },
      { llm: failing, embeddings: stubEmbeddings() },
    ),
  );

  const after = await credits.getCredits(DEMO_TENANT);
  assert.equal(after.available, before.available, "a falha não pode consumir crédito");
  assert.equal(after.reserved, before.reserved, "a reserva tem que ser estornada");
});

test("chat: sem créditos responde 402 ERR_AI_006", async () => {
  // Zera o disponível empenhando tudo, sem mexer no saldo real do tenant demo.
  const current = await credits.getCredits(DEMO_TENANT);
  await credits.reserve(DEMO_TENANT, current.available);

  try {
    await assert.rejects(
      chat(
        DEMO_TENANT,
        { message: "Tem imóvel disponível?", roles: ["ADMIN"] },
        { llm: stubLlm(), embeddings: stubEmbeddings() },
      ),
      (err: { code?: string; statusCode?: number }) =>
        err.code === "ERR_AI_006" && err.statusCode === 402,
    );
  } finally {
    await credits.refund(DEMO_TENANT, current.available);
  }
});

/* ---------------------------------------- 4. isolamento da conversa */

test("conversas: uma conversa não é visível por outro tenant", async () => {
  const conversation = await aiRepo.createConversation(DEMO_TENANT, { channel: "WEB" });
  await aiRepo.insertMessage(DEMO_TENANT, conversation.id, {
    role: "user",
    content: "pergunta confidencial",
  });

  assert.ok(await aiRepo.findConversation(DEMO_TENANT, conversation.id));
  assert.equal(
    await aiRepo.findConversation(OTHER_TENANT, conversation.id),
    null,
    "TENANT LEAKAGE: outro tenant não pode ler a conversa",
  );
});

test("mensagens ficam cifradas em repouso", async () => {
  const conversation = await aiRepo.createConversation(DEMO_TENANT, { channel: "WEB" });
  const segredo = `segredo-${randomUUID()}`;
  await aiRepo.insertMessage(DEMO_TENANT, conversation.id, { role: "user", content: segredo });

  // Lê a coluna crua: o texto em claro não pode estar lá.
  const raw = await withTenant(DEMO_TENANT, async (client) => {
    const { rows } = await client.query<{ content_enc: string }>(
      "SELECT content_enc FROM agent_messages WHERE conversation_id = $1",
      [conversation.id],
    );
    return rows[0]!.content_enc;
  });

  assert.ok(!raw.includes(segredo), "o conteúdo não pode ficar em claro no banco");
  assert.ok(raw.startsWith("v1."), "deve usar o formato versionado de shared/crypto");

  const messages = await aiRepo.listMessages(DEMO_TENANT, conversation.id);
  assert.equal(messages[0]!.content, segredo, "a leitura tem que decifrar de volta");
});

/* ------------------------------------------------------- 5. rotas */

/**
 * Gate das rotas, por `app.inject` (mesmo molde de payment.webhook.test.ts).
 *
 * A suíte roda com AUTH_DEV_MODE=true (ver o script `test`), então os papéis
 * chegam pelo header `x-dev-roles` — é o que permite exercitar a matriz de RBAC
 * sem um token do Clerk.
 */
let app: FastifyInstance;

before(async () => {
  app = await buildApp();
});

after(async () => {
  await app.close();
});

function headers(roles: string) {
  return { "x-tenant-id": DEMO_TENANT, "x-dev-roles": roles };
}

test("rotas: sem ai:use, POST /v1/ai/chat responde 403", async () => {
  // PROPRIETARIO não está na matriz de `ai:use`.
  const res = await app.inject({
    method: "POST",
    url: "/v1/ai/chat",
    headers: headers("PROPRIETARIO"),
    payload: { message: "tem imóvel disponível?" },
  });

  assert.equal(res.statusCode, 403);
  assert.equal(res.json().error.code, "ERR_AUTH_003");
});

test("rotas: sem ai:read, GET /v1/ai/conversations responde 403", async () => {
  // CORRETOR pode PERGUNTAR (ai:use) mas não pode ler o histórico dos outros.
  const res = await app.inject({
    method: "GET",
    url: "/v1/ai/conversations",
    headers: headers("CORRETOR"),
  });

  assert.equal(res.statusCode, 403);
});

test("rotas: sem ai:admin, POST /v1/ai/rag/reindex responde 403", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/ai/rag/reindex",
    headers: headers("GESTOR"),
    payload: {},
  });

  assert.equal(res.statusCode, 403);
});

test("rotas: mensagem vazia responde 422 ERR_AI_002", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/ai/chat",
    headers: headers("ADMIN"),
    payload: { message: "   " },
  });

  assert.equal(res.statusCode, 422);
  assert.equal(res.json().error.code, "ERR_AI_002");
});

/**
 * Sem chave da plataforma configurada, o copiloto responde 503 — e não 500. É a
 * diferença entre "o produto não tem essa integração ligada" e "quebrou".
 *
 * O teste só faz sentido quando a chave realmente não está no ambiente; numa
 * máquina com ANTHROPIC_API_KEY configurada ele seria uma chamada paga de
 * verdade, então aí é pulado.
 */
test("rotas: sem credencial do provedor, POST /v1/ai/chat responde 503", async (t) => {
  // A condição olha o provedor ATIVO (AI_PROVIDER), não a Anthropic: com
  // `AI_PROVIDER=gemini` e só a chave da Anthropic no ambiente, checar
  // ANTHROPIC_API_KEY pulava um teste que teria passado.
  if (llmClient().isConfigured()) {
    t.skip("provedor configurado — evitando chamada real e paga");
    return;
  }

  const res = await app.inject({
    method: "POST",
    url: "/v1/ai/chat",
    headers: headers("ADMIN"),
    payload: { message: "tem apartamento de 2 quartos?" },
  });

  assert.equal(res.statusCode, 503);
  assert.equal(res.json().error.code, "ERR_AI_005");
});

test("rotas: GET /v1/ai/credits devolve o saldo para quem tem ai:read", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/v1/ai/credits",
    headers: headers("ADMIN"),
  });

  assert.equal(res.statusCode, 200);
  const data = res.json().data as { balance: number; available: number };
  assert.equal(typeof data.balance, "number");
  assert.equal(typeof data.available, "number");
});

/**
 * O saldo é cota, o histórico é auditoria — e o gate de cada um é diferente.
 * FINANCEIRO pode perguntar ao copiloto (`ai:use`), então precisa enxergar
 * quanto resta; mas não vê o que os outros perguntaram (`ai:read`).
 */
test("rotas: quem tem ai:use (e não ai:read) vê o saldo, mas não o histórico", async () => {
  const saldo = await app.inject({
    method: "GET",
    url: "/v1/ai/credits",
    headers: headers("FINANCEIRO"),
  });
  assert.equal(saldo.statusCode, 200, "quem pode perguntar precisa ver o saldo");

  const historico = await app.inject({
    method: "GET",
    url: "/v1/ai/conversations",
    headers: headers("FINANCEIRO"),
  });
  assert.equal(historico.statusCode, 403, "o histórico continua restrito à gestão");
});

test("rotas: conversa inexistente responde 404 ERR_AI_001", async () => {
  const res = await app.inject({
    method: "GET",
    url: `/v1/ai/conversations/${randomUUID()}`,
    headers: headers("ADMIN"),
  });

  assert.equal(res.statusCode, 404);
  assert.equal(res.json().error.code, "ERR_AI_001");
});
