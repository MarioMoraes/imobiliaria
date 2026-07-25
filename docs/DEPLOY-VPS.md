# Deploy em VPS (demonstração)

Stack completa em uma máquina só: aplicação + banco + fila + cache + PDF, atrás
de um proxy reverso com HTTPS automático. É o formato de demonstração — para
produção com carga real, veja "Limites deste formato" no fim.

```
                  Internet
                     │  80/443
              ┌──────▼──────┐
              │    Caddy    │  TLS automático (Let's Encrypt)
              └──┬───────┬──┘
      /webhooks/*│       │ todo o resto
           ┌─────▼──┐ ┌──▼────────┐
           │backend │◄┤ frontend  │  (Server Components chamam o backend
           │  3001  │ │   3000    │   pela rede interna: /v1 não é público)
           └───┬────┘ └───────────┘
   postgres · redis · rabbitmq · gotenberg   (sem porta publicada)
```

## 1. Pré-requisitos

- VPS com Docker Engine + plugin Compose (`docker compose version`).
- Portas **80 e 443** abertas no firewall. A 80 não é só redirect: é por onde
  passa o desafio ACME que emite o certificado.
- Um domínio (ex.: `demo.suaimobiliaria.com.br`) com registro **A** apontando
  para o IP da VPS — configure isso **antes** de subir, senão o Caddy tenta
  emitir o certificado e falha.
- Chaves do **Clerk**. Para um domínio próprio use uma instância de *produção*
  (`pk_live_`/`sk_live_`) com o domínio cadastrado lá.

## 2. Construir as imagens

Na sua máquina, a partir da **raiz do repositório** (o contexto de build é a
raiz — os Dockerfiles usam o `package-lock.json` do monorepo para instalar
exatamente as versões testadas):

```bash
docker build -f backend/Dockerfile  -t SEU_USUARIO/offices-backend:0.1.0 .
docker build -f frontend/Dockerfile \
  --build-arg NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_live_xxx \
  -t SEU_USUARIO/offices-frontend:0.1.0 .
```

> A chave publicável do Clerk é **assada no bundle do navegador** durante o
> build. Trocar de instância do Clerk (teste ↔ produção) exige **reconstruir** a
> imagem do frontend — mudar a variável no `docker run` não tem efeito.

Se a VPS não for `x86_64` como a sua máquina, construa para a arquitetura dela:

```bash
docker buildx build --platform linux/amd64 -f backend/Dockerfile -t ... . --push
```

Publicar no Docker Hub:

```bash
docker login
docker push SEU_USUARIO/offices-backend:0.1.0
docker push SEU_USUARIO/offices-frontend:0.1.0
```

Alternativa sem registro: construir **na própria VPS** com
`docker compose -f docker-compose.prod.yml --env-file .env.production build`
(o compose já traz as seções `build`).

## 3. Configurar a VPS

A VPS **não precisa do repositório**: com as imagens no registro, bastam quatro
arquivos. Da sua máquina:

```bash
ssh root@IP_DA_VPS 'mkdir -p /opt/offices/infra/caddy /opt/offices/infra/postgres/prod'
scp docker-compose.prod.yml                      root@IP_DA_VPS:/opt/offices/
scp infra/caddy/Caddyfile                        root@IP_DA_VPS:/opt/offices/infra/caddy/
scp infra/postgres/init.sql                      root@IP_DA_VPS:/opt/offices/infra/postgres/
scp infra/postgres/prod/20-app-user-password.sh  root@IP_DA_VPS:/opt/offices/infra/postgres/prod/
scp .env.production                              root@IP_DA_VPS:/opt/offices/
```

O `.env.production` sai do exemplo — preencha domínio, senhas
(`openssl rand -base64 24`), `APP_ENCRYPTION_KEY` (`openssl rand -base64 32`),
chaves do Clerk e `BACKEND_IMAGE`/`FRONTEND_IMAGE` com o nome exato que você
publicou:

```bash
cp .env.production.example .env.production
chmod 600 .env.production   # o arquivo tem todos os segredos da instalação
```

## 4. Subir

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d
docker compose -f docker-compose.prod.yml --env-file .env.production ps
curl https://demo.suaimobiliaria.com.br/health   # {"status":"ok",...}
```

O schema do banco (`init.sql`) roda sozinho na primeira criação do volume, com o
tenant de demonstração e alguns imóveis de exemplo já dentro.

## 5. Primeiro acesso

1. Acesse o domínio, clique em **Criar conta** e cadastre-se pelo Clerk.
2. O fluxo de onboarding cria a imobiliária (tenant) e vincula seu usuário.
3. Para a área de plataforma (`/superadmin`), coloque o seu id do Clerk
   (`user_...`, no painel do Clerk em *Users*) em `PLATFORM_ADMIN_CLERK_IDS` e
   reinicie: `docker compose ... up -d backend frontend`. Sem isso, `/superadmin`
   responde 404 para todo mundo — inclusive para você.

## Operação

```bash
# logs
docker compose -f docker-compose.prod.yml --env-file .env.production logs -f backend

# atualizar para uma versão nova das imagens
# (edite BACKEND_IMAGE/FRONTEND_IMAGE no .env.production com a tag nova)
docker compose -f docker-compose.prod.yml --env-file .env.production pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d

# backup do banco
docker compose -f docker-compose.prod.yml --env-file .env.production \
  exec -T postgres pg_dump -U imobiliaria imobiliaria | gzip > backup-$(date +%F).sql.gz
```

**Nunca** rode `down -v` na VPS: o `-v` apaga os volumes — banco e certificados
juntos.

## Limites deste formato

Consciente e adequado a demonstrações; vale saber antes de virar produção:

- **Tudo numa máquina.** Sem réplica e sem failover; a VPS é ponto único de
  falha. Banco gerenciado + backup automático é o próximo passo.
- **Backup é manual.** O comando acima não roda sozinho — agende um cron.
- **`init.sql` só roda uma vez**, na criação do volume. Mudanças de schema depois
  disso exigem aplicar o SQL à mão (o projeto ainda não tem ferramenta de
  migração — é um TODO de Fundação no SPEC seção 17).
- **RabbitMQ sem reconexão automática.** O backend conecta uma vez no boot
  (`shared/events.ts`); se o broker reiniciar sozinho, os eventos ficam
  desligados até o backend ser reiniciado. O `depends_on` com
  `check_port_connectivity` cobre o boot da stack, não uma queda posterior.
- **Mídia depende de S3/R2.** Sem as variáveis `S3_*` preenchidas, o upload de
  fotos falha (o resto funciona).
