# Atualizar a VPS

Roteiro para levar o que está no local para a VPS. Instalação do zero é outro
documento (`DEPLOY-VPS.md`); aqui é só atualização.

**Onde as coisas moram**

| | |
|---|---|
| Domínio | `imobiliaria.officestecnologia.com.br` |
| Stack na VPS | `/opt/offices` (repositório + `.env`) |
| Project name do compose | `offices-ai` — **sempre** |
| Postgres | container `offices-ai-postgres-1` |
| Imagens | `ghcr.io/mariomoraes/offices-{backend,frontend}` |

A stack **não** é gerenciada pelo EasyPanel. Não existe botão de Deploy; é tudo
por SSH. Quem termina o TLS e roteia o domínio é o Traefik do painel, que adota
os containers pelas labels.

---

## 1. No seu Mac

Commite e envie tudo. Depois:

```bash
bash scripts/publicar-imagens.sh 0.3.0
```

Troque `0.3.0` pela versão nova (só subir o número). O script:

- recusa rodar com arquivo não commitado ou commit não enviado — a VPS puxa
  compose e migrações do GitHub, não da sua máquina;
- constrói as duas imagens (o frontend leva a chave publicável do Clerk
  assada no bundle, lida do `.env.easypanel`);
- publica no ghcr.io;
- **avisa se o `init.sql` mudou sem migração correspondente** (ver seção 3);
- cria e envia a tag `v0.3.0`.

## 2. Na VPS

```bash
ssh root@IP_DA_VPS
cd /opt/offices && bash scripts/atualizar-vps.sh 0.3.0
```

O script faz, parando no primeiro erro: `git pull` → backup do banco em
`/root/backup-<data>.sql.gz` → migrações pendentes → `pull` das imagens →
`up -d` → confere o `/health`.

Pronto. Não precisa de mais nada no caminho feliz.

## 3. Quando o schema muda

`infra/postgres/init.sql` **só roda na criação do volume**. Num banco que já
existe ele é ignorado — mudança de schema tem de vir de um arquivo em
`infra/postgres/migrations/`.

Ao alterar o `init.sql`, crie também o arquivo do delta:

```
infra/postgres/migrations/AAAA-MM-DD-descricao.sql
```

Regras que fazem ele ser seguro de repetir: `CREATE TABLE IF NOT EXISTS`,
`ADD COLUMN IF NOT EXISTS`, `DROP POLICY IF EXISTS` antes de `CREATE POLICY`, e
tudo entre `BEGIN;` e `COMMIT;`. Use o arquivo de 2026-07-31 como modelo.

O `atualizar-vps.sh` aplica os pendentes sozinho e anota na tabela
`schema_migrations` — cada arquivo roda uma vez só.

> A migração de 2026-07-31 foi aplicada à mão antes desse controle existir. Na
> primeira execução do script ela será reaplicada (é idempotente, não faz nada)
> e registrada. Depois disso, some do caminho.

## 4. Se der errado

**Voltar para a versão anterior** — as migrações são só adição, então o código
antigo roda por cima do banco novo:

```bash
cd /opt/offices && bash scripts/atualizar-vps.sh 0.2.0
```

**Ver o que houve:**

```bash
docker logs --tail 50 offices-ai-backend-1
docker logs --tail 50 offices-ai-frontend-1
```

**Restaurar o banco** (último recurso, apaga o estado atual):

```bash
gunzip -c /root/backup-AAAA-MM-DD-HHMM.sql.gz \
  | docker exec -i offices-ai-postgres-1 psql -U imobiliaria -d imobiliaria
```

**Nunca** rode `docker compose down -v` na VPS: o `-v` apaga os volumes, e com
eles o banco.

## 5. Levar dados de um tenant para a VPS

Cadastros de demonstração feitos no local:

```bash
bash scripts/exportar-tenant.sh <tenant-id>
```

Gera um `.sql` com as tabelas de domínio daquele tenant e imprime as duas linhas
seguintes (validar carregando de volta no local, depois `scp` + `psql` na VPS).
Ficam de fora identidade, credenciais cifradas, trilha de auditoria e histórico
do copiloto — o cabeçalho do script lista o motivo de cada exclusão.

**Só funciona se o tenant tiver o mesmo UUID nos dois bancos.** O arquivo
preserva o `tenant_id` das linhas; num banco onde esse id não existe, os dados
entram órfãos e nenhuma tela os mostra.

## 6. Armadilhas já pagas

- **Project name.** Sem `-p offices-ai`, o compose não reconhece os containers e
  sobe uma stack paralela com banco vazio. As duas anunciam o mesmo domínio ao
  Traefik e o acesso vira sorteio entre o sistema real e um vazio.
- **`/opt/offices/.env` é a única cópia completa do ambiente.** Guarde num
  gerenciador de senhas. Se perder, `scripts/recuperar-env-easypanel.sh`
  remonta a partir dos containers em execução — mas só enquanto eles não forem
  recriados.
- **Chave publicável do Clerk.** Vai para dentro do bundle no build. Trocá-la
  no `.env` da VPS não tem efeito nenhum; exige reconstruir a imagem.
- **Uma organização do Clerk pertence a um ambiente só.** O cadastro grava o
  `tenant_id` do banco onde o formulário foi enviado. Ao criar imobiliária,
  confira a URL na barra de endereço: enviar na aba errada cria o tenant no
  ambiente errado e trava o outro com "o servidor não reconheceu esse vínculo".
