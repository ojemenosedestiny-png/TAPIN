# TapIn recovery guide

What to do when something goes wrong. Commands are for the VS Code terminal (PowerShell), run in the TapIn folder.

## What is protected, and where

| What | Where it is kept | How far back |
|---|---|---|
| Code | GitHub (`main`), plus tagged safe points (`recovery-YYYY-MM-DD`) | All history |
| Live website | Vercel keeps every deployment | All deployments |
| Database | Nightly backup at 01:30 UTC into the private `backups` bucket in Supabase, plus Supabase's own backups (depends on your Supabase plan) | 14 nights |
| Photos and logos | Supabase Storage buckets (not in the nightly backup) | Stay in place |
| Keys and passwords | Vercel → Settings → Environment Variables, and `.env.local` on this computer | Keep a copy in a password manager |

## 1. A new version broke the website

1. Open **vercel.com → TapIn → Deployments**.
2. Find the last deployment that worked (it says **Ready**, from before the problem).
3. Click **⋯ → Promote to Production** (or **Instant Rollback**). The old version is live within seconds.
4. Then tell the developer which change broke it.

## 2. Go back to a known-good version of the code

```powershell
git fetch --tags
git tag --list "recovery-*"
git checkout recovery-2026-11-12        # look at it, or build it
git switch main                          # come back
```
To make that version live again, roll back on Vercel (section 1) rather than rewriting history.

## 3. Data was deleted or damaged

**First: stop.** Don't try to fix it by hand. Note the time it happened.

See the backups and check one:
```powershell
node --env-file=.env.local scripts/backup.mjs list
node --env-file=.env.local scripts/backup.mjs check 2026-11-12
```

Download one to this computer (keep it private: it holds children's and parents' details):
```powershell
node --env-file=.env.local scripts/backup.mjs download 2026-11-12 C:\TapIn-backups\2026-11-12
```

Restore. The script only restores into an **empty** Supabase project, never over live data:
1. Create a new Supabase project. Apply the migrations to it (`npx supabase db push --db-url <new project's database URL> --yes`).
2. Make an env file for the new project (copy `.env.local` to `.env.restore` and change the Supabase URL and keys).
3. Run `node --env-file=.env.restore scripts/backup.mjs restore C:\TapIn-backups\2026-11-12`
4. Point Vercel at the new project (change the Supabase variables, redeploy).
5. Everyone signs in with **Forgot password?** (passwords are never in backups).
6. Paste the school portal key again in **Settings → School portal** (it is kept out of backups on purpose).

If only a few rows are missing, it is often easier to restore into the new project and copy those rows back. Ask the developer.

## 4. A kiosk phone or tablet was lost or stolen

**Devices → Revoke** next to that kiosk. Its taps are refused at once. Register a new kiosk for the replacement.

## 5. A key or password leaked

Change it at its source, put the new one in Vercel, then **Redeploy**:

| Key | Where to change it |
|---|---|
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Project Settings → API (rotate) |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET` | Meta developers → your app |
| `WHATSAPP_INBOUND_SECRET` | Make a new one; update the webhook address in Meta too |
| `TERMII_API_KEY` | Termii dashboard |
| Flutterwave keys | Flutterwave dashboard |
| `CRON_SECRET` | Make a new one; update the `tapin_cron_secret` vault secret in Supabase too |
| School portal key | Portal → Card tap-in → **New key**, then paste it in TapIn **Settings → School portal** |

## 6. Once a month

1. Download the newest backup (section 3) to an external drive or a private cloud folder.
2. Check that **Settings** doesn't show a backup warning, and that `backup.mjs list` shows last night's date.
3. Create a new safe point: `git tag recovery-YYYY-MM-DD` then `git push origin --tags`.
