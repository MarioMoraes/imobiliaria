import { PageHeader, Section } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { fetchPaymentSettings, fetchSignatureSettings } from "../../../lib/api";
import { SignatureSettingsCard } from "./SignatureSettingsCard";
import { PaymentSettingsCard } from "./PaymentSettingsCard";

const integrations = [
  { name: "Stripe", desc: "Cartão internacional / backup", icon: "receipt", on: false },
  { name: "Clerk", desc: "Autenticação e identidade", icon: "shield", on: true },
  { name: "WhatsApp Business", desc: "Canal principal dos agentes", icon: "messageCircle", on: true },
  { name: "Resend", desc: "E-mails transacionais", icon: "mail", on: true },
  { name: "Cloudflare", desc: "DNS e domínio do tenant", icon: "globe", on: true },
];

export default async function ConfiguracoesPage() {
  const [signature, payment] = await Promise.all([
    fetchSignatureSettings(),
    fetchPaymentSettings(),
  ]);

  return (
    <>
      <PageHeader title="Configurações" />

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Section title="Dados da imobiliária" pad>
          <div className="stack" style={{ gap: 14 }}>
            <div className="field"><label>Nome fantasia</label><input className="input" defaultValue="Imobiliária Demo" /></div>
            <div className="field"><label>CNPJ</label><input className="input" defaultValue="00.000.000/0001-00" /></div>
            <div className="field"><label>CRECI da imobiliária</label><input className="input" defaultValue="J-12345" /></div>
            <div className="field"><label>Subdomínio</label><input className="input" defaultValue="demo.moveai.com.br" readOnly /></div>
            <button className="btn btn-primary btn-sm" style={{ alignSelf: "flex-start" }}>Salvar Alterações</button>
          </div>
        </Section>

        <Section title="Assinatura Digital (ZapSign)" pad>
          <SignatureSettingsCard settings={signature} />
        </Section>

        <Section title="Cobrança (Asaas)" pad>
          <PaymentSettingsCard settings={payment} />
        </Section>

        <Section title="Integrações">
          <div className="card-pad stack" style={{ gap: 10 }}>
            {integrations.map((it) => (
              <div key={it.name} className="card card-pad row-between" style={{ padding: 14 }}>
                <div className="row gap-8">
                  <span className="stat-icon" style={{ width: 34, height: 34, marginBottom: 0 }}><Icon name={it.icon} size={16} /></span>
                  <span>
                    <span className="strong text-sm" style={{ display: "block" }}>{it.name}</span>
                    <span className="text-xs subtle">{it.desc}</span>
                  </span>
                </div>
                {it.on
                  ? <span className="badge badge-green"><span className="dot" /> Conectado</span>
                  : <button className="btn btn-outline btn-sm">Conectar</button>}
              </div>
            ))}
          </div>
        </Section>
      </div>
    </>
  );
}
