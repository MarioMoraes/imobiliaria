/**
 * Validação de UUID na borda.
 *
 * Motivo: `tenant_id` vem de fora (claim do JWT, header de dev, path de webhook)
 * e termina em `set_config('app.tenant_id', ...)`. O `set_config` aceita
 * qualquer string, mas as policies de RLS fazem
 * `current_setting('app.tenant_id')::uuid` — uma string inválida só estoura no
 * primeiro SELECT, como erro de cast do Postgres, virando 500 em vez do 400/401
 * que o caso merece (e enchendo o log a partir de endpoint público).
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}
