import { Agent } from "node:https";
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "../config/env.js";
import { logger } from "./logger.js";

/**
 * Object storage S3-compatível (MinIO em dev, S3/R2 em produção). A mídia
 * (fotos de imóveis) mora no bucket; o Postgres guarda só a chave (storage_key).
 * O binário nunca entra na base — leituras vão direto do bucket via URL
 * presignada (o backend não fica no caminho de download).
 */
export const s3 = new S3Client({
  // Endpoint só é definido quando há um custom (MinIO/R2). Vazio → o SDK usa o
  // endpoint padrão da AWS para a região (S3 nativo).
  ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
  region: env.S3_REGION,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
  forcePathStyle: env.S3_FORCE_PATH_STYLE, // MinIO exige path-style
  // Resolve o storage sobre IPv4. O R2 publica AAAA (IPv6) e, em redes com
  // rota IPv6 quebrada, o happy-eyeballs escolhe IPv6 e o handshake falha/pendura.
  // family:4 força IPv4 só para o storage (não afeta os demais serviços).
  requestHandler: new NodeHttpHandler({ httpsAgent: new Agent({ family: 4 }) }),
});

// Garante o bucket uma única vez (promise cacheada). Em falha, zera o cache
// para permitir nova tentativa no próximo uso.
let bucketReady: Promise<void> | null = null;
function ensureBucket(): Promise<void> {
  if (!bucketReady) {
    bucketReady = (async () => {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
      } catch {
        // Bucket não visível (não existe ou token sem permissão de Head).
        // Tenta criar; se já existir (criado no painel/outra instância), segue.
        try {
          await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
          logger.info({ bucket: env.S3_BUCKET }, "bucket de mídia criado");
        } catch (err: unknown) {
          const name = (err as { name?: string })?.name ?? "";
          if (name !== "BucketAlreadyOwnedByYou" && name !== "BucketAlreadyExists") {
            throw err;
          }
        }
      }
    })().catch((err: unknown) => {
      bucketReady = null;
      throw err;
    });
  }
  return bucketReady;
}

export async function putObject(
  key: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  await ensureBucket();
  await s3.send(
    new PutObjectCommand({
      Bucket: env.S3_BUCKET,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
}

/** URL temporária de leitura (default 1h) — usada pelo `<img>` do frontend. */
export function presignGetUrl(key: string, expiresIn = 3600): Promise<string> {
  return getSignedUrl(
    s3,
    new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key }),
    { expiresIn },
  );
}

export async function deleteObject(key: string): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: key }));
}
