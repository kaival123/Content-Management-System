# Deploying the Landing CMS

The CMS is now **multi-user**: email/password login, one isolated website folder per user
on disk, and a small SQLite database for accounts and form submissions.

- **Website content** → files on disk at `data/users/<userId>/site/...` (seeded from `site/`).
- **Accounts, sessions, submissions** → SQLite at `data/cms.db`.

Because all data lives on disk, the CMS needs an **always-on server with a persistent
disk/volume**. It will **not** run on Vercel/serverless (no persistent filesystem).

---

## What changed

| Area | Before | Now |
|------|--------|-----|
| Access | localhost only, no login | email/password login (sessions in an HttpOnly cookie) |
| Storage | one shared `site/` folder | one folder per user: `data/users/<id>/site/` |
| Roles | none | `user` and `admin` (admins can list users; see `/api/admin/users`) |
| Database | none | SQLite `data/cms.db` (users, sessions, submissions) |
| Frontend serving | `ng serve` only | the Node server also serves the built app (`CMS_PUBLIC_DIR`) |

First admin is seeded on first boot from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
(default `admin@example.com` / `changeme` — change it).

---

## Run locally (unchanged workflow)

```bash
npm start
```

Dev server on 4200, project server on 4310. Open http://localhost:4200 → you'll be asked to
sign in. Data is written under `./data` (git-ignored). The server now runs with
`node --experimental-sqlite` (handled by the npm scripts).

> If you see `EADDRINUSE` on port 4310, an older project server is still running from a
> previous session — stop it first, then `npm start`.

---

## Environment variables

| Var | Default | Purpose |
|-----|---------|---------|
| `CMS_DATA_DIR` | `./data` | where user folders + `cms.db` are stored (mount a volume here) |
| `CMS_SEED_DIR` | `./site` | template copied into each new user's folder |
| `CMS_PUBLIC_DIR` | `./public` | built Angular app to serve (set in Docker) |
| `CMS_PORT` | `4310` | listen port |
| `CMS_HOST` | `127.0.0.1` | set `0.0.0.0` in a container (behind a proxy) |
| `CMS_ALLOWED_HOSTS` | – | your public domain, e.g. `app.yourdomain.com` |
| `CMS_SECURE_COOKIE` | – | set `1` when served over HTTPS |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | `admin@example.com` / `changeme` | first admin, seeded once |
| `SESSION_SECRET` | – | long random string (reserved for signing) |

---

## Deploy with Docker + Caddy (recommended)

One small server (VPS) runs the CMS and Caddy (automatic HTTPS). Data persists in a volume.

**On the server, one-time:**

1. Install Docker + the compose plugin.
2. Copy `docker-compose.yml`, `Caddyfile`, `.env.example` into `/srv/cms/`.
3. `cp .env.example .env` and fill it in (domain, admin, `openssl rand -hex 32` for the secret).
4. Edit `Caddyfile` — replace `app.yourdomain.com` with your domain.
5. **DNS:** point your domain at the server:
   - subdomain (`app.yourdomain.com`) → **CNAME** or **A record** to the server's IP
   - apex (`yourdomain.com`) → **A record** to the server's IP
6. Start it:

```bash
docker compose up -d --build
```

Caddy fetches an HTTPS certificate once DNS resolves. Visit `https://app.yourdomain.com`
and sign in as the admin.

**Upgrades:** `docker compose up -d --build` (or pull a new image). The `cms-data` volume —
user sites + `cms.db` — is never touched.

---

## Deploy with Jenkins

`Jenkinsfile` builds the image, pushes it to your registry, and restarts the `cms` service
over SSH. The data volume persists across deploys.

Set up in Jenkins:
- Credentials `cms-ssh-key` (SSH key for the deploy host) and `cms-registry` (registry login).
- Edit `REGISTRY`, `DEPLOY_HOST`, `DEPLOY_DIR` at the top of the `Jenkinsfile`.
- The server's `/srv/cms/` must already have `docker-compose.yml`, `Caddyfile` and `.env`
  (the one-time steps above).

Each build: `docker build → push → ssh → docker compose pull cms → up -d`.
Roll back by deploying an earlier image tag.

---

## Managed platforms (Render / Railway / Fly.io)

Alternative to a VPS — deploy the Docker image and **attach a persistent disk mounted at
`/data`**. Set the env vars above (`CMS_ALLOWED_HOSTS` = the platform URL, `CMS_SECURE_COOKIE=1`).
These platforms terminate HTTPS for you, so you don't need Caddy.

---

## Still to build (noted, not done here)

- **Per-user scoping of Developer Mode** already applies (each user's file tree is their own
  folder), but there is no admin UI yet to browse another user's files.
- **Public/anonymous viewing of published sites** (visitors with no login) belongs to a
  separate static-hosting layer — today viewing a site still goes through the authenticated
  app. See the earlier discussion about serving `dist/<site>/` per domain.
- **Form submissions** have a backend now (`POST /api/submit`, `GET /api/submissions`), but
  the admin Submissions screen still reads the old browser store; wiring it to the API is
  the next step.
- **Shared vs per-user components/templates**: currently each user gets their own copy of the
  component/template library (seeded). Making those admin-managed-and-shared is a later change.
