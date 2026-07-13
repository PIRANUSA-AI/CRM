# CRM

Internal sales CRM platform — single-tenant, one production
deployment. Backend (Elysia/Bun/Prisma) + Frontend (TanStack Start/Vite) in
a Bun workspace, plus a dedicated WhatsApp runtime service
(`whatsapp-service`).

This is the standalone development repo. Deployment tooling (PM2, Nginx,
certbot automation) lives in a separate `crm-installer` bundle — see
[Production](#production) below.

## Development setup

**Prerequisites:** Bun >= 1.1, Docker (for Postgres/Redis).

1. Start infra dependencies:

   ```bash
   docker compose up -d
   ```

   This runs Postgres 17 on `127.0.0.1:5433` and Redis on `127.0.0.1:6379`,
   matching the credentials already in `.env`. If you already have Postgres/
   Redis running natively on those same ports (e.g. from a previous GCLAW
   setup on this machine), skip this step — just make sure something is
   listening on 5433/6379 before continuing.

2. Install dependencies (Bun workspace — installs backend + frontend):

   ```bash
   bun install
   ```

3. Copy the single root env file if you don't already have it:

   ```bash
   cp .env.example .env
   ```

   Backend, frontend, and WhatsApp service all load this root file. Variables
   exposed to browser code must keep the `VITE_` prefix. For local dev, all
   URLs should point at `localhost` — no placeholder production IPs/domains.

4. Generate the Prisma client and push the schema:

   ```bash
   bun run db:generate
   bun run db:push
   ```

5. Run backend and frontend (two terminals, or `bun run dev` for both at
   once via the workspace filter):

   ```bash
   bun run dev:backend    # API on :3010, Socket.IO on :3011
   bun run dev:frontend   # Vite dev server on :3005
   ```

6. (Optional) WhatsApp runtime, only needed when testing WA integration:

   ```bash
   cd whatsapp-service
   bun install
   cp .env.example .env
   ./run.sh
   ```

Open `http://localhost:3005` — it should redirect to `/login`.

### Known cleanup items (not blockers)

- Root `package.json` has `k3d:up` / `k8s:deploy:local` / `helm-*` scripts
  pointing at a `deploy/local/` directory that doesn't exist in this repo —
  leftover from an abandoned Kubernetes experiment. Safe to ignore; will be
  removed in a follow-up cleanup.
- `apps/backend/Dockerfile` and `apps/frontend/Dockerfile` exist but aren't
  used by the current dev or production path (see below). Kept in case a
  container-based deploy is worth revisiting later.

## Production

**Status: no production server provisioned yet.** This section is the
runbook for when one exists — nothing below needs to happen today.

Deployment does **not** happen from this repo directly. A separate bundle,
`opencrm-installer` (its own repo, deliberately left untouched by this
rename — it still uses the `OPENCRM_*`/`opencrm-*` names internally), owns
the production runbook (PM2 process management, Nginx reverse proxy,
certbot SSL, environment generation). It's kept deliberately decoupled from
this repo — see its own `CLAUDE.md` for the full debug rhythm and gate
order.

Once a server exists, from inside `opencrm-installer`:

```bash
OPENCRM_APP_DIR=/absolute/path/to/crm-app \
OPENCRM_BAILEYS_DIR=/absolute/path/to/crm-app/whatsapp-service \
OPENCRM_PUBLIC_HOST=<server-ip> \
npm run openclaw:plan
npm run openclaw:doctor
npm run openclaw:install
```

`OPENCRM_APP_DIR` / `OPENCRM_BAILEYS_DIR` tell the installer where this repo
lives — it no longer needs to be nested inside the installer bundle. If a
domain is available instead of IP-only access, add
`OPENCRM_FRONTEND_DOMAIN` / `OPENCRM_BACKEND_DOMAIN` /
`OPENCRM_CERTBOT_EMAIL` so certbot issues real SSL certificates.

Day-to-day updates after the first install are just:

```bash
git pull
bun install
bun run build
pm2 reload opencrm-api opencrm-worker opencrm-frontend crm-whatsapp-service
```

— no need to re-run the full installer for routine deploys, only for a
from-scratch server bootstrap or disaster recovery.
