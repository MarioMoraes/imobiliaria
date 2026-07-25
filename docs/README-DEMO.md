# Offices AI Imobiliária — demonstração local

Este pacote roda o sistema completo na sua máquina, dentro do Docker Desktop.
Nada é instalado fora do Docker e nada sai do seu computador.

**Você vai precisar de:** Docker Desktop instalado e aberto, e cerca de 4 GB de
espaço livre.

---

## 1. Carregar as imagens

Abra o terminal na pasta deste arquivo e rode:

```bash
docker load -i imagens.tar.gz
```

Leva alguns minutos. É normal não aparecer nada na tela durante o processo.

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
docker compose -f docker-compose.demo.yml exec postgres /demo/ativar-dados-demo.sh
```

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
| Erro de porta em uso | Algo já usa a 3000 ou a 3001 na sua máquina. Acrescente `FRONTEND_PORT=3100` e `BACKEND_PORT=3101` ao arquivo `.env` desta pasta e suba de novo — o endereço passa a ser http://localhost:3100. |
| A tela abre mas não carrega dados | `curl http://localhost:3001/health` deve responder `{"status":"ok"}`. |
| O login não conclui | A demonstração precisa de internet para autenticar. |

## Limites desta demonstração

- É uma instalação local para avaliação: os dados ficam só na sua máquina e
  somem se você rodar `down -v`.
- O envio de fotos de imóveis depende de um serviço de armazenamento externo e
  pode estar desativado neste pacote.
- Emissão de boletos e assinatura eletrônica exigem credenciais dos provedores
  (Asaas, ZapSign) e endereço público — fora do escopo de uma demonstração local.
