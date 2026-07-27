/**
 * Limpeza do texto que sai do modelo, antes de virar resposta.
 *
 * O agente PRECISA dos ids: é com o UUID que ele chama `detalhar_imovel` e
 * `mostrar_fotos_imovel`, e por isso as ferramentas e o contexto do RAG marcam
 * cada imóvel com `[id: ...]`. O que ele não pode é repetir isso na resposta —
 * quem lê vê "8bb63ba6-43fd-4d59-ba94-1eb5cd665856" e não faz ideia do que
 * seja. O número que serve para uma pessoa é o CÓDIGO do imóvel.
 *
 * Por que um filtro e não só uma regra no prompt: o prompt reduz a frequência,
 * não elimina o caso. Um id vazado é ruído garantido na cara de quem pergunta,
 * e a remoção é decidível por regex — quando dá para garantir determinismo,
 * garantir sai mais barato do que pedir. As duas coisas convivem: a regra no
 * prompt evita a frase malformada ("O imóvel , no Centro"), o filtro cobre o
 * resto.
 */

const UUID = "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";

/** `[id: xxx]`, `(id: xxx)`, `[xxx]` — o formato que as ferramentas usam. */
const DELIMITADO = new RegExp(`\\s*[[(]\\s*(?:id\\s*[:=]?\\s*)?"?${UUID}"?\\s*[\\])]`, "gi");

/** `id: xxx`, `id="xxx"`, `"id":"xxx"` — o modelo às vezes cola o JSON cru. */
const ROTULADO = new RegExp(`\\s*"?\\bid"?\\s*[:=]\\s*"?${UUID}"?`, "gi");

/** O UUID sozinho, sem rótulo nenhum. */
const NU = new RegExp(UUID, "gi");

/**
 * Remove ids internos do texto e fecha os buracos que a remoção deixa.
 *
 * A ordem importa: do mais específico para o mais genérico. Tirar o UUID nu
 * primeiro deixaria para trás um `[id: ]` órfão, que é pior do que o id.
 */
export function stripInternalIds(text: string): string {
  return (
    text
      .replace(DELIMITADO, "")
      .replace(ROTULADO, "")
      .replace(NU, "")
      // Sobras da remoção: delimitador vazio, espaço duplo no meio da frase e
      // espaço solto antes da pontuação ("O imóvel , no Centro").
      .replace(/[[(]\s*[\])]/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+([,.;:!?)\]])/g, "$1")
      .replace(/([([])[ \t]+/g, "$1")
      .split("\n")
      .map((line) => line.trimEnd())
      .join("\n")
      .trim()
  );
}
