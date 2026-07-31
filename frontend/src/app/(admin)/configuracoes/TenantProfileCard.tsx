"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BackendNotice, GENERIC_BACKEND_NOTICE } from "../../../components/BackendNotice";
import { Icon } from "../../../components/Icon";
import type { Tenant } from "../../../lib/api";
import { TENANT_DOMAIN } from "../../../lib/format";
import { saveTenantProfileAction } from "./actions";

/**
 * O usuário só escolhe o slug — o domínio é fixo. Normaliza enquanto digita
 * para o mesmo alfabeto que o backend aceita (minúsculas, números e hífen),
 * assim ele não descobre o formato só no erro do salvamento.
 */
function normalizeSlug(v: string): string {
  return v
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // acentos: "imóvel" → "imovel", não "im-vel"
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, 60);
}

/** "12345678000199" → "12.345.678/0001-99" (parcial enquanto digita). */
function maskCnpj(v: string): string {
  const d = v.replace(/\D/g, "").slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d)/, "$1-$2");
}

/**
 * Reduz o logo no cliente antes de enviar. **PNG**, não JPEG: logo costuma ter
 * fundo transparente, e o JPEG o transformaria num retângulo branco/preto.
 * 320px de lado basta para a sidebar (34px) e o topbar em telas retina.
 */
async function logoToDataUrl(file: File, maxDim = 320): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas indisponível");
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  return canvas.toDataURL("image/png");
}

/**
 * Cadastro da imobiliária. O logo aparece na sidebar e no topbar assim que é
 * salvo — é o que personaliza o sistema para o cliente.
 */
export function TenantProfileCard({
  tenant,
  notice,
}: {
  tenant: Tenant | null;
  /** Por que não está disponível — vem do `backendNotice()` de quem renderiza. */
  notice?: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(tenant?.name ?? "");
  const [cnpj, setCnpj] = useState(maskCnpj(tenant?.cnpj ?? ""));
  const [creci, setCreci] = useState(tenant?.creci ?? "");
  const [slug, setSlug] = useState(tenant?.slug ?? "");
  /** `undefined` = não mexeu no logo; `null` = remover; string = novo. */
  const [logo, setLogo] = useState<string | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const offline = tenant === null;
  const logoAtual = logo === undefined ? (tenant?.logoUrl ?? null) : logo;

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    setError(null);
    setSaved(false);
    try {
      setLogo(await logoToDataUrl(file));
    } catch {
      setError("Não foi possível ler a imagem. Use PNG, JPG ou WebP.");
    }
  }

  function save() {
    setError(null);
    setSaved(false);
    if (name.trim().length < 2) {
      setError("Informe o nome da imobiliária.");
      return;
    }
    const digits = cnpj.replace(/\D/g, "");
    if (digits && digits.length !== 14) {
      setError("CNPJ deve ter 14 dígitos.");
      return;
    }
    // Hífen nas pontas passa no `normalizeSlug` (é digitável no meio da palavra),
    // mas não vira subdomínio válido — barra aqui, antes de ir ao backend.
    const cleanSlug = slug.replace(/^-+|-+$/g, "");
    if (cleanSlug.length < 2) {
      setError("Informe o subdomínio (mínimo 2 caracteres).");
      return;
    }
    startTransition(async () => {
      const res = await saveTenantProfileAction({
        name,
        cnpj,
        creci,
        slug: cleanSlug,
        logoUrl: logo,
      });
      if (!res.ok) {
        setError(res.error ?? "Não foi possível salvar.");
        return;
      }
      setLogo(undefined); // passa a refletir o valor que veio do servidor
      setSlug(cleanSlug);
      setSaved(true);
      router.refresh();
    });
  }

  return (
    <div className="stack" style={{ gap: 14 }}>
      <div className="row" style={{ gap: 16, alignItems: "center" }}>
        <span className={`brand-logo-preview${logoAtual ? "" : " is-empty"}`}>
          {logoAtual ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoAtual} alt={name || "Logo"} />
          ) : (
            <Icon name="building" size={22} />
          )}
        </span>
        <div className="stack" style={{ gap: 6 }}>
          <div className="row gap-8">
            <button
              className="btn btn-outline btn-sm"
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={pending || offline}
            >
              <Icon name="upload" size={14} /> {logoAtual ? "Trocar logo" : "Enviar logo"}
            </button>
            {logoAtual && (
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => setLogo(null)}
                disabled={pending}
              >
                Remover
              </button>
            )}
          </div>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,image/svg+xml"
          hidden
          onChange={(e) => {
            void pickLogo(e.target.files?.[0]);
            e.target.value = ""; // permite reenviar o mesmo arquivo
          }}
        />
      </div>

      <div className="field">
        <label>Nome fantasia</label>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      <div className="grid grid-2" style={{ gap: 12 }}>
        <div className="field">
          <label>CNPJ</label>
          <input
            className="input"
            value={cnpj}
            onChange={(e) => setCnpj(maskCnpj(e.target.value))}
            inputMode="numeric"
            placeholder="00.000.000/0000-00"
          />
        </div>
        <div className="field">
          <label>CRECI da imobiliária</label>
          <input className="input" value={creci} onChange={(e) => setCreci(e.target.value)} />
        </div>
      </div>

      <div className="field">
        <label>Subdomínio</label>
        <div className="input-group">
          <input
            className="input"
            value={slug}
            onChange={(e) => setSlug(normalizeSlug(e.target.value))}
            placeholder="minha-imobiliaria"
            disabled={offline}
          />
          <span className="input-suffix">.{TENANT_DOMAIN}</span>
        </div>
      </div>

      {error && <span className="badge badge-red">{error}</span>}
      {saved && (
        <span className="badge badge-green">
          <Icon name="check" size={12} /> Cadastro salvo.
        </span>
      )}

      <button
        className="btn btn-primary btn-sm"
        style={{ alignSelf: "flex-start" }}
        type="button"
        onClick={save}
        disabled={pending || offline}
      >
        {pending ? <Icon name="loader" className="spin" size={14} /> : null} Salvar alterações
      </button>

      {offline && <BackendNotice message={notice ?? GENERIC_BACKEND_NOTICE} />}
    </div>
  );
}
