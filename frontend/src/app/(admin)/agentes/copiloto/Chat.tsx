"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../../../../components/Icon";
import { chatAction, type ChatAttachment } from "../chat-action";

/**
 * Conversa com o copiloto. Estado local + Server Action — mesmo padrão do
 * `GlobalSearch`, que é o análogo mais próximo de um input assíncrono que o
 * projeto já tinha.
 *
 * Sem renderizador de Markdown: o prompt de sistema manda o agente responder em
 * prosa, e o componente quebra parágrafos por linha. Trazer uma dependência de
 * Markdown para renderizar texto que pedimos para não ter Markdown seria dar a
 * volta no problema.
 */

interface Turn {
  role: "user" | "assistant";
  content: string;
  /** Fotos que o agente anexou a esta resposta. */
  attachments?: ChatAttachment[];
}

/**
 * Agrupa as fotos por imóvel preservando a ordem em que o agente as anexou —
 * uma pergunta pode pedir fotos de mais de um imóvel, e misturá-las numa
 * galeria só tiraria de quem olha a informação de qual foto é de qual.
 */
function groupBySource(attachments: ChatAttachment[]): [string, ChatAttachment[]][] {
  const groups: [string, ChatAttachment[]][] = [];
  for (const attachment of attachments) {
    const last = groups[groups.length - 1];
    if (last && last[0] === attachment.source) last[1].push(attachment);
    else groups.push([attachment.source, [attachment]]);
  }
  return groups;
}

const SUGESTOES = [
  "Quais imóveis de 2 quartos estão disponíveis?",
  "Tem alguma casa no Centro para alugar?",
  "Quais imóveis aceitam animais de estimação?",
];

export function Chat() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const conversationId = useRef<string | undefined>(undefined);
  const endRef = useRef<HTMLDivElement>(null);

  // Rola para a última mensagem a cada turno novo — sem isso a resposta nasce
  // fora da tela numa conversa longa.
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns, pending]);

  async function ask(question: string) {
    const message = question.trim();
    if (!message || pending) return;

    setError(null);
    setInput("");
    setTurns((prev) => [...prev, { role: "user", content: message }]);
    setPending(true);

    try {
      const result = await chatAction({
        conversationId: conversationId.current,
        message,
      });
      if (result.ok) {
        // Guardado a partir da primeira resposta: é o que dá memória à conversa
        // (o backend recompõe o histórico a partir deste id).
        conversationId.current = result.conversationId;
        setTurns((prev) => [
          ...prev,
          { role: "assistant", content: result.answer, attachments: result.attachments },
        ]);
      } else {
        setError(result.error);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="card chat">
      <div className="chat-log">
        {turns.length === 0 && !pending ? (
          <div className="chat-empty">
            <span className="stat-icon accent">
              <Icon name="sparkles" />
            </span>
            <p className="strong">Pergunte sobre o inventário da imobiliária</p>
            <p className="subtle text-sm">
              O copiloto consulta os imóveis e o cadastro reais — dentro do que o seu
              perfil pode ver.
            </p>
            <div className="chat-suggestions">
              {SUGESTOES.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => void ask(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {turns.map((turn, i) => (
          <div key={i} className={`chat-turn chat-turn-${turn.role}`}>
            <div className="chat-turn-content">
              <div className="chat-bubble">
                {turn.content.split("\n").map((line, j) => (
                <p key={j}>{line || " "}</p>
                ))}
              </div>

              {turn.attachments && turn.attachments.length > 0 ? (
                <div className="chat-photos">
                  {groupBySource(turn.attachments).map(([source, photos]) => (
                    <div key={source}>
                      <p className="chat-photo-source text-sm">{source}</p>
                      <div className="chat-photo-grid">
                        {photos.map((photo) => (
                          // Abre em aba nova em vez de lightbox: a URL presignada já
                          // é a imagem em tamanho cheio, e um <a> preserva o clique
                          // do meio e o "salvar imagem como".
                          <a
                            key={photo.url}
                            className="chat-photo"
                            href={photo.url}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {/* <img> e não next/image: a URL é presignada e o host
                                varia (MinIO em dev, R2/S3 em produção); o
                                otimizador exigiria declarar cada domínio. */}
                            <img src={photo.url} alt={photo.caption ?? source} loading="lazy" />
                            {photo.caption ? (
                              <span className="chat-photo-caption">{photo.caption}</span>
                            ) : null}
                          </a>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        ))}

        {pending ? (
          <div className="chat-turn chat-turn-assistant">
            <div className="chat-bubble chat-thinking">
              <span className="pulse-dot">
                <span />
                <span />
              </span>
              consultando o cadastro…
            </div>
          </div>
        ) : null}

        {error ? <p className="chat-error text-sm">{error}</p> : null}

        <div ref={endRef} />
      </div>

      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
      >
        <input
          className="input"
          placeholder="Ex.: tem apartamento de 2 quartos até R$ 3.000 no Centro?"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={pending}
        />
        <button type="submit" className="btn btn-primary" disabled={pending || !input.trim()}>
          <Icon name="arrowRight" size={16} />
          Perguntar
        </button>
      </form>
    </div>
  );
}
