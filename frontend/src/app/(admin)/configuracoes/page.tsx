import Link from "next/link";
import { PageHeader, Section } from "../../../components/ui";
import { Icon } from "../../../components/Icon";
import { fetchCurrentTenant, fetchPaymentSettings, fetchSignatureSettings } from "../../../lib/api";
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

  return (
    <>
      <PageHeader title="Configurações" />

      {/* Card de navegação: a trilha é uma tela própria (lista longa, filtros),
          não cabe como bloco no meio das configurações. */}
      <div className="grid grid-3 mb-4">
        <Link href="/configuracoes/auditoria" className="lookup-card reveal">
          <span className="stat-icon accent">
            <Icon name="shield" />
          </span>
          <div className="stack" style={{ gap: 4 }}>
            <span className="lookup-card-title">Trilha de auditoria</span>
            <span className="subtle text-sm">
              Quem fez o quê no sistema, com autor, IP e horário. Registro imutável.
            </span>
          </div>
          <div className="lookup-card-foot">
            <span className="badge badge-slate">Somente administradores</span>
            <span className="row gap-8 text-sm strong">
              Abrir <Icon name="arrowRight" size={15} />
            </span>
          </div>
        </Link>
      </div>

      <div className="grid" style={{ gridTemplateColumns: "1fr 1fr" }}>
        <Section title="Dados da imobiliária" pad>
          <TenantProfileCard tenant={tenant} />
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
