#!/usr/bin/env bash
# Builds a release tarball containing exactly what the three application
# services need at runtime, plus release.json metadata tying it back to the
# git commit and workflow run that produced it. Run from anywhere; always
# operates on the repository root.
#
# Required env:
#   PUBLIC_API_URL   e.g. https://portfolyo-iq.duckdns.org — compiled into the
#                    client bundle at build time (NEXT_PUBLIC_API_URL). Not a
#                    secret: it ends up in the browser bundle regardless.
# Optional env:
#   COMMIT_SHA        defaults to `git rev-parse HEAD`
#   WORKFLOW_RUN_ID   recorded in release.json for traceability
#   WORKFLOW_RUN_URL  recorded in release.json for traceability
set -euo pipefail

: "${PUBLIC_API_URL:?PUBLIC_API_URL must be set (e.g. https://portfolyo-iq.duckdns.org)}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_ROOT"

COMMIT_SHA="${COMMIT_SHA:-$(git rev-parse HEAD)}"
RELEASE_ID="$(date -u +%Y%m%d%H%M%S)-${COMMIT_SHA:0:7}"
WORK_DIR="$(mktemp -d)"
STAGE_DIR="${WORK_DIR}/${RELEASE_ID}"
OUT_TARBALL="${REPO_ROOT}/${RELEASE_ID}.tar.gz"

log() { echo "[build-artifact] $*"; }

log "installing dependencies (frozen lockfile, hoisted layout)"
# --linker hoisted forces a classic, fully self-contained node_modules tree.
# Bun's default "isolated" linker resolves a package's own sub-dependencies
# through a shared node_modules/.bun store via relative symlinks that point
# outside each workspace's node_modules — a plain copy of a workspace's
# node_modules alone loses those sibling dependencies and breaks at runtime
# (confirmed: express couldn't resolve its own body-parser dependency).
# Dereferencing those symlinks doesn't fix it either: node_modules/.bin
# launchers (e.g. next) are themselves symlinks into their package's real
# files and rely on paths relative to that original nested location, so
# flattening them breaks their own requires (confirmed: `next start` failed
# to find "../server/require-hook" once .bin/next was dereferenced). Hoisted
# mode avoids both problems — no external store, and every symlink it does
# create stays self-contained within the copied tree — so the plain,
# non-dereferencing `cp -a` below is correct only because of this flag.
bun install --frozen-lockfile --linker hoisted

log "building react-client (NEXT_PUBLIC_API_URL=${PUBLIC_API_URL})"
NEXT_PUBLIC_API_URL="$PUBLIC_API_URL" bun run --filter react-client build

log "building platform-service"
bun run --filter platform-service build

log "staging release at $STAGE_DIR"
mkdir -p \
  "$STAGE_DIR/apps/react-client" \
  "$STAGE_DIR/apps/platform-service" \
  "$STAGE_DIR/apps/model-service" \
  "$STAGE_DIR/packages/database" \
  "$STAGE_DIR/packages/model-contract"

# With --linker hoisted, third-party dependencies live in the repo ROOT
# node_modules and are found by Node/Bun's normal upward directory search from
# each app; only a workspace's own version overrides get a local node_modules.
# The release must preserve that same relative shape (root node_modules next
# to apps/ and packages/), which is why the root node_modules is copied once
# below rather than per-app.
cp -a node_modules "$STAGE_DIR/node_modules"

# react-client: everything `next start` needs to serve the app.
cp -a apps/react-client/.next "$STAGE_DIR/apps/react-client/"
cp -a apps/react-client/public "$STAGE_DIR/apps/react-client/"
[[ -d apps/react-client/node_modules ]] && cp -a apps/react-client/node_modules "$STAGE_DIR/apps/react-client/"
cp apps/react-client/package.json apps/react-client/next.config.ts apps/react-client/tsconfig.json \
  "$STAGE_DIR/apps/react-client/"

# platform-service: compiled output only, not src/tests.
cp -a apps/platform-service/dist "$STAGE_DIR/apps/platform-service/"
[[ -d apps/platform-service/node_modules ]] && cp -a apps/platform-service/node_modules "$STAGE_DIR/apps/platform-service/"
cp apps/platform-service/package.json "$STAGE_DIR/apps/platform-service/"

# model-service: app code + manifest + the demo dataset POST /train/dataset
# reads when DEMO_MODEL_ENABLED=true. dataset.csv and test.service.py are
# excluded — nothing at runtime reads them, only demo-dataset.csv is opened
# by app/main.py.
cp -a apps/model-service/app "$STAGE_DIR/apps/model-service/"
cp apps/model-service/package.json apps/model-service/requirements.txt apps/model-service/demo-dataset.csv \
  "$STAGE_DIR/apps/model-service/"

# packages/database: the workspace import target for platform-service's
# dist output, and the source of drizzle-kit migrate on the server (drizzle-kit
# itself resolves from the root node_modules copied above, hoisted mode has no
# separate per-package copy for it).
cp -a packages/database/drizzle packages/database/src "$STAGE_DIR/packages/database/"
[[ -d packages/database/node_modules ]] && cp -a packages/database/node_modules "$STAGE_DIR/packages/database/"
cp packages/database/package.json packages/database/drizzle.config.ts packages/database/tsconfig.json \
  "$STAGE_DIR/packages/database/"

# packages/model-contract: model-service resolves this at a fixed relative
# depth from apps/model-service/app/main.py (three parents up) — this layout
# preserves that depth inside the release directory.
cp packages/model-contract/feature-spec.json packages/model-contract/parity-fixtures.json \
  "$STAGE_DIR/packages/model-contract/"

cat > "$STAGE_DIR/release.json" <<EOF
{
  "release": "${RELEASE_ID}",
  "commit": "${COMMIT_SHA}",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "workflowRunId": "${WORKFLOW_RUN_ID:-}",
  "workflowRunUrl": "${WORKFLOW_RUN_URL:-}",
  "publicApiUrl": "${PUBLIC_API_URL}"
}
EOF

log "packing $OUT_TARBALL"
tar -C "$WORK_DIR" -czf "$OUT_TARBALL" "$RELEASE_ID"
(cd "$(dirname "$OUT_TARBALL")" && sha256sum "$(basename "$OUT_TARBALL")") > "${OUT_TARBALL}.sha256"
rm -rf "$WORK_DIR"

log "done: $OUT_TARBALL"
if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  echo "release_id=${RELEASE_ID}" >> "$GITHUB_OUTPUT"
  echo "artifact_path=${OUT_TARBALL}" >> "$GITHUB_OUTPUT"
fi
