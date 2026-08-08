#!/usr/bin/env bash
# Runs ON the EC2 host (over SSH, as the "portfolioiq" user) to activate a
# release that has already been uploaded to /opt/portfolioiq/incoming/.
#
# Usage: remote-deploy.sh <release-id>
#
# Sequence: verify -> extract -> validate -> provision model-service venv ->
# migrate -> switch symlink -> restart -> health-check -> prune, with
# automatic rollback to the previous release on any post-activation failure.
set -euo pipefail

APP_ROOT=/opt/portfolioiq
RETAIN=5
HEALTH_RETRIES=15
HEALTH_DELAY=2

RELEASE_ID="${1:?usage: remote-deploy.sh <release-id>}"
TARBALL="$APP_ROOT/incoming/${RELEASE_ID}.tar.gz"
RELEASE_DIR="$APP_ROOT/releases/${RELEASE_ID}"
LOCK_FILE="$APP_ROOT/deploy.lock"

log() { echo "[deploy] $*"; }
fail() { echo "[deploy] ERROR: $*" >&2; exit 1; }

# ── Concurrency guard ─────────────────────────────────────────────────────
exec 9>"$LOCK_FILE"
flock -n 9 || fail "another deployment is already in progress"

# ── Verify the uploaded artifact before touching anything ──────────────────
[[ -f "$TARBALL" ]] || fail "artifact not found: $TARBALL"
[[ -f "${TARBALL}.sha256" ]] || fail "checksum file not found: ${TARBALL}.sha256"

log "verifying artifact checksum"
(cd "$(dirname "$TARBALL")" && sha256sum -c "$(basename "${TARBALL}.sha256")") \
  || fail "checksum verification failed for $TARBALL — upload may be corrupt or incomplete"

[[ -d "$RELEASE_DIR" ]] && fail "release directory already exists: $RELEASE_DIR (refusing to overwrite)"

log "extracting to $RELEASE_DIR"
mkdir -p "$APP_ROOT/releases"
tar -xzf "$TARBALL" -C "$APP_ROOT/releases"

log "validating release contents"
for required in \
  apps/react-client/.next \
  apps/platform-service/dist/index.js \
  apps/model-service/app/main.py \
  apps/model-service/requirements.txt \
  packages/model-contract/feature-spec.json \
  packages/database/drizzle.config.ts \
  node_modules \
  release.json
do
  [[ -e "$RELEASE_DIR/$required" ]] || fail "release is missing required path: $required"
done

# ── Secrets live only on the server, never in the artifact ─────────────────
[[ -f "$APP_ROOT/shared/platform-service.env" ]] \
  || fail "$APP_ROOT/shared/platform-service.env is missing — run bootstrap-ec2.sh and set secrets first"
[[ -f "$APP_ROOT/shared/model-service.env" ]] \
  || fail "$APP_ROOT/shared/model-service.env is missing — run bootstrap-ec2.sh and set secrets first"

log "materializing per-release env files from shared secrets"
cp "$APP_ROOT/shared/platform-service.env" "$RELEASE_DIR/apps/platform-service/.env.local"
cp "$APP_ROOT/shared/model-service.env" "$RELEASE_DIR/apps/model-service/.env.local"
chmod 640 "$RELEASE_DIR/apps/platform-service/.env.local" "$RELEASE_DIR/apps/model-service/.env.local"

log "provisioning model-service Python 3.11 environment (uv)"
(cd "$RELEASE_DIR/apps/model-service" \
  && uv venv --python 3.11 .venv \
  && uv pip install -r requirements.txt --python .venv/bin/python) \
  || fail "model-service environment setup failed — release left in place for inspection, current untouched"

log "running database migrations (drizzle-kit migrate)"
set -a
# shellcheck disable=SC1091
source "$APP_ROOT/shared/platform-service.env"
set +a
(cd "$RELEASE_DIR/packages/database" && "$RELEASE_DIR/node_modules/.bin/drizzle-kit" migrate) \
  || fail "migration failed — current release untouched, no service restarted"

PREVIOUS_RELEASE=""
if [[ -L "$APP_ROOT/current" ]]; then
  PREVIOUS_RELEASE="$(readlink -f "$APP_ROOT/current")"
fi

activate() {
  local target="$1"
  ln -sfn "$target" "$APP_ROOT/current.new"
  mv -T "$APP_ROOT/current.new" "$APP_ROOT/current"
}

restart_services() {
  sudo -n /usr/bin/systemctl restart portfolioiq-platform.service
  sudo -n /usr/bin/systemctl restart portfolioiq-model.service
  sudo -n /usr/bin/systemctl restart portfolioiq-client.service
}

health_check() {
  local attempt
  for ((attempt = 1; attempt <= HEALTH_RETRIES; attempt++)); do
    if curl -fsS -m 3 http://127.0.0.1:5000/health >/dev/null \
      && curl -fsS -m 3 http://127.0.0.1:8000/ >/dev/null \
      && curl -fsS -m 3 http://127.0.0.1:3000/api/health >/dev/null; then
      return 0
    fi
    sleep "$HEALTH_DELAY"
  done
  return 1
}

log "activating release (current -> $RELEASE_DIR)"
activate "$RELEASE_DIR"

log "restarting application services"
restart_services

log "health-checking (up to $((HEALTH_RETRIES * HEALTH_DELAY))s)"
if health_check; then
  date -u +%Y-%m-%dT%H:%M:%SZ > "$RELEASE_DIR/deployed_at"
  log "deploy succeeded: $RELEASE_ID"
else
  log "health check failed after activating $RELEASE_ID — rolling back"
  if [[ -z "$PREVIOUS_RELEASE" ]]; then
    fail "no previous release exists to roll back to — production is DOWN, manual intervention required"
  fi
  activate "$PREVIOUS_RELEASE"
  restart_services
  if health_check; then
    fail "deploy of $RELEASE_ID failed and was rolled back to $(basename "$PREVIOUS_RELEASE"); investigate before retrying"
  else
    fail "deploy of $RELEASE_ID failed AND rollback to $(basename "$PREVIOUS_RELEASE") also failed health checks — MANUAL INTERVENTION REQUIRED. Check: sudo systemctl status portfolioiq-{client,platform,model}, journalctl -u <service> -n 100."
  fi
fi

# ── Retention: keep the newest N releases, and whatever "current" points at,
#    even if it happens to be older than the retention window ─────────────
log "pruning releases beyond the last $RETAIN"
CURRENT_TARGET="$(readlink -f "$APP_ROOT/current")"
cd "$APP_ROOT/releases"
mapfile -t ALL_RELEASES < <(ls -1dt -- */ 2>/dev/null | sed 's#/$##')
KEPT=0
for name in "${ALL_RELEASES[@]}"; do
  path="$APP_ROOT/releases/$name"
  if [[ "$path" == "$CURRENT_TARGET" ]]; then
    continue
  fi
  KEPT=$((KEPT + 1))
  if (( KEPT > RETAIN )); then
    log "removing old release $name"
    rm -rf -- "${APP_ROOT:?}/releases/${name:?}"
  fi
done

rm -f "$TARBALL" "${TARBALL}.sha256"
log "done"
