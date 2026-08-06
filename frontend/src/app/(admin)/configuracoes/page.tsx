import { PageHeader, Section } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import {
  backendNotice,
  fetchCurrentTenant,
  fetchPaymentSettings,
  fetchSignatureSettings,
} from "../../../lib/api";
import { SignatureSettingsCard } from "./SignatureSettingsCard";
import { PaymentSettingsCard } from "./PaymentSettingsCard";
import { TenantProfileCard } from "./TenantProfileCard";

const integrations = [
  { name: "Stripe", desc: "Cartão internacional / backup", icon: "receipt", on: false },
  { name: "Clerk", desc: "Autenticação e identidade", icon: "shield", on: true },
  { name: "WhatsApp Business", desc: "Canal principal dos agentes", icon: "messageCircle", on: true },
  { name: "Resend", desc: "E-mails transacionais", icon: "mail", on: true },
  { name: "Cloudflare", desc: "DNS e domínio do tenant", icon: "globe", on: true },
];

export default async function ConfiguracoesPage() {
  const [signature, payment, tenant] = await Promise.all([
    fetchSignatureSettings(),
    fetchPaymentSettings(),
    fetchCurrentTenant(),
  ]);
  // Depois das leituras: é delas que sai o diagnóstico exibido nos cartões.
  const notice = backendNotice();

  return (
    <>
      <PageHeader title="Configurações" />

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Section title="Dados da Imobiliária" pad>
          <TenantProfileCard tenant={tenant} notice={notice} />
        </Section>

        <Section title="Assinatura Digital (ZapSign)" pad>
          <SignatureSettingsCard settings={signature} notice={notice} />
        </Section>

        <Section title="Cobrança (Asaas)" pad>
          <PaymentSettingsCard settings={payment} notice={notice} />
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
