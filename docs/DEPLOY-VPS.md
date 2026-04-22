# Deploy MysticsHR to a CloudPanel VPS

**Target:** `mysticshr.automystics.tech` on `76.13.4.214` (CloudPanel)
**Source repo:** `https://github.com/Karthickdac/MysticsHR.git`

This guide walks through every step to move the entire MysticsHR project — code, database, attachments — from Replit to your CloudPanel VPS.

---

## 0. What you're deploying

MysticsHR is a pnpm monorepo with two services that need to run together:

| Piece | What it is | Where it runs on the VPS |
|---|---|---|
| `@workspace/api-server` | Express API + serves the built React SPA | Node.js process on local port `8080` |
| `@workspace/mysticshr` | React + Vite frontend, pre-built to static files | Served by Express from `dist/public` |
| Postgres | All operational data | CloudPanel Postgres database (or external) |
| Object Storage | Employee attachments / documents | Local disk on the VPS (replaces Replit App Storage) |
| Clerk | Auth (external SaaS) | No change — just whitelist the new domain |

---

## 1. Point DNS at the VPS

In the DNS panel of `automystics.tech`:

```
Type   Name        Value           TTL
A      mysticshr   76.13.4.214     300
```

Wait for propagation (`dig +short mysticshr.automystics.tech` should return `76.13.4.214`).

---

## 2. Create the site in CloudPanel

1. Log in to CloudPanel.
2. **Sites → + Add Site → Create a Node.js Site**
3. Fill in:
   - **Domain Name:** `mysticshr.automystics.tech`
   - **Node.js Version:** `20` or `22` (CloudPanel may not yet offer 24 — `>= 20` works)
   - **App Port:** `8080`
   - **Site User:** accept the default (e.g., `mysticshr`)
   - **Site User Password:** strong password, save it
4. Click **Create**.

CloudPanel now provisions:
- A Linux user (e.g., `mysticshr`)
- A site directory: `/home/mysticshr/htdocs/mysticshr.automystics.tech/`
- An nginx vhost that **reverse-proxies all requests to `127.0.0.1:8080`**

---

## 3. Create the database in CloudPanel

1. **Databases → + Add Database**
2. Fill in:
   - **Site:** select the site you just created
   - **Database Name:** `mysticshr`
   - **Database User Name:** `mysticshr`
   - **Database User Password:** strong password, save it
3. Click **Create**.

Your `DATABASE_URL` will be:

```
postgres://mysticshr:<password>@127.0.0.1:5432/mysticshr
```

---

## 4. Install Node.js prerequisites

SSH into the VPS as **root** (or via CloudPanel terminal):

```bash
ssh root@76.13.4.214
```

Install pnpm globally for the site user:

```bash
su - mysticshr
npm install -g pnpm@10
exit
```

---

## 5. Clone the repo

As the site user (`su - mysticshr`):

```bash
cd ~/htdocs/mysticshr.automystics.tech
# Clean the placeholder content CloudPanel created
rm -rf ./* ./.[!.]*

git clone https://github.com/Karthickdac/MysticsHR.git .
pnpm install --frozen-lockfile
```

---

## 6. Replace Replit App Storage with local disk

The current code talks to Replit's object storage sidecar (won't exist on your VPS). The cleanest fix is to swap that one file for a local-disk implementation. Create the upload directory first:

```bash
mkdir -p ~/htdocs/mysticshr.automystics.tech/uploads
chmod 750 ~/htdocs/mysticshr.automystics.tech/uploads
```

Then in `artifacts/api-server/src/lib/objectStorage.ts`, the only methods that have to keep working are roughly: `upload(buffer, key)`, `getSignedDownloadUrl(key)`, `delete(key)`. Replace the GCS-backed implementation with `fs/promises` reads/writes against `/home/mysticshr/htdocs/mysticshr.automystics.tech/uploads/<key>`. Tell me when you've done step 5 and I will rewrite that file for you and push to GitHub — it's safer than doing it by hand.

If you'd rather keep object storage in the cloud, point the same file at S3 / Cloudflare R2 / Backblaze B2 (all S3-compatible) — same idea, just keep using the AWS SDK instead of `fs`.

---

## 7. Set environment variables

Create `/home/mysticshr/htdocs/mysticshr.automystics.tech/.env` (chmod 600):

```bash
NODE_ENV=production
PORT=8080
APP_URL=https://mysticshr.automystics.tech

DATABASE_URL=postgres://mysticshr:<DB_PASSWORD>@127.0.0.1:5432/mysticshr

# Clerk — copy these from your Replit secrets pane
CLERK_PUBLISHABLE_KEY=pk_test_xxx
CLERK_SECRET_KEY=sk_test_xxx
VITE_CLERK_PUBLISHABLE_KEY=pk_test_xxx

# Local-disk object storage (after step 6)
UPLOAD_DIR=/home/mysticshr/htdocs/mysticshr.automystics.tech/uploads

# Optional — only set if you actually use these
SMTP_HOST=
SMTP_FROM=
WHATSAPP_ACCESS_TOKEN=
WHATSAPP_PHONE_NUMBER_ID=
RELIEVING_LINK_VALIDITY_DAYS=7
ATTACHMENT_CLEANUP_AGE_DAYS=30
LOG_LEVEL=info
```

Then secure it:

```bash
chmod 600 .env
```

---

## 8. Run database schema migrations

```bash
cd ~/htdocs/mysticshr.automystics.tech
pnpm --filter @workspace/db run push
```

This creates every HRMS table on your local Postgres.

---

## 9. Move the data from Replit to the VPS

### 9a. Dump on Replit

In the Replit shell:

```bash
pg_dump --no-owner --no-acl --format=custom \
  "$DATABASE_URL" > /tmp/mysticshr.dump
```

Then download `/tmp/mysticshr.dump` (right-click → Download in the Files pane, or `scp` it out).

### 9b. Restore on the VPS

Upload the dump (e.g. with `scp ./mysticshr.dump mysticshr@76.13.4.214:~/`), then on the VPS:

```bash
pg_restore --no-owner --no-acl --clean --if-exists \
  -d "postgres://mysticshr:<DB_PASSWORD>@127.0.0.1:5432/mysticshr" \
  ~/mysticshr.dump
```

Confirm:

```bash
psql "$DATABASE_URL" -c "SELECT COUNT(*) FROM employees;"
```

### 9c. Move attachments (only if you have any)

Replit's object storage data lives in a Google bucket. Export each existing attachment to your laptop, then `scp` the whole folder into `~/htdocs/.../uploads/` preserving filenames so the keys still match.

If your demo run has no real attachments yet, you can skip this step.

---

## 10. Build the project

```bash
cd ~/htdocs/mysticshr.automystics.tech
pnpm --filter @workspace/mysticshr run build       # builds the React SPA
pnpm --filter @workspace/api-server run build      # builds the Express server
```

Outputs:
- `artifacts/mysticshr/dist/public/` — static SPA
- `artifacts/api-server/dist/index.mjs` — server bundle

---

## 11. Make Express also serve the SPA

In production, the single Node process should serve both `/api/*` (the API) and everything else (the SPA). Open `artifacts/api-server/src/index.ts` — near the bottom, just before `app.listen(...)`, add:

```ts
import path from "node:path";
import express from "express";

if (process.env.NODE_ENV === "production") {
  const spaDir = path.resolve(
    process.cwd(),
    "artifacts/mysticshr/dist/public",
  );
  app.use(express.static(spaDir, { maxAge: "1h", index: false }));
  app.get(/^\/(?!api\/).*/, (_req, res) => {
    res.sendFile(path.join(spaDir, "index.html"));
  });
}
```

Rebuild after the edit (`pnpm --filter @workspace/api-server run build`).

I can make this edit and push to GitHub for you — say the word and I'll do it.

---

## 12. Run the server with PM2

PM2 keeps the process alive and restarts on crash / reboot.

```bash
npm install -g pm2

cd ~/htdocs/mysticshr.automystics.tech
pm2 start "node --enable-source-maps artifacts/api-server/dist/index.mjs" \
  --name mysticshr \
  --update-env

pm2 save
pm2 startup    # run the command it prints, as root
```

Confirm it's running:

```bash
curl -s http://127.0.0.1:8080/api/healthz
# → {"ok":true} or similar
```

---

## 13. Issue a free SSL certificate

In CloudPanel:

**Sites → mysticshr.automystics.tech → SSL/TLS → New Let's Encrypt Certificate → Create.**

CloudPanel will fetch the cert and switch the vhost to HTTPS automatically.

Visit: `https://mysticshr.automystics.tech` — you should see the MysticsHR sign-in page.

---

## 14. Whitelist the domain in Clerk

1. Go to <https://dashboard.clerk.com> → your application.
2. **Configure → Domains → Add Domain** → `mysticshr.automystics.tech`
3. **Configure → Paths** → set the redirect URLs to `https://mysticshr.automystics.tech/*` if you've customised them.
4. If you switched from a Clerk dev instance to a production instance, regenerate the publishable / secret keys and update the `.env` accordingly, then `pm2 restart mysticshr`.

---

## 15. Sign in and verify

1. Visit `https://mysticshr.automystics.tech/sign-in`
2. Sign in as `arjun.sharma@automystics.com` / `DemoTest123!@#`
3. You should land on the Dashboard with all seeded data visible.

If anything 404s or 500s:

```bash
pm2 logs mysticshr --lines 200
tail -200 /home/mysticshr/logs/nginx/access.log
tail -200 /home/mysticshr/logs/nginx/error.log
```

---

## 16. Future deploys

Once everything is wired up, redeploying after a code change is:

```bash
cd ~/htdocs/mysticshr.automystics.tech
git pull
pnpm install --frozen-lockfile
pnpm --filter @workspace/db run push                # if schema changed
pnpm --filter @workspace/mysticshr run build
pnpm --filter @workspace/api-server run build
pm2 restart mysticshr
```

You can wrap that in a `scripts/deploy.sh` if you'd like — say so and I'll add it.

---

## What I can do for you next

Two pieces in this guide need code changes that are easier for me to do in the repo than for you to do by hand:

1. **Step 6** — replace Replit's object storage with local-disk storage (or S3 — your call).
2. **Step 11** — make Express serve the SPA in production.

Just say "**make those code changes**" and I'll do both, push to GitHub, and you can `git pull` on the VPS to pick them up.
