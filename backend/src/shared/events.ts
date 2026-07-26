import amqp from "amqplib";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Barramento de eventos (RabbitMQ) — comunicação assíncrona entre módulos
 * (SPEC seções 4.1 e 12). Mesmo em monólito modular, publicamos/consumimos
 * eventos por um exchange nomeado para que cada módulo já dependa apenas do
 * CONTRATO de evento, não do outro módulo. Quando um módulo virar
 * microserviço, o contrato permanece o mesmo.
 *
 * Padrão de nomenclatura: `entidade.acao` (ex.: `property.created`).
 */
const EXCHANGE = "imobiliaria.events";

let channel: amqp.Channel | null = null;
let connection: amqp.ChannelModel | null = null;

export async function connectEvents(): Promise<void> {
  try {
    const conn = await amqp.connect(env.RABBITMQ_URL);
    connection = conn;
    channel = await conn.createChannel();
    await channel.assertExchange(EXCHANGE, "topic", { durable: true });
    // Se o canal cair (broker reiniciado etc.), zera a referência para que
    // publish() volte ao caminho offline em vez de lançar "Channel closed".
    channel.on("error", () => (channel = null));
    channel.on("close", () => (channel = null));
    logger.info("rabbitmq conectado");
  } catch (err) {
    logger.warn({ err }, "não foi possível conectar ao rabbitmq (eventos desabilitados)");
  }
}

export interface DomainEvent<T = unknown> {
  /** ex.: "property.created" */
  type: string;
  tenantId: string;
  /** id único para idempotência/dedup no consumidor (SPEC 4.1) */
  eventId: string;
  occurredAt: string;
  payload: T;
}

/**
 * Encerra canal e conexão no shutdown gracioso. Sem isso, um consumidor ativo
 * mantém o processo vivo (o socket do amqplib segura o event loop) e o
 * `process.exit` acaba matando um evento em processamento no meio.
 */
export async function closeEvents(): Promise<void> {
  try {
    await channel?.close();
    await connection?.close();
  } catch {
    /* já estava fechado ou o broker sumiu — nada a fazer no shutdown */
  } finally {
    channel = null;
    connection = null;
  }
}

/**
 * Assina padrões de routing key e processa cada evento com `handler`.
 *
 * A fila é durável e nomeada: eventos publicados enquanto o consumidor está fora
 * do ar ficam guardados e são entregues quando ele volta. Fila anônima
 * (`exclusive`) perderia tudo a cada reinício do backend.
 *
 * O ack é manual e só acontece depois do handler retornar — se o processo cair
 * no meio, o RabbitMQ reentrega. Em falha, `nack(requeue: false)`: reenfileirar
 * um evento que já falhou uma vez costuma só repetir o mesmo erro em laço
 * infinito, ocupando o consumidor. O evento sai da fila e o erro fica no log.
 *
 * ATENÇÃO: com reentrega, o handler PRECISA ser idempotente por `eventId`
 * (SPEC 4.1 e 12) — ou, como no indexador do RAG, ser naturalmente idempotente
 * (apagar-e-reinserir dá o mesmo resultado quantas vezes rodar).
 *
 * Tolerante a broker ausente, como o `publish` já é: sem RabbitMQ o backend
 * sobe normalmente e só não reindexa em tempo real.
 */
export async function subscribe(
  queue: string,
  patterns: string[],
  handler: (event: DomainEvent) => Promise<void>,
): Promise<void> {
  if (!channel) {
    logger.warn({ queue }, "consumidor não iniciado (rabbitmq offline)");
    return;
  }
  try {
    await channel.assertQueue(queue, { durable: true });
    for (const pattern of patterns) {
      await channel.bindQueue(queue, EXCHANGE, pattern);
    }
    await channel.consume(queue, (msg) => {
      if (!msg) return;
      void (async () => {
        try {
          const event = JSON.parse(msg.content.toString()) as DomainEvent;
          await handler(event);
          channel?.ack(msg);
        } catch (err) {
          logger.warn({ err, queue }, "falha ao processar evento (descartado)");
          channel?.nack(msg, false, false);
        }
      })();
    });
    logger.info({ queue, patterns }, "consumidor de eventos iniciado");
  } catch (err) {
    logger.warn({ err, queue }, "não foi possível iniciar o consumidor de eventos");
  }
}

export async function publish<T>(event: DomainEvent<T>): Promise<void> {
  if (!channel) {
    logger.debug({ type: event.type }, "evento não publicado (rabbitmq offline)");
    return;
  }
  // Publicar evento é best-effort (SPEC 4.1): uma falha do barramento NUNCA pode
  // derrubar a escrita de domínio que já foi confirmada. Um canal fechado faz
  // channel.publish lançar de forma síncrona — por isso o try/catch.
  try {
    channel.publish(
      EXCHANGE,
      event.type,
      Buffer.from(JSON.stringify(event)),
      { persistent: true, messageId: event.eventId },
    );
  } catch (err) {
    logger.warn({ err, type: event.type }, "falha ao publicar evento (ignorada)");
  }
}
