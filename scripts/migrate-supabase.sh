#!/usr/bin/env bash
# Apply all SQL files in supabase/migrations/ to a Supabase Postgres database.
#
# Usage:
#   npm run db:migrate
#
# Provide a database connection via one of:
#   DATABASE_URL=...   (preferred — copy Session mode URI from Supabase dashboard)
#   SUPABASE_DB_PASSWORD=...  (direct host; may fail if IPv6/network restrictions block port 5432)
#
# Requires either the Supabase CLI (recommended) or psql on your PATH.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS_DIR="$ROOT/supabase/migrations"
DRY_RUN=false

usage() {
  cat <<'EOF'
Apply Supabase migrations (supabase/migrations/*.sql).

Environment:
  DATABASE_URL              Full Postgres URI (preferred; use Session mode from Supabase)
  SUPABASE_DB_PASSWORD      Database password; builds a direct db.*.supabase.co:5432 URL
  NEXT_PUBLIC_SUPABASE_URL  Supabase project URL (read from .env.local when unset)

Options:
  --dry-run                 List migration files without applying them
  -h, --help                Show this help

Examples:
  DATABASE_URL='postgresql://postgres.PROJECT_REF:secret@aws-0-....pooler.supabase.com:6543/postgres' npm run db:migrate
  SUPABASE_DB_PASSWORD='secret' npm run db:migrate
EOF
}

log() {
  printf '==> %s\n' "$*"
}

die() {
  printf 'Error: %s\n' "$*" >&2
  exit 1
}

load_dotenv_var() {
  local file="$1"
  local key="$2"
  local line value

  [[ -f "$file" ]] || return 1
  line="$(grep -E "^[[:space:]]*${key}=" "$file" | tail -n 1 || true)"
  [[ -n "$line" ]] || return 1
  value="${line#*=}"
  value="${value%$'\r'}"
  value="${value#\"}"
  value="${value%\"}"
  value="${value#\'}"
  value="${value%\'}"
  printf '%s' "$value"
}

load_env_local() {
  local env_file="$ROOT/.env.local"

  if [[ -z "${NEXT_PUBLIC_SUPABASE_URL:-}" ]]; then
    NEXT_PUBLIC_SUPABASE_URL="$(load_dotenv_var "$env_file" NEXT_PUBLIC_SUPABASE_URL || true)"
    if [[ -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ]]; then
      export NEXT_PUBLIC_SUPABASE_URL
    fi
  fi

  if [[ -z "${SUPABASE_DB_PASSWORD:-}" ]]; then
    SUPABASE_DB_PASSWORD="$(load_dotenv_var "$env_file" SUPABASE_DB_PASSWORD || true)"
    if [[ -n "${SUPABASE_DB_PASSWORD:-}" ]]; then
      export SUPABASE_DB_PASSWORD
    fi
  fi

  if [[ -z "${DATABASE_URL:-}" ]]; then
    DATABASE_URL="$(load_dotenv_var "$env_file" DATABASE_URL || true)"
    if [[ -n "${DATABASE_URL:-}" ]]; then
      export DATABASE_URL
    fi
  fi
}

project_ref_from_supabase_url() {
  local url="$1"
  if [[ "$url" =~ https?://([a-zA-Z0-9-]+)\.supabase\.co ]]; then
    printf '%s' "${BASH_REMATCH[1]}"
    return 0
  fi
  return 1
}

resolve_database_url() {
  if [[ -n "${DATABASE_URL:-}" ]]; then
    if printf '%s' "$DATABASE_URL" | grep -qE '\.\.\.|YOUR[-_]|PROJECT_REF|example\.com'; then
      die "DATABASE_URL still contains placeholder text (e.g. .... or YOUR_PASSWORD).

Copy the exact URI from Supabase:
  Project Settings -> Database -> Connection string -> URI -> Session mode

Do not edit the hostname — it looks like aws-0-ap-south-1.pooler.supabase.com (your region differs)."
    fi
    printf '%s' "$DATABASE_URL"
    return 0
  fi

  if [[ -n "${SUPABASE_DB_PASSWORD:-}" && -n "${NEXT_PUBLIC_SUPABASE_URL:-}" ]]; then
    local ref
    ref="$(project_ref_from_supabase_url "$NEXT_PUBLIC_SUPABASE_URL")" \
      || die "Could not parse project ref from NEXT_PUBLIC_SUPABASE_URL: $NEXT_PUBLIC_SUPABASE_URL"
    printf 'postgresql://postgres:%s@db.%s.supabase.co:5432/postgres' \
      "$SUPABASE_DB_PASSWORD" "$ref"
    return 0
  fi

  return 1
}

list_migrations() {
  find "$MIGRATIONS_DIR" -maxdepth 1 -name '*.sql' -print \
    | sort
}

migrate_with_supabase_cli() {
  local db_url="$1"
  local supabase_cmd=()
  local output
  local status

  if command -v supabase >/dev/null 2>&1; then
    supabase_cmd=(supabase)
  elif command -v npx >/dev/null 2>&1; then
    supabase_cmd=(npx --yes supabase)
  else
    return 1
  fi

  log "Applying migrations with Supabase CLI"
  set +e
  output="$("${supabase_cmd[@]}" db push --db-url "$db_url" --yes 2>&1)"
  status=$?
  set -e
  printf '%s\n' "$output"

  if [[ "$status" -eq 0 ]]; then
    return 0
  fi

  if printf '%s' "$output" | grep -q 'password authentication failed'; then
    die "Database password rejected by Supabase.

SUPABASE_DB_PASSWORD must be your Postgres database password, not the anon key
or service_role key from Project Settings -> API.

In Supabase: Project Settings -> Database -> Database password -> Reset, then
update SUPABASE_DB_PASSWORD in .env.local (or paste the full URI as DATABASE_URL)."
  fi

  if printf '%s' "$output" | grep -Eq 'connection refused|Network Restrictions|Network Bans|dial tcp|no such host|hostname resolving'; then
    die "Could not reach the Supabase database.

Try this:
  1. Supabase -> Project Settings -> Database -> Connection string
  2. Set Type to URI, Method to Session mode (or Direct connection)
  3. Copy the full string into .env.local as DATABASE_URL=... (do not use placeholder hostnames)
  4. Supabase -> Database -> Settings -> Network Restrictions: allow your IP
     (or temporarily allow all addresses), and check Network Bans

The auto-built db.PROJECT_REF.supabase.co:5432 URL often fails on IPv6 or when
direct connections are restricted. The Session pooler URI from the dashboard is
more reliable."
  fi

  return 1
}

migrate_with_psql() {
  local db_url="$1"
  local file

  command -v psql >/dev/null 2>&1 || return 1

  log "Applying migrations with psql"
  while IFS= read -r file; do
    log "$(basename "$file")"
    psql "$db_url" -v ON_ERROR_STOP=1 -f "$file"
  done < <(list_migrations)
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "Unknown option: $1 (try --help)"
      ;;
  esac
done

[[ -d "$MIGRATIONS_DIR" ]] || die "Migrations directory not found: $MIGRATIONS_DIR"

migration_count="$(list_migrations | wc -l | tr -d ' ')"
[[ "$migration_count" -gt 0 ]] || die "No .sql files found in $MIGRATIONS_DIR"

if [[ "$DRY_RUN" == true ]]; then
  log "Dry run — would apply $migration_count migration(s):"
  list_migrations | while IFS= read -r file; do
    printf '  %s\n' "$(basename "$file")"
  done
  exit 0
fi

load_env_local

db_url="$(resolve_database_url || true)"
if [[ -z "$db_url" ]]; then
  die "No database connection found.

Set DATABASE_URL in .env.local (recommended). In Supabase:
  Project Settings -> Database -> Connection string -> URI -> Session mode

Or set SUPABASE_DB_PASSWORD (builds a direct :5432 URL; may be blocked on some networks)."
fi

log "Found $migration_count migration(s) in supabase/migrations/"

if migrate_with_supabase_cli "$db_url"; then
  log "Done."
  exit 0
fi

if migrate_with_psql "$db_url"; then
  log "Done."
  exit 0
fi

die "Could not run migrations.

Install the Supabase CLI:
  npm install --global supabase

Or install PostgreSQL client tools (psql), then re-run with DATABASE_URL set."
