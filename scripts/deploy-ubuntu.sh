#!/usr/bin/env bash
# Deploy wacrm on Ubuntu 22.04 / 24.04 (Node 20 + PM2 + Nginx).
#
# First-time server setup (run as root or with sudo):
#   sudo DOMAIN=crm.example.com APP_DIR=/opt/wacrm bash scripts/deploy-ubuntu.sh --install
#
# Re-deploy after copying new code:
#   sudo APP_DIR=/opt/wacrm bash scripts/deploy-ubuntu.sh --deploy
#
# Prerequisites before --install:
#   1. Copy this project to APP_DIR (rsync/scp/tar — no git required).
#   2. Create APP_DIR/.env.local from .env.local.example (Supabase keys, ENCRYPTION_KEY, etc.).
#   3. Set NEXT_PUBLIC_SITE_URL=https://your-domain in .env.local
#   4. Point DNS A record for DOMAIN to this server.
#
# Optional env vars:
#   DOMAIN          Public hostname (required for --install nginx + SSL)
#   APP_DIR         Install path (default: /opt/wacrm)
#   APP_USER        Linux user that runs the app (default: wacrm)
#   APP_PORT        Next.js port behind nginx (default: 3023)
#   NODE_MAJOR      Node.js major version (default: 20)
#   RUN_MIGRATE     If "true", runs npm run db:migrate when DATABASE_URL is set
#   ENABLE_SSL      If "true", runs certbot after nginx (needs DOMAIN + email)
#   CERTBOT_EMAIL   Email for Let's Encrypt (required when ENABLE_SSL=true)

set -euo pipefail

APP_DIR="${APP_DIR:-/opt/wacrm}"
APP_USER="${APP_USER:-wacrm}"
APP_PORT="${APP_PORT:-3023}"
NODE_MAJOR="${NODE_MAJOR:-20}"
RUN_MIGRATE="${RUN_MIGRATE:-false}"
ENABLE_SSL="${ENABLE_SSL:-false}"
CERTBOT_EMAIL="${CERTBOT_EMAIL:-}"

MODE="${1:---deploy}"

log() { printf '==> %s\n' "$*"; }
die() { printf 'Error: %s\n' "$*" >&2; exit 1; }

require_root() {
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    die "Run with sudo: sudo bash scripts/deploy-ubuntu.sh $MODE"
  fi
}

apt_update() {
  # Handles stale PPAs (e.g. ondrej/php label change on Jammy).
  apt-get update -qq --allow-releaseinfo-change 2>/dev/null \
    || apt-get update -qq
}

install_system_deps() {
  log "Updating apt and installing base packages…"
  apt_update
  apt-get install -y curl ca-certificates gnupg nginx rsync

  if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q "v${NODE_MAJOR}"; then
    log "Installing Node.js ${NODE_MAJOR}.x…"
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  fi

  if ! command -v pm2 >/dev/null 2>&1; then
    log "Installing PM2…"
    npm install -g pm2
  fi

  if [[ "$ENABLE_SSL" == "true" ]] && ! command -v certbot >/dev/null 2>&1; then
    apt-get install -y certbot python3-certbot-nginx
  fi

  node -v
  npm -v
}

ensure_app_user() {
  if ! id "$APP_USER" &>/dev/null; then
    log "Creating system user: $APP_USER"
    useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
  fi
}

ensure_app_dir() {
  if [[ ! -d "$APP_DIR" ]]; then
    die "APP_DIR $APP_DIR does not exist. Copy the project there first."
  fi
  if [[ ! -f "$APP_DIR/package.json" ]]; then
    die "$APP_DIR does not look like the wacrm project (missing package.json)."
  fi
  if [[ ! -f "$APP_DIR/.env.local" ]]; then
    die "Create $APP_DIR/.env.local before deploying (copy from .env.local.example)."
  fi
  chown -R "$APP_USER:$APP_USER" "$APP_DIR"
}

build_app() {
  log "Installing dependencies and building…"
  sudo -u "$APP_USER" bash -lc "
    set -euo pipefail
    cd '$APP_DIR'
    # Do not set NODE_ENV=production here — npm would skip devDependencies
    # (@tailwindcss/postcss, tailwindcss) that Next.js needs to compile CSS.
    rm -rf .next
    npm ci
    npm run build
    test -f .next/BUILD_ID || { echo 'Build finished but .next/BUILD_ID is missing'; exit 1; }
    npm prune --omit=dev
  "

  if [[ "$RUN_MIGRATE" == "true" ]]; then
    log "Running database migrations…"
    sudo -u "$APP_USER" bash -lc "
      set -euo pipefail
      cd '$APP_DIR'
      npm run db:migrate
    " || die "db:migrate failed — check DATABASE_URL in .env.local"
  fi
}

start_pm2() {
  [[ -f "$APP_DIR/.next/BUILD_ID" ]] || die "No production build at $APP_DIR/.next — run build first"

  log "Starting app with PM2 on port $APP_PORT…"
  sudo -u "$APP_USER" bash -lc "
    set -euo pipefail
    cd '$APP_DIR'
    export PORT='$APP_PORT'
    export NODE_ENV=production
    pm2 delete wacrm 2>/dev/null || true
    pm2 start npm --name wacrm -- start
    pm2 save
  "

  # PM2 startup for reboot persistence (run once per server)
  env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$APP_USER" --hp "$APP_DIR" || true
}

write_nginx_site() {
  [[ -n "${DOMAIN:-}" ]] || die "Set DOMAIN=your.domain.com for nginx configuration"

  local conf="/etc/nginx/sites-available/wacrm"
  log "Writing nginx config for $DOMAIN → 127.0.0.1:$APP_PORT"

  cat >"$conf" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${DOMAIN};

    client_max_body_size 25m;

    location / {
        proxy_pass http://127.0.0.1:${APP_PORT};
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
    }
}
EOF

  ln -sf "$conf" /etc/nginx/sites-enabled/wacrm
  rm -f /etc/nginx/sites-enabled/default
  nginx -t
  systemctl enable nginx
  systemctl reload nginx
}

enable_ssl() {
  [[ "$ENABLE_SSL" == "true" ]] || return 0
  [[ -n "${DOMAIN:-}" ]] || die "DOMAIN is required for SSL"
  [[ -n "$CERTBOT_EMAIL" ]] || die "Set CERTBOT_EMAIL for Let's Encrypt"

  log "Requesting TLS certificate for $DOMAIN…"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m "$CERTBOT_EMAIL" --redirect
}

cmd_install() {
  require_root
  install_system_deps
  ensure_app_user
  ensure_app_dir
  build_app
  start_pm2
  write_nginx_site
  enable_ssl
  log "Install complete."
  log "App:  http://127.0.0.1:$APP_PORT (PM2 process: wacrm)"
  log "Site: http://${DOMAIN:-your-domain} (configure DOMAIN for public URL)"
  log "WhatsApp / Gupshup webhook: https://${DOMAIN:-your-domain}/api/whatsapp/webhook"
}

cmd_deploy() {
  require_root
  ensure_app_user
  ensure_app_dir
  build_app
  start_pm2
  if [[ -f /etc/nginx/sites-available/wacrm ]]; then
    nginx -t && systemctl reload nginx
  fi
  log "Deploy complete. PM2 status:"
  sudo -u "$APP_USER" pm2 status wacrm || true
}

cmd_nginx() {
  require_root
  write_nginx_site
  enable_ssl
  systemctl reload nginx
  log "Nginx reloaded."
}

case "$MODE" in
  --install) cmd_install ;;
  --deploy)  cmd_deploy ;;
  --nginx)   cmd_nginx ;;
  -h|--help)
    sed -n '2,20p' "$0"
    ;;
  *)
    die "Unknown mode: $MODE (use --install, --deploy, or --nginx)"
    ;;
esac
