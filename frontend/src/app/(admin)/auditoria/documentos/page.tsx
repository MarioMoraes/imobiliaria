import Link from "next/link";
import { PageHeader, StatCard, Section, EmptyState, FilterNotice } from "../../../../components/ui";
import { Icon } from "../../../../components/Icon";
import {
  fetchContracts,
  fetchDocumentCounts,
  fetchDocuments,
  fetchPersons,
  fetchProperties,
  type DocumentRecord,
} from "../../../../lib/api";
import { formatDay } from "../../../../lib/format";
import { matches, readQuery } from "../../../../lib/filter";

/**
 * Biblioteca documental (MOD-DOC) — todos os documentos do tenant num lugar só.
 * É de leitura: anexar e substituir acontecem na aba Documentos da ficha da
 * entidade, onde o operador já está trabalhando.
 */

const KIND_LABEL: Record<string, string> = {
  RG: "RG / Identidade",
  CPF: "CPF / CNPJ",
  RENDA: "Comprovante de renda",
  MATRICULA: "Matrícula do imóvel",
  CONTRATO: "Contrato",
  OUTRO: "Outro",
};

const ENTITY_LABEL: Record<string, string> = {
  PERSON: "Pessoa",
  PROPERTY: "Imóvel",
  CONTRACT: "Contrato",
};

/** Sem tela de detalhe, o nome leva à lista da entidade já filtrada (como a busca global). */
function entityHref(entityType: string, name: string): string {
  const q = `?q=${encodeURIComponent(name)}`;
  if (entityType === "PROPERTY") return `/imoveis/alugar${q}`;
  if (entityType === "CONTRACT") return `/contratos${q}`;
  return `/clientes${q}`;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default async function DocumentosPage({
  searchParams,
}: {
  searchParams?: Promise<{ q?: string }>;
}) {
  // `q` vem da busca global do topo — a lista chega já filtrada.
  const q = await readQuery(searchParams);

  // O documento guarda só o id da entidade (vínculo polimórfico, sem FK). Os
  // nomes vêm dos módulos donos e são resolvidos aqui, na composição da tela.
  const [live, counts, persons, properties, contracts] = await Promise.all([
    fetchDocuments(),
    fetchDocumentCounts(),
    fetchPersons(),
    fetchProperties(),
    fetchContracts(),
  ]);

  const names = new Map<string, string>();
  for (const p of persons ?? []) names.set(p.id, p.fullName);
  for (const p of properties ?? []) names.set(p.id, p.title);
  for (const c of contracts ?? []) names.set(c.id, `Contrato ${c.code ?? "—"}`);
  const nameOf = (doc: DocumentRecord) => names.get(doc.entityId) ?? "(registro removido)";

  const isLive = live !== null;
  const documents = (live ?? []).filter((d) =>
    matches(q, d.fileName, KIND_LABEL[d.kind] ?? d.kind, nameOf(d)),
  );

  return (
    <>
      <PageHeader title="Documentos" backHref="/auditoria" />

      <FilterNotice term={q} count={documents.length} clearHref="/auditoria/documentos" />

      <div className="grid grid-3 mb-4">
        <StatCard
          icon="folder"
          label="Documentos"
          value={String(counts?.total ?? documents.length)}
          tone="blue"
        />
        <StatCard
          icon="clock"
          label="A vencer em 30 dias"
          value={String(counts?.expiring30 ?? 0)}
          tone="warning"
        />
        <StatCard
          icon="shield"
          label="Vencidos"
          value={String(counts?.expired ?? 0)}
          tone={counts && counts.expired > 0 ? "warning" : "success"}
        />
      </div>

      <Section title="Biblioteca documental">
        {documents.length === 0 ? (
          <EmptyState
            icon="folder"
            title={isLive ? "Nenhum documento anexado" : "Backend offline"}
            hint={
              isLive
                ? "Anexe pela aba Documentos na ficha da pessoa ou no cadastro do imóvel."
                : "Suba a infra e o backend (npm run dev) para carregar a biblioteca."
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Documento</th>
                  <th>Vinculado a</th>
                  <th>Tipo</th>
                  <th>Validade</th>
                  <th>Versão</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {documents.map((doc) => {
                  const name = nameOf(doc);
                  return (
                    <tr key={doc.id}>
                      <td>
                        <div className="cell-main">
                          <span className="stat-icon" style={{ width: 34, height: 34, marginBottom: 0 }}>
                            <Icon name={doc.mime === "application/pdf" ? "contract" : "folder"} size={16} />
                          </span>
                          <span>
                            <span className="strong">{doc.fileName ?? "—"}</span>
                            <span className="text-xs subtle"> · {formatSize(doc.sizeBytes)}</span>
                          </span>
                        </div>
                      </td>
                      <td className="text-sm">
                        <span className="badge badge-slate">
                          {ENTITY_LABEL[doc.entityType] ?? doc.entityType}
                        </span>{" "}
                        <Link href={entityHref(doc.entityType, name)}>{name}</Link>
                      </td>
                      <td className="text-sm">{KIND_LABEL[doc.kind] ?? doc.kind}</td>
                      <td className="text-sm">
                        {!doc.expiresAt ? (
                          <span className="subtle">—</span>
                        ) : doc.expired ? (
                          <span style={{ color: "var(--danger)" }}>
                            {formatDay(doc.expiresAt)} · vencido
                          </span>
                        ) : (
                          formatDay(doc.expiresAt)
                        )}
                      </td>
                      <td className="text-sm subtle">v{doc.currentVersion}</td>
                      <td>
                        <div className="row gap-8" style={{ justifyContent: "flex-end" }}>
                          {doc.url && (
                            <a
                              className="icon-btn"
                              style={{ width: 30, height: 30 }}
                              href={doc.url}
                              target="_blank"
                              rel="noopener"
                              aria-label="Baixar"
                              title="Baixar"
                            >
                              <Icon name="arrowUpRight" size={15} />
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>
    </>
  );
}
