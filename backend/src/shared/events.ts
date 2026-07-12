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

export async function connectEvents(): Promise<void> {
  try {
    const conn = await amqp.connect(env.RABBITMQ_URL);
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
