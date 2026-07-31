import { Icon } from "./Icon";

/**
 * Aviso de rodapé "esta tela não conseguiu carregar/gravar".
 *
 * Existe para não repetir o erro que ele substitui: cada tela cravava
 * "Backend offline — suba `npm run dev`", que era a leitura de UMA das causas
 * possíveis de `fetch` sem dado. Com o backend no ar respondendo 401, a tela
 * mandava o usuário subir um processo que já estava rodando. Quem sabe a causa
 * é `lib/api.ts` (`backendNotice()`), então a mensagem vem de lá — aqui só se
 * decide como ela aparece.
 *
 * `message` nulo não renderiza nada: sem falha registrada, a tela está apenas
 * vazia, e vazio não é erro.
 */
export function BackendNotice({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <span className="text-xs subtle">
      <Icon name="server" size={12} /> {message}
    </span>
  );
}

/**
 * Texto usado quando o componente não recebeu diagnóstico (Client Component
 * cujo pai não repassou o `notice`). Genérico de propósito: melhor não dizer a
 * causa do que dizer a errada.
 */
export const GENERIC_BACKEND_NOTICE = "Não foi possível carregar os dados do servidor.";
