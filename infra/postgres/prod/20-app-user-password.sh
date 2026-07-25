#!/bin/sh
# Roda logo depois do init.sql, na PRIMEIRA criação do volume (o entrypoint do
# Postgres executa /docker-entrypoint-initdb.d em ordem alfabética).
#
# Por que existe: o init.sql cria `app_user` com a senha 'app_user' — valor
# versionado neste repositório, ótimo para dev e inaceitável numa máquina
# pública. Aqui ela vira a senha real, a mesma que o DATABASE_URL do backend usa.
#
# Não mexa no init.sql para isso: ele é o mesmo arquivo do ambiente de
# desenvolvimento, e um `psql -v` ali quebraria o `npm run infra:up`.
set -e

if [ -z "$APP_DB_PASSWORD" ]; then
  echo "APP_DB_PASSWORD não definida — abortando o init do banco." >&2
  exit 1
fi

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	ALTER ROLE app_user WITH PASSWORD '$APP_DB_PASSWORD';
EOSQL

echo "senha de app_user definida a partir de APP_DB_PASSWORD"
