# PortfolioIQ Deployment

This document describes how PortfolioIQ is built, tested, and deployed to production, and how to operate the running system on EC2.

## Architecture at a glance

```
GitHub (push to main)
      │
      ▼
GitHub Actions: CI (lint/typecheck/build/test) then Deploy (build → scp → remote-deploy.sh)
      │ SSH
      ▼
EC2 (Ubuntu)
 /opt/portfolioiq/
   releases/<timestamp>-<sha>/     one directory per deploy
   current -> releases/<active>    symlink switched atomically
   shared/*.env                    production secrets, never in git or the artifact
   infrastructure/{caddy,postgres} Docker Compose, managed separately from app deploys
 systemd: portfolioiq-{client,platform,model}.service, WorkingDirectory under "current"
 Docker: Caddy (TLS + reverse proxy, :80/:443 public) and PostgreSQL (127.0.0.1:5432 only)
```

Application services (Next.js client, Express platform-service, FastAPI model-service) run as native systemd-managed processes on the EC2 host — **not** in Docker. Only infrastructure (Caddy, PostgreSQL) is containerized.

## Local development

Unchanged from the root `README.md`:

```bash
bun install
cp apps/platform-service/.env.example apps/platform-service/.env.local   # then fill in secrets
cp apps/model-service/.env.example    apps/model-service/.env.local
cp apps/react-client/.env.example     apps/react-client/.env.local
cp packages/database/.env.example     packages/database/.env.local
cd apps/model-service && uv venv --python 3.11 .venv && uv pip install -r requirements.txt --python .venv/bin/python && cd ../..
bun run dev
```

`uv venv --python 3.11 .venv` is a drop-in alternative to the README's `python3 -m venv` + `pip install` — it provisions Python 3.11 itself if it isn't already installed, without touching the system Python.

## CI (`.github/workflows/ci.yml`)

Runs on every push and pull request. `permissions: contents: read` — CI never writes anything back to GitHub.

- **TypeScript job**: `bun install --frozen-lockfile`, ESLint on `react-client`, `tsc` build across every workspace that defines a `build` script, then `bun run --filter react-client test` and `bun run --filter platform-service test`. A `postgres:17-alpine` service container is provided so the platform-service migration test exercises a real database instead of reporting itself skipped (every other test in that suite substitutes its own data layer and never opens a real connection — see `tests/setup-env.ts`).
- **model-service job**: provisions Python 3.11 via `uv venv`, installs `requirements.txt`, runs `python -m unittest discover`.

## CD (`.github/workflows/deploy.yml`)

Triggers only on push to `main` (the repository's actual default branch). `concurrency: { group: production-deploy, cancel-in-progress: false }` — a second push queues rather than racing or cancelling an in-flight deploy.

1. `scripts/deploy/build-artifact.sh` builds `react-client` (with `NEXT_PUBLIC_API_URL` baked in — see below) and `platform-service`, then stages exactly what each service needs at runtime into a single `<release-id>.tar.gz` plus a `release.json` (commit, workflow run, build time).
2. The tarball, its checksum, and `scripts/deploy/remote-deploy.sh` itself are `scp`'d to `/opt/portfolioiq/incoming/` over key-based SSH with a **pinned host key** (no `StrictHostKeyChecking=no`).
3. `remote-deploy.sh` runs over SSH on the server and does everything from extraction through health-checked activation (see "Release lifecycle" below).
4. A final step curls the public `https://portfolyo-iq.duckdns.org/health` to confirm Caddy is actually routing to the newly activated release, not just that the loopback health checks inside `remote-deploy.sh` passed.

### Why `NEXT_PUBLIC_API_URL` matters

The browser calls the platform API **directly** — `react-client`'s client components read `NEXT_PUBLIC_API_URL` and issue `fetch()` calls straight from the user's browser, not through the Next.js server. This value is compiled into the JavaScript bundle at `next build` time, so it must already be the real public origin (`https://portfolyo-iq.duckdns.org`) when CI builds the client. It is not a secret — it's visible in every page load regardless — so it's a plain workflow `env:`, not a GitHub secret.

### Why the artifact ships full `node_modules`, hoisted

`build-artifact.sh` runs `bun install --linker hoisted`, not Bun's default isolated linker. Two real bugs were found and fixed while building this pipeline:

1. Bun's default isolated linker resolves a package's own sub-dependencies through a shared `node_modules/.bun` store via symlinks that point *outside* any single workspace's `node_modules`. Copying a workspace's `node_modules` in isolation (even while dereferencing symlinks) silently drops those sibling dependencies — confirmed by `express` failing to resolve its own `body-parser` dependency.
2. Dereferencing symlinks doesn't fix it either: `node_modules/.bin/next` is itself a symlink into `next`'s real files, and that launcher script uses paths relative to its *original* nested location. Flattening it breaks its own internal requires — confirmed by `next start` failing on `Cannot find module '../server/require-hook'`.

`--linker hoisted` produces a classic, fully self-contained `node_modules` tree with no external store, so a plain `cp -a` (preserving whatever internal, self-referential symlinks remain) is portable on its own. This was verified by actually extracting a built artifact and booting all three services from it standalone (see the three health-check commands in "Troubleshooting" below — those are the exact commands used to validate this).

devDependencies are shipped too, rather than pruned to a separate production-only install — this keeps the artifact byte-for-byte what CI built and tested (no second, untested install step), at the cost of a larger tarball (~800MB uncompressed). `packages/database`'s `drizzle-kit` (a devDependency) is specifically needed on the server to run migrations, which was the deciding factor.

## EC2 architecture

### Users

- `portfolioiq` — dedicated, unprivileged system user. Owns `/opt/portfolioiq`. Member of the `docker` group (to manage the Caddy/Postgres containers) and `systemd-journal` (to read logs without sudo). Has a narrow, explicit `sudoers` grant (`/etc/sudoers.d/portfolioiq-deploy`) limited to `systemctl restart|status|is-active` on exactly the three named `portfolioiq-*.service` units — nothing else, no wildcards, no other commands.
- GitHub Actions should SSH in **as `portfolioiq`** (point the `EC2_USERNAME` secret at it) rather than a general admin account, so the automated deploy path runs with exactly the permissions it needs and no more.

### Directory layout

```
/opt/portfolioiq/
├── releases/<release-id>/    one per deploy, self-contained (own node_modules, own venv)
├── current -> releases/...   atomically switched (ln -sfn + mv -T)
├── incoming/                 scp landing zone for the next artifact
├── shared/
│   ├── postgres.env          generated once by bootstrap, never overwritten
│   ├── platform-service.env  generated once by bootstrap; MODEL_SERVICE_SECRET must be
│   │                         set to match model-service.env — see "First-time secrets" below
│   └── model-service.env     generated once by bootstrap
├── infrastructure/
│   ├── caddy/{Caddyfile,compose.yml}
│   └── postgres/compose.yml
└── deploy.lock                flock target; prevents two deploys running at once
```

### First-time bootstrap

From a checked-out copy of this repo on the server:

```bash
git clone git@github.com:CSVaishakh/PortfolyoIQ.git /opt/portfolioiq-src
cd /opt/portfolioiq-src
sudo bash scripts/deploy/bootstrap-ec2.sh
```

This is idempotent — re-running it never rotates existing secrets, never touches the Postgres or Caddy data volumes, and never restarts a running application service. It installs Docker, Bun, and `uv` system-wide (`/usr/local/bin`, not tied to any user's `$HOME`), creates the `portfolioiq` user and directory skeleton, generates `shared/*.env` **only if missing**, installs the systemd units (enabled, not started — there's no release yet), installs the narrow sudoers grant, and brings up the Caddy and Postgres containers.

### First-time secrets

Bootstrap generates `JWT_SECRET`, `ADMIN_SECRET`, and the Postgres password automatically. It **cannot** safely generate `MODEL_SERVICE_SECRET` in both files at once, so it writes a placeholder to both — you must set the same value in both before the first deploy:

```bash
SECRET=$(openssl rand -hex 32)
sudo sed -i "s/^MODEL_SERVICE_SECRET=.*/MODEL_SERVICE_SECRET=$SECRET/" \
  /opt/portfolioiq/shared/platform-service.env \
  /opt/portfolioiq/shared/model-service.env
```

## systemd

| Unit | Runs | Working directory |
|---|---|---|
| `portfolioiq-platform.service` | `bun dist/index.js` | `/opt/portfolioiq/current/apps/platform-service` |
| `portfolioiq-model.service` | `bun run start` (activates `.venv`, launches uvicorn) | `/opt/portfolioiq/current/apps/model-service` |
| `portfolioiq-client.service` | `bun run start -- -H 127.0.0.1` | `/opt/portfolioiq/current/apps/react-client` |

`platform-service` must run under **Bun, not Node** — its compiled `dist/index.js` imports the `database` workspace package, whose `main` field points at uncompiled TypeScript, which only Bun executes transparently.

All three bind to `127.0.0.1` only. Caddy is the sole public entry point.

```bash
sudo systemctl status portfolioiq-platform.service
sudo systemctl restart portfolioiq-model.service
journalctl -u portfolioiq-client.service -f
```

## Caddy

Runs as the official `caddy:2-alpine` image (`infrastructure/caddy/compose.yml`), ports `80`/`443` public, `caddy_data`/`caddy_config` on named Docker volumes (`portfolioiq_caddy_data`, `portfolioiq_caddy_config`) that persist across restarts and are never touched by an application deploy.

**Networking to native services**: since the app services are host processes, not containers, `localhost` inside the Caddy container would refer to the container itself. The compose file adds `extra_hosts: host.docker.internal:host-gateway`, and the Caddyfile proxies to `host.docker.internal:<port>`.

**Routing** (`infrastructure/caddy/Caddyfile`) is deliberately not a blanket path prefix: the Next.js app owns a UI page at exactly `/auth`, while the platform API separately owns `/auth/signup` and `/auth/signin`. Only those exact API paths, plus `/client/*`, `/model/*`, and `/health`, route to the platform-service; everything else — including the bare `/auth` page — goes to the client.

Changing the Caddyfile:

```bash
cd /opt/portfolioiq/infrastructure/caddy
docker compose exec caddy caddy validate --config /etc/caddy/Caddyfile   # must pass first
docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

Never `docker compose down` Caddy as part of a routine change — `reload` applies a new config without dropping the ACME state or an existing connection.

## PostgreSQL

`postgres:17-alpine` (matching the version documented in the root README), `infrastructure/postgres/compose.yml`, bound to `127.0.0.1:5432` only, named volume `portfolioiq_postgres_data`. Application deploys never restart, recreate, or touch this container — it is infrastructure, brought up once by bootstrap and left alone.

Migrations run as part of every deploy, via `drizzle-kit migrate` against the tracked SQL files in `packages/database/drizzle/` — **not** `drizzle-kit push`, which is a dev-only schema-diff tool with no audit trail. If a migration fails, `remote-deploy.sh` aborts before touching the `current` symlink or restarting any service.

```bash
docker exec -it portfolioiq-postgres psql -U portfolioiq -d portfolio_rebalancing
docker compose -f /opt/portfolioiq/infrastructure/postgres/compose.yml logs -f
```

## Environment variables

Production secrets live only on the server, in `/opt/portfolioiq/shared/*.env` (mode `640`, owned by `root:portfolioiq`) — never in the git repo, never in the release artifact. On every deploy, `remote-deploy.sh` copies these into the new release as `.env.local` (matching the `dotenv` loading convention already used by `platform-service` and `model-service` in local development), so systemd only needs `WorkingDirectory` set correctly for that convention to work.

`react-client` has no runtime secrets — its only environment-dependent value, `NEXT_PUBLIC_API_URL`, is baked in at CI build time (see CD above), so its systemd unit only sets `PORT` directly.

## Release lifecycle

```
push to main
  → CI passes
  → CD: build-artifact.sh (build, stage, tar, checksum)
  → scp tarball + checksum + remote-deploy.sh to EC2
  → remote-deploy.sh (as portfolioiq, under flock):
       verify checksum
       extract to releases/<id>/
       validate required paths exist (feature-spec.json at the right relative
         depth, dist/index.js, .next/, node_modules/, etc.)
       copy shared/*.env into the release as .env.local
       uv venv + uv pip install for model-service
       drizzle-kit migrate            — abort here on failure, nothing else touched
       current -> releases/<id>       — atomic (ln -sfn + mv -T)
       sudo systemctl restart portfolioiq-{platform,model,client}
       health-check loopback :5000/health, :8000/, :3000/api/health (up to 30s)
       success → record deployed_at, prune releases beyond the last 5
       failure → roll back current to the previous release, restart, re-check
                 → still failing → exit loudly: "MANUAL INTERVENTION REQUIRED"
```

## Rollback

Automatic on a failed health check (see above). To roll back manually to a specific earlier release:

```bash
ls -lt /opt/portfolioiq/releases/          # find the release id you want
sudo ln -sfn /opt/portfolioiq/releases/<release-id> /opt/portfolioiq/current.new
sudo mv -T /opt/portfolioiq/current.new /opt/portfolioiq/current
sudo systemctl restart portfolioiq-platform portfolioiq-model portfolioiq-client
curl -f http://127.0.0.1:5000/health && curl -f http://127.0.0.1:8000/ && curl -f http://127.0.0.1:3000/api/health
```

Database migrations are **not** automatically rolled back — application rollback and schema rollback are different operations. If a bad release included a destructive migration, that needs a deliberate, reviewed fix, not an automatic reversal.

## Troubleshooting

| Symptom | Check |
|---|---|
| Deploy failed | The GitHub Actions run log shows which `remote-deploy.sh` step failed and why (checksum, missing path, migration, or health check) |
| A service is down | `sudo systemctl status portfolioiq-<client\|platform\|model>.service` then `journalctl -u portfolioiq-<name>.service -n 100` |
| Site unreachable but services report healthy | `docker compose -f /opt/portfolioiq/infrastructure/caddy/compose.yml logs -f caddy`; confirm DNS: `dig +short portfolyo-iq.duckdns.org` matches the EC2 public IP |
| TLS not issuing | Check Caddy logs for ACME errors; confirm the EC2 Security Group allows inbound 80 and 443 from `0.0.0.0/0` |
| DB connection errors | `docker compose -f /opt/portfolioiq/infrastructure/postgres/compose.yml ps`; confirm `DATABASE_URL` in `shared/platform-service.env` matches `shared/postgres.env` |
| Need to confirm what's actually running | `cat /opt/portfolioiq/current/../release.json` (via the `current` symlink) shows the commit, workflow run, and build time of the active release |
| Suspect a bad deploy lock | `ls -la /opt/portfolioiq/deploy.lock`; a stuck lock only persists if a previous `remote-deploy.sh` process is still alive — check `ps aux \| grep remote-deploy` before removing it |

## Required EC2 Security Group rules

| Port | Source | Purpose |
|---|---|---|
| 443 | `0.0.0.0/0` | HTTPS (Caddy) |
| 80 | `0.0.0.0/0` | HTTP → HTTPS redirect + ACME HTTP-01 challenge |
| 22 | your admin IP range only | SSH (GitHub Actions deploys via key-based auth to this same port) |

Nothing else should be open. `5432` (Postgres), `3000` (client), `5000` (platform), and `8000` (model) are intentionally never reachable from outside the host.
