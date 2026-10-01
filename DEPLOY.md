# Deploying the CMS

The CMS is two parts that must run **together** on the server:

1. the **app**: the Angular build (`npm run build` → `dist/cms/browser/`), and
2. the **project server**: `server/index.mjs`, which reads and writes your websites in `site/`.

Uploading only the built app to a static host gives *"Can't reach the project server"*. That's because the app has nothing to save to.

In production mode one Node process does everything:

| URL | What it serves |
| --- | --- |
| `/admin` | the CMS (requires the admin password) |
| `/api/…` | the project server API (requires sign-in) |
| `/<website>/…` | your **published** websites, from the static build in `site/dist/` |

## Requirements

- Node.js 20 or newer on the server. This rules out static-only hosts such as Netlify, Vercel or GitHub Pages; they can host only the `site/dist/` output, not the CMS.
- A **persistent disk** for the `site/` folder. All your websites, pages and uploads are files in it, so it must survive restarts and redeploys.
- HTTPS in front of the CMS (a reverse proxy or your platform's TLS). The sign-in cookie should not travel over plain HTTP.

## Steps

```bash
npm ci
npm run build
CMS_ADMIN_PASSWORD='choose-a-long-password' npm run serve:prod
```

On Windows (PowerShell):

```powershell
npm ci
npm run build
$env:CMS_ADMIN_PASSWORD = 'choose-a-long-password'
npm run serve:prod
```

Then open `http://<server>:8080/admin` and sign in.

**Copy your content.** Upload the project's `site/` folder (with `site/dist/`) to the server. If `site/dist/` is missing, sign in once and use **Developer mode → Build site**, or save any change. Until then, published websites aren't visible to visitors. The server prints a warning at startup for each published website without a build.

## Settings (environment variables)

| Variable | Default | Meaning |
| --- | --- | --- |
| `CMS_ADMIN_PASSWORD` | – (required) | Admin password, at least 8 characters |
| `PORT` / `CMS_PORT` | `8080` | Port to listen on (`PORT` is what most platforms set) |
| `CMS_HOST` | `0.0.0.0` | Address to listen on (`127.0.0.1` when behind a proxy on the same machine) |
| `CMS_ALLOWED_HOSTS` | any | Comma-separated domain names to serve, e.g. `cms.example.com` |
| `CMS_SITE_DIR` | `./site` | The content folder |
| `CMS_APP_DIR` | `./dist/cms/browser` | The built app |
| `CMS_SESSION_HOURS` | `12` | How long a sign-in lasts |
| `NODE_ENV=production` | – | Same as passing `--prod` |

**Security in production mode:**
- Everything except the published websites requires the password.
- Sign-in cookies are HttpOnly and SameSite=Strict, and Secure over HTTPS.
- After 8 wrong passwords, sign-in from that address is blocked for 10 minutes.
- "Open in VS Code" is turned off.

Sessions are kept in memory, so restarting the server signs everyone out.

## Keep it running

**PM2** (Linux or Windows):

```bash
npm install -g pm2
CMS_ADMIN_PASSWORD='…' pm2 start server/index.mjs --name cms -- --prod
pm2 save && pm2 startup
```

**systemd** (`/etc/systemd/system/cms.service`):

```ini
[Service]
WorkingDirectory=/srv/cms
ExecStart=/usr/bin/node server/index.mjs --prod
Environment=CMS_ADMIN_PASSWORD=choose-a-long-password
Environment=CMS_HOST=127.0.0.1
Restart=always

[Install]
WantedBy=multi-user.target
```

**Docker**: see `Dockerfile`. Mount `site/` as a volume so content survives new images:

```bash
docker build -t cms .
docker run -d -p 8080:8080 -e CMS_ADMIN_PASSWORD='…' -v /srv/cms-site:/app/site --name cms cms
```

## Behind a reverse proxy

The editor gets live updates over Server-Sent Events (`/api/events`). Proxies must not buffer that stream.

**nginx:**

```nginx
server {
  server_name cms.example.com;
  client_max_body_size 30m;            # image uploads

  location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
  location /api/events {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
    proxy_read_timeout 1h;
  }
}
```

**IIS (Windows Server):**
1. Install *URL Rewrite* and *Application Request Routing*, and enable the proxy in ARR.
2. Add a rewrite rule that sends everything to `http://localhost:8080/{R:1}`.
3. Set *Response buffer threshold* to 0 for the site, so `/api/events` streams.
4. Run the Node process with PM2 or as a Windows service (e.g. with NSSM).

## Publishing only the websites somewhere else

Visitors only need `site/dist/`: plain HTML, CSS and JS, with relative links between pages. You can still upload that folder to any static host, and keep the CMS itself on a private server or your own computer.
