#!/usr/bin/env bash
# Idempotent EC2 infrastructure bootstrap for PortfolioIQ.
#
# Run as root, from inside a checked-out copy of this repository on the
# target server:
#
#   git clone git@github.com:CSVaishakh/PortfolyoIQ.git /opt/portfolioiq-src
#   cd /opt/portfolioiq-src
#   sudo bash scripts/deploy/bootstrap-ec2.sh
#
# Safe to re-run: every step checks current state before changing anything.
# Re-running never rotates existing secrets, never touches the Postgres or
# Caddy data volumes, and never restarts a running application service.
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "must run as root (sudo bash scripts/deploy/bootstrap-ec2.sh)" >&2
  exit 1
fi

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_ROOT=/opt/portfolioiq
DEPLOY_USER=portfolioiq
DOMAIN=portfolyo-iq.duckdns.org

log() { echo "[bootstrap] $*"; }

# ── 1. OS packages ───────────────────────────────────────────────────────────
log "installing base packages"
apt-get update -y
apt-get install -y --no-install-recommends \
  git curl ca-certificates gnupg unzip ufw

# ── 2. Docker Engine + Compose plugin ────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  log "installing Docker Engine"
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  # shellcheck disable=SC1091
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update -y
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
  systemctl enable --now docker
else
  log "Docker already installed, skipping"
fi

# ── 3. Bun (installed system-wide, not per-user, so systemd units don't
#         depend on any particular user's $HOME) ─────────────────────────────
if [[ ! -x /usr/local/bin/bun ]]; then
  log "installing Bun to /usr/local/bin"
  curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash
else
  log "Bun already installed ($(/usr/local/bin/bun --version)), skipping"
fi

# ── 4. uv (manages the model-service's isolated Python 3.11 venv per
#         release; does not touch the system Python) ─────────────────────────
if [[ ! -x /usr/local/bin/uv ]]; then
  log "installing uv to /usr/local/bin"
  curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR=/usr/local/bin sh
else
  log "uv already installed ($(/usr/local/bin/uv --version)), skipping"
fi

# ── 5. Deployment user ───────────────────────────────────────────────────────
if ! id "$DEPLOY_USER" >/dev/null 2>&1; then
  log "creating user $DEPLOY_USER"
  useradd --system --create-home --shell /bin/bash "$DEPLOY_USER"
  usermod -aG docker "$DEPLOY_USER"
  usermod -aG systemd-journal "$DEPLOY_USER"
else
  log "user $DEPLOY_USER already exists, skipping"
  usermod -aG docker "$DEPLOY_USER" || true
  usermod -aG systemd-journal "$DEPLOY_USER" || true
fi

if [[ ! -f "/home/$DEPLOY_USER/.ssh/authorized_keys" ]]; then
  log "NOTE: /home/$DEPLOY_USER/.ssh/authorized_keys does not exist yet."
  log "      Add the public half of the GitHub Actions deploy key there before"
  log "      pointing the EC2_USERNAME secret at '$DEPLOY_USER'. See docs/DEPLOYMENT.md."
  install -d -m 700 -o "$DEPLOY_USER" -g "$DEPLOY_USER" "/home/$DEPLOY_USER/.ssh"
  install -m 600 -o "$DEPLOY_USER" -g "$DEPLOY_USER" /dev/null "/home/$DEPLOY_USER/.ssh/authorized_keys"
fi

# ── 6. Directory skeleton ────────────────────────────────────────────────────
log "creating $APP_ROOT layout"
install -d -o "$DEPLOY_USER" -g "$DEPLOY_USER" \
  "$APP_ROOT" "$APP_ROOT/releases" "$APP_ROOT/shared" "$APP_ROOT/incoming"
install -d -o root -g root "$APP_ROOT/infrastructure"

log "syncing infrastructure config from the checked-out repo (does not touch data volumes)"
mkdir -p "$APP_ROOT/infrastructure/caddy" "$APP_ROOT/infrastructure/postgres"
cp "$REPO_ROOT/infrastructure/caddy/Caddyfile" "$APP_ROOT/infrastructure/caddy/Caddyfile"
cp "$REPO_ROOT/infrastructure/caddy/compose.yml" "$APP_ROOT/infrastructure/caddy/compose.yml"
cp "$REPO_ROOT/infrastructure/postgres/compose.yml" "$APP_ROOT/infrastructure/postgres/compose.yml"

# ── 7. Generated, per-server secrets — created once, never overwritten ──────
gen_secret() { openssl rand -hex 32; }

if [[ ! -f "$APP_ROOT/shared/postgres.env" ]]; then
  log "generating $APP_ROOT/shared/postgres.env (first run only)"
  cat > "$APP_ROOT/shared/postgres.env" <<EOF
POSTGRES_USER=portfolioiq
POSTGRES_PASSWORD=$(openssl rand -hex 24)
POSTGRES_DB=portfolio_rebalancing
EOF
  chmod 640 "$APP_ROOT/shared/postgres.env"
  chown root:"$DEPLOY_USER" "$APP_ROOT/shared/postgres.env"
else
  log "$APP_ROOT/shared/postgres.env already exists, leaving untouched"
fi

# shellcheck disable=SC1090
source "$APP_ROOT/shared/postgres.env"

if [[ ! -f "$APP_ROOT/shared/platform-service.env" ]]; then
  log "generating $APP_ROOT/shared/platform-service.env (first run only)"
  cat > "$APP_ROOT/shared/platform-service.env" <<EOF
PORT=5000
DATABASE_URL=postgresql://${POSTGRES_USER}:${POSTGRES_PASSWORD}@127.0.0.1:5432/${POSTGRES_DB}
JWT_SECRET=$(gen_secret)
JWT_EXPIRES_IN=7d
MODEL_SERVICE_URL=http://127.0.0.1:8000
ADMIN_SECRET=$(gen_secret)
MODEL_SERVICE_SECRET=REPLACE_MANUALLY_SEE_BELOW
FEDERATED_CONTRIBUTIONS_ENABLED=false
FEDERATED_AGGREGATION_ENABLED=false
OUTCOME_BASED_MODEL_ENABLED=false
DEMO_MODEL_ENABLED=true
EOF
  chmod 640 "$APP_ROOT/shared/platform-service.env"
  chown root:"$DEPLOY_USER" "$APP_ROOT/shared/platform-service.env"
else
  log "$APP_ROOT/shared/platform-service.env already exists, leaving untouched"
fi

if [[ ! -f "$APP_ROOT/shared/model-service.env" ]]; then
  log "generating $APP_ROOT/shared/model-service.env (first run only)"
  # Must match MODEL_SERVICE_SECRET in platform-service.env exactly. Bootstrap
  # cannot safely reconcile two files at once here, so both are written with a
  # clear placeholder and the operator sets one shared value in both — see
  # docs/DEPLOYMENT.md "First-time secret setup".
  cat > "$APP_ROOT/shared/model-service.env" <<EOF
PORT=8000
HOST=127.0.0.1
MODEL_SERVICE_SECRET=REPLACE_MANUALLY_SEE_BELOW
DEMO_MODEL_ENABLED=true
EOF
  chmod 640 "$APP_ROOT/shared/model-service.env"
  chown root:"$DEPLOY_USER" "$APP_ROOT/shared/model-service.env"
else
  log "$APP_ROOT/shared/model-service.env already exists, leaving untouched"
fi

# ── 8. Narrow sudoers grant: exactly the systemctl verbs the deploy path
#         needs, on exactly the three named units, nothing else ────────────
SUDOERS_FILE=/etc/sudoers.d/portfolioiq-deploy
cat > "${SUDOERS_FILE}.tmp" <<'EOF'
portfolioiq ALL=(root) NOPASSWD: \
  /usr/bin/systemctl restart portfolioiq-client.service, \
  /usr/bin/systemctl restart portfolioiq-platform.service, \
  /usr/bin/systemctl restart portfolioiq-model.service, \
  /usr/bin/systemctl status portfolioiq-client.service, \
  /usr/bin/systemctl status portfolioiq-platform.service, \
  /usr/bin/systemctl status portfolioiq-model.service, \
  /usr/bin/systemctl is-active portfolioiq-client.service, \
  /usr/bin/systemctl is-active portfolioiq-platform.service, \
  /usr/bin/systemctl is-active portfolioiq-model.service
EOF
visudo -c -f "${SUDOERS_FILE}.tmp"
install -m 440 "${SUDOERS_FILE}.tmp" "$SUDOERS_FILE"
rm -f "${SUDOERS_FILE}.tmp"
log "installed narrow sudoers grant at $SUDOERS_FILE"

# ── 9. systemd unit files ────────────────────────────────────────────────────
log "installing systemd unit files"
cp "$REPO_ROOT"/infrastructure/systemd/portfolioiq-*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable portfolioiq-client.service portfolioiq-platform.service portfolioiq-model.service

# ── 10. Infrastructure containers (Caddy, Postgres) ─────────────────────────
log "starting Postgres (infrastructure)"
docker compose --env-file "$APP_ROOT/shared/postgres.env" -f "$APP_ROOT/infrastructure/postgres/compose.yml" up -d

log "starting Caddy (infrastructure)"
docker compose -f "$APP_ROOT/infrastructure/caddy/compose.yml" up -d

# ── 11. Host firewall (defense in depth; the EC2 Security Group is the
#          primary control and must independently allow only 22/80/443) ────
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null
  ufw allow 80/tcp >/dev/null
  ufw allow 443/tcp >/dev/null
  yes | ufw enable >/dev/null || true
  log "ufw active: $(ufw status | head -1)"
fi

cat <<EOF

[bootstrap] Base infrastructure is up. Remaining manual steps:

  1. Add the GitHub Actions deploy public key to:
       /home/$DEPLOY_USER/.ssh/authorized_keys
  2. Set MODEL_SERVICE_SECRET to the SAME value in both:
       $APP_ROOT/shared/platform-service.env
       $APP_ROOT/shared/model-service.env
     (generate one with: openssl rand -hex 32)
  3. Confirm $DOMAIN resolves to this instance's public IP (DuckDNS).
  4. Confirm the EC2 Security Group allows inbound 80, 443, and 22 (restricted).
  5. Run the first deployment (see docs/DEPLOYMENT.md).

No application release exists yet, so portfolioiq-{client,platform,model}
are enabled but not started — the first deploy will start them.
EOF
