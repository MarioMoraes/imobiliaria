"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "../../../../components/Icon";
import { chatAction } from "../chat-action";

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
        setTurns((prev) => [...prev, { role: "assistant", content: result.answer }]);
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
            <div className="chat-bubble">
              {turn.content.split("\n").map((line, j) => (
                <p key={j}>{line || " "}</p>
              ))}
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
