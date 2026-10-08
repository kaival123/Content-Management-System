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
| `EMAIL_PROVIDER` | – | `resend` or `sendgrid` to email owners on form submissions (blank = off) |
| `EMAIL_API_KEY` | – | the provider's API key |
| `EMAIL_FROM` | – | verified sender, e.g. `CMS <no-reply@yourdomain.com>` |

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

`Jenkinsfile` uses a **build-on-server** flow (no container registry needed): Jenkins SSHes
to your server, updates the code, and rebuilds/restarts the Docker stack. The `cms-data`
volume persists across deploys.

One-time on the server:
- `git clone` this repo into `DEPLOY_DIR` (e.g. `/srv/cms`).
- `cp .env.example .env` and fill it in; edit `Caddyfile` with your domain; point DNS at the server.

In Jenkins:
- Add an SSH key credential `cms-ssh-key` that can log into the server.
- Set `DEPLOY_HOST`, `DEPLOY_DIR`, `APP_URL` at the top of the `Jenkinsfile`.

Each build: `ssh → git reset --hard origin/main → docker compose up -d --build → health check`.
The data volume is never touched, so accounts and sites are preserved. Roll back by pointing
`BRANCH` at an earlier commit/tag, or `git reset` on the server.

> **This is a full-stack app, not a static Angular site.** Do not configure the Jenkins/Docker
> job to `ng build` and serve `dist/` with nginx — that has no backend, no database and no disk,
> so `/api` fails. The image must run the Node server (it serves the API *and* the built
> frontend) with the `/data` volume mounted.

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
