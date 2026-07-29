"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Icon } from "../../../components/Icon";

/**
 * Popup do Contrato de Administração: pede o nome das duas testemunhas antes de
 * abrir o PDF.
 *
 * As testemunhas não vêm de cadastro — são quem está na sala no dia da
 * assinatura —, por isso são digitadas aqui e viajam na URL do documento.
 *
 * Abre POR CIMA do formulário de imóvel (zIndex acima do modal do form, como a
 * vistoria e o seletor de proprietários). O "Gerar contrato" é um `<a>`, e não
 * um `window.open`: o resultado é um arquivo, e assim o PDF abre no visualizador
 * nativo sem esbarrar no bloqueador de pop-up.
 */
export default function AdministrationContractModal({
  propertyId,
  onClose,
}: {
  propertyId: string;
  onClose: () => void;
}) {
  const [first, setFirst] = useState("");
  const [second, setSecond] = useState("");

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // O backend exige 3 caracteres em cada nome — o link só fica ativo quando os
  // dois passam, para o usuário não cair numa aba com mensagem de erro.
  const ready = first.trim().length >= 3 && second.trim().length >= 3;
  const href =
    `/imoveis/${propertyId}/contrato-administracao?` +
    new URLSearchParams({ testemunha1: first.trim(), testemunha2: second.trim() });

  const modal = (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,.45)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        padding: "12vh 16px",
        overflowY: "auto",
        zIndex: 2500,
      }}
    >
      <div
        className="card card-pad stack modal-sheet"
        onClick={(e) => e.stopPropagation()}
        style={{ gap: 14, width: 520, maxWidth: "96vw", boxShadow: "0 20px 60px rgba(0,0,0,.30)" }}
      >
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="insp-title">
            <span className="insp-title-chip">
              <Icon name="contract" size={16} />
            </span>
            <span className="insp-title-text">Contrato de Administração</span>
          </span>
          <button className="icon-btn" type="button" aria-label="Fechar" onClick={onClose}>
            <Icon name="close" size={15} />
          </button>
        </div>

        <div className="stack" style={{ gap: 12 }}>
          <div className="field">
            <label>1ª testemunha</label>
            <input
              className="input"
              autoFocus
              value={first}
              onChange={(e) => setFirst(e.target.value)}
              maxLength={120}
            />
          </div>
          <div className="field">
            <label>2ª testemunha</label>
            <input
              className="input"
              value={second}
              onChange={(e) => setSecond(e.target.value)}
              maxLength={120}
            />
          </div>
        </div>

        <div
          className="row"
          style={{
            justifyContent: "flex-end",
            gap: 8,
            borderTop: "1px solid var(--border)",
            paddingTop: 12,
          }}
        >
          <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>
            Cancelar
          </button>
          {ready ? (
            <a
              className="btn btn-primary btn-sm"
              href={href}
              target="_blank"
              rel="noopener"
              onClick={onClose}
            >
              <Icon name="printer" size={14} /> Gerar contrato
            </a>
          ) : (
            // Sem os dois nomes vira um botão desabilitado de verdade: um `<a>`
            // "desabilitado" ainda navegaria ao ser clicado.
            <button className="btn btn-primary btn-sm" type="button" disabled>
              <Icon name="printer" size={14} /> Gerar contrato
            </button>
          )}
        </div>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
}
