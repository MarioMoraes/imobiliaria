# Offices AI Imobiliária — demonstração local

Este pacote roda o sistema completo na sua máquina, dentro do Docker Desktop.
Nada é instalado fora do Docker e nada sai do seu computador.

**Você vai precisar de:** Docker Desktop instalado e aberto, e cerca de 4 GB de
espaço livre. Serve para Windows, macOS e Linux — no Windows, mantenha o Docker
Desktop na configuração padrão (motor **WSL 2**, containers **Linux**).

---

## 1. Extrair e carregar as imagens

**Windows:** extraia o `.tar.gz` para um caminho curto e sem acentos, como
`C:\offices-demo`. Pelo PowerShell:

```powershell
mkdir C:\offices-demo
tar -xzf offices-ai-demo-2026-07-25.tar.gz -C C:\offices-demo
cd C:\offices-demo\offices-ai-demo-2026-07-25
```

**macOS/Linux:** `tar -xzf offices-ai-demo-2026-07-25.tar.gz && cd offices-ai-demo-2026-07-25`

Depois, no terminal aberto **dentro dessa pasta**:

```bash
docker load -i imagens.tar.gz
```

Leva alguns minutos e termina imprimindo `Loaded image:` duas vezes.

## 2. Subir o sistema

```bash
docker compose -f docker-compose.demo.yml up -d
```

Na primeira vez o Docker baixa alguns componentes de apoio (banco de dados,
cache) — precisa de internet nesse momento. Acompanhe até todos ficarem prontos:

```bash
docker compose -f docker-compose.demo.yml ps
```

Quando as linhas mostrarem `healthy`, abra: **http://localhost:3000**

## 3. Criar sua conta

Clique em **Criar conta** e cadastre-se. Ao final, o sistema cria a sua
imobiliária — que começa vazia, como um cadastro novo de verdade.

## 4. Carregar os dados de exemplo

Para explorar o sistema já com imóveis, proprietários, contratos e cadastros
preenchidos, rode uma vez, **depois** de criar a conta:

```bash
docker compose -f docker-compose.demo.yml exec postgres sh /demo/ativar-dados-demo.sh
```

> O `sh` no começo é proposital: o Windows não guarda a marca de "arquivo
> executável", e sem ele o comando pode falhar com *permission denied*.

Recarregue o navegador. O acervo de exemplo agora pertence à sua imobiliária.

---

## Comandos do dia a dia

```bash
# parar (mantém tudo que você cadastrou)
docker compose -f docker-compose.demo.yml stop

# voltar a usar
docker compose -f docker-compose.demo.yml start

# ver o que está acontecendo, se algo não abrir
docker compose -f docker-compose.demo.yml logs -f backend

# remover a demonstração e TODOS os dados dela
docker compose -f docker-compose.demo.yml down -v
```

## Se algo não abrir

| Sintoma | O que verificar |
|---|---|
| `http://localhost:3000` não responde | `docker compose -f docker-compose.demo.yml ps` — algum serviço não está `healthy`? |
| Erro de porta em uso | Algo já usa a 3000 ou a 3001 na sua máquina. Acrescente `FRONTEND_PORT=3100` e `BACKEND_PORT=3101` ao arquivo `.env` desta pasta e suba de novo — o endereço passa a ser http://localhost:3100. No Windows, o `.env` fica oculto no Explorer: abra-o pelo VS Code ou pelo Bloco de Notas a partir do terminal (`notepad .env`). |
| `no matching manifest` ou o container reinicia sozinho | Docker Desktop em modo *Windows containers*. Clique com o botão direito no ícone do Docker → **Switch to Linux containers**. |
| A tela abre mas não carrega dados | `curl http://localhost:3001/health` deve responder `{"status":"ok"}`. |
| **"Entrar" / "Criar conta" não fazem nada** | O formulário de login é carregado da internet. Este computador precisa alcançar `__CLERK_HOST__`. Teste no PowerShell: `curl.exe -I https://__CLERK_HOST__/npm/@clerk/clerk-js@6/dist/clerk.browser.js` — tem de responder `HTTP/... 200`. Se falhar, libere `*.clerk.accounts.dev` e `*.clerk.com` no firewall/antivírus/proxy da rede, ou use uma conexão sem filtro. |
| O login abre mas não conclui | Mesma origem: verifique o console do navegador (F12) por erros com "clerk". |
| **O login entra mas o painel fica em branco** | **Relógio do Docker fora de hora** — a causa mais comum no Windows, depois que o computador suspende. O login é validado por um token com hora de emissão; se o relógio do container divergir do real, o servidor rejeita a sessão e o sistema fica indo e voltando entre o painel e a tela de login. Ver "Acertar o relógio" abaixo. |
| `ERR_EMPTY_RESPONSE` no navegador | A porta está publicada mas não encaminha (acontece depois de um `wsl --shutdown`). Recrie os containers: `docker compose -f docker-compose.demo.yml down` e depois `up -d`. **Sem `-v`** — com `-v` você apagaria os dados. Se precisar de uma saída imediata, `http://127.0.0.1:3000` costuma funcionar enquanto isso. |

## Acertar o relógio (Windows)

O Docker no Windows roda dentro de uma máquina virtual (WSL 2) que **perde a
hora quando o computador suspende ou hiberna**, e nem sempre a recupera sozinha
ao acordar. Como o login é validado por hora, o sistema passa a recusar a sessão
e o painel não abre.

Primeiro veja se há divergência — os dois comandos devem dar a mesma hora:

```powershell
docker compose -f docker-compose.demo.yml exec frontend date -u
[DateTime]::UtcNow.ToString("u")
```

Se estiverem diferentes, no PowerShell **como administrador**:

```powershell
wsl --shutdown
```

Depois reabra o Docker Desktop, espere ficar verde e suba de novo com
`docker compose -f docker-compose.demo.yml up -d`.

> Reiniciar só o Docker Desktop costuma **não** resolver: a máquina virtual
> continua de pé por baixo, com a hora errada. É o `wsl --shutdown` que a força
> a reler a hora do Windows.

Se o relógio do **próprio Windows** estiver errado, acerte-o antes (Configurações
→ Hora e idioma → Data e hora → Sincronizar agora) e só então rode o
`wsl --shutdown` — na ordem inversa a máquina virtual copia a hora errada de
volta.

## Limites desta demonstração

- É uma instalação local para avaliação: os dados ficam só na sua máquina e
  somem se você rodar `down -v`.
- O envio de fotos de imóveis depende de um serviço de armazenamento externo e
  pode estar desativado neste pacote.
- Emissão de boletos e assinatura eletrônica exigem credenciais dos provedores
  (Asaas, ZapSign) e endereço público — fora do escopo de uma demonstração local.
