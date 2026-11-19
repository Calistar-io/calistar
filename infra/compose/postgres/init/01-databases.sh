#!/bin/sh
# Two databases in one cluster, each with its own role (specification: data model).
# - umami: owned and migrated by Umami. Calistar never writes to it.
# - calistar: Calistar's own tables.
set -eu

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname postgres \
  -v umami_password="$UMAMI_DB_PASSWORD" -v calistar_password="$CALISTAR_DB_PASSWORD" <<'SQL'
CREATE ROLE umami LOGIN PASSWORD :'umami_password';
CREATE ROLE calistar LOGIN PASSWORD :'calistar_password';
CREATE DATABASE umami OWNER umami;
CREATE DATABASE calistar OWNER calistar;
REVOKE CONNECT ON DATABASE umami FROM PUBLIC;
REVOKE CONNECT ON DATABASE calistar FROM PUBLIC;
SQL
