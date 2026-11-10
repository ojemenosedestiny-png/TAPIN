# TapIn

Multi-school NFC attendance. Students and staff tap an ID card at the school gate; guardians get an SMS.
_Every child, safe and accounted for._

Stack: Next.js 16 (App Router, TypeScript strict), Tailwind CSS v4 + shadcn/ui, Supabase (Postgres, Auth, Storage, pg_cron), Termii SMS, Vercel.

## Status

| Stage | What | State |
| --- | --- | --- |
| 1 | Foundation: project, database, RLS, login, roles | ✅ built |
| 2 | Admin dashboard: classes, students, guardians, staff, photos, import, cards, devices | ✅ built |
| 3 | Kiosk: Web NFC, photo, voice greeting, `/api/tap`, offline queue | ✅ built |
| 4 | Alerts: Termii, `sms_logs`, retries, absence job, calendar | ✅ built |
| 5 | Reports and launch: Today dashboard, class view, reports + Excel/PDF, help and launch guides | ✅ built |

## Run locally (Docker)

1. `npm install` and start Docker Desktop.
2. `npx supabase start` — runs Postgres, Auth and Storage locally and applies every migration. It prints the API URL, anon key and service role key.
3. Put those in `.env.local` (see `.env.example`).
4. `node --env-file=.env.local scripts/create-super-admin.mjs you@example.com "Your Name"`, then `npm run dev`.

Web NFC needs Chrome on Android over HTTPS, so on a laptop use the USB-reader / type-the-number box to enrol cards.

## Set up (hosted Supabase)

1. `npm install`
2. Create a Supabase project. Copy `.env.example` to `.env.local` and fill in the URL, anon key and service role key
   (Supabase → Project Settings → API).
3. Apply the database schema — either:
   - **CLI:** `npx supabase link --project-ref <ref>` then `npx supabase db push`, or
   - **Dashboard:** run each file in `supabase/migrations/` in the SQL editor, oldest first.
4. Create your super admin login:
   `node --env-file=.env.local scripts/create-super-admin.mjs you@example.com "Your Name"`
5. `npm run dev`, open http://localhost:3000, sign in, create a school and its school admin under **Schools**.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server |
| `npm run build` | Production build (also type-checks) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript only |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | Browser tests (Playwright, uses your installed Chrome) for the kiosk and enrollment screens, on a production build at port 3100. Seeds and removes a throwaway school. |
| `npm run test:rls` | Integration tests (RLS, taps, alerts, reports, retention, two-factor, backup) against the Supabase project in `.env.local`. Creates and deletes throwaway schools and users — **use a dev project, never production.** |

## Roles

| Role | Lands on | Can do |
| --- | --- | --- |
| `super_admin` | `/platform` | Create schools and staff accounts, see platform health. **No access to student records** (enforced by RLS, not just the UI). |
| `school_admin` | `/today` | Everything inside their own school. |
| `teacher` | `/today` | Attendance and students in classes where they are class teacher. |

## Security notes

- Every tenant table has `school_id` and Row Level Security. Policies live in `supabase/migrations/`.
- The service role key is only read in `lib/supabase/admin.ts` (server only). Taps, SMS, device creation and staff
  account creation go through the server.
- Device token hashes are hidden from logged-in users with column privileges.
- Sessions end after 30 minutes of inactivity (`proxy.ts`). Login is rate limited.
- Sensitive actions write to `audit_logs`.
- Student photos go in the private `photos` bucket under `<school_id>/…`.
- Two-factor login for admins: turn on TOTP MFA in Supabase → Authentication → Multi-factor (enrolment UI comes in a later stage).

## SMS alerts (Stage 4)

- Every message is written to `sms_logs` first (status `queued`), then sent through Termii. A unique key
  (student + date + type + guardian) means a second arrival SMS for the same child on the same day is never created.
- Failures retry 3 times, 2 minutes apart, then show as **Failed** on the Alerts page (with a Retry button).
- Quiet hours hold messages; the monthly allowance stops sending with a dashboard warning; arrival/departure
  news older than 6 hours is dropped instead of sent late.
- **Absence job:** `queue_absence_alerts()` runs in Supabase every 15 minutes (pg_cron). After each school's cutoff,
  on weekdays that aren't holidays, it queues one alert per guardian for active students with no sign-in and no excusal.
  The same job flags kiosks offline for 10+ minutes and queues daily summaries for schools that use them.
- **Sending on a schedule:** Supabase calls `GET /api/cron/send` every 2 minutes (pg_net), with the app URL and
  `CRON_SECRET` kept in Supabase Vault. To point it at a new URL or secret:
  `select public.setup_sms_sender('https://your-app.vercel.app', '<CRON_SECRET>');` (run as service role / SQL editor).
- **Termii:** set `TERMII_API_KEY`, `TERMII_SENDER_ID` (approved sender ID), `TERMII_BASE_URL` (from your Termii
  dashboard) and `TERMII_CHANNEL`. Use `dnd` (transactional) so messages reach numbers on Do Not Disturb — ask Termii
  support to enable it on your account. Without a key, messages stay queued and nothing is sent.

## Privacy, two-factor and backups

- **Consent:** record each parent's written consent on the student profile (or "Yes" in the Consent Received import
  column). Photos can't be added without it, on screen or on the server. Withdrawing consent deletes the photo at once.
  Printable form: Help → consent form (`/help/consent-form`). Public notice: `/privacy`.
- **Retention (NDPA 2023):** when a student leaves (Withdrawn, Graduated, Inactive), everything about them is deleted
  after the school's period (Settings → Privacy and data; 12 months by default) by `/api/cron/retention`, nightly.
- **Two-factor login:** Account → Turn on two-factor login (any authenticator app). Enforced in the database: once a
  person has two-factor on, a password-only session gets no rows from any table until the code is entered.
- **Backups:** `/api/cron/backup` runs nightly (01:30 UTC): every table as gzip'd NDJSON in the private `backups`
  bucket, newest 14 kept. `node --env-file=.env.local scripts/backup.mjs list | check <day> | download <day> <dir>`.
  `restore <dir>` only works into an **empty** project with the migrations applied; logins come back without
  passwords (everyone uses Forgot password), and photos are not in the backup. For point-in-time recovery and photo
  backups, use Supabase Pro.

## Parent portal and WhatsApp

- **Parents** go to `/parent`, enter the mobile number the school has for them, and sign in with a 6-digit code.
  Only numbers registered as a guardian get a code. They see only their own children (enforced in the database).
- **Turn it on (Supabase dashboard):**
  1. Authentication → Sign In / Providers → **Phone**: enable.
  2. Authentication → **Hooks** → Send SMS hook → HTTPS → `https://<your-app>/api/auth/sms-hook`. Copy the generated
     secret into `SEND_SMS_HOOK_SECRET` (Vercel and `.env.local`). Codes are then sent through Termii.
  3. To try it before the Termii sender ID is approved: Authentication → Phone → **Test phone numbers and OTPs**
     (e.g. `2348031234567=123456`) and add that number as a guardian.
- **WhatsApp works without an SMS sender ID.** Until the sender ID is approved, every alert and sign-in code goes
  by WhatsApp. Once SMS is set up, each guardian chooses (school admin on the student profile, or the parent in
  the portal), and a refused WhatsApp falls back to SMS.
- **Set up WhatsApp (Termii dashboard):** connect a WhatsApp Business number (Manage Device), then create one
  template per alert. Use these texts; `{{1}}`–`{{4}}` are filled in by TapIn:

  | Alert | Category | Template text | Vercel setting |
  | --- | --- | --- | --- |
  | Arrival | Utility | `{{1}} arrived at {{2}} at {{3}}.` | `TERMII_WA_TEMPLATE_ARRIVAL` |
  | Late | Utility | `{{1}} arrived late at {{2}} at {{3}}.` | `TERMII_WA_TEMPLATE_LATE` |
  | Departure | Utility | `{{1}} left {{2}} at {{3}}.` | `TERMII_WA_TEMPLATE_DEPARTURE` |
  | Absence | Utility | `{{1}} has not signed in at {{2}} today, {{3}}. Please contact the school if anything is wrong.` | `TERMII_WA_TEMPLATE_ABSENCE` |
  | Early release | Utility | `{{1}} was released early from {{2}} at {{3}}. Reason: {{4}}.` | `TERMII_WA_TEMPLATE_EARLY` |
  | Daily summary | Utility | `{{1}} at {{2}} today: {{3}}.` | `TERMII_WA_TEMPLATE_SUMMARY` |
  | Sign-in code | Authentication | `Your TapIn sign-in code is {{1}}. It expires in 5 minutes. Never share it.` | `TERMII_WA_TEMPLATE_OTP` |

  Then add `TERMII_WHATSAPP_DEVICE_ID` and each approved template id in Vercel and redeploy. Alerts → **Send a test
  alert** → WhatsApp checks each one.

## Activity log, staff report and offline kiosk

- **Activity log** (`/activity`): who did what and when (cards, students, settings, logins, billing), in plain
  English. School admins see their own school; the super admin sees every school but not student details.
- **Staff report:** a Staff tab on Reports (school admins only) with days present, late arrivals, early leaves,
  usual arrival time and average hours on site, plus an Excel export.
- **Kiosk with no internet:** after one online visit, the kiosk page opens even with no connection (service worker
  in `public/sw.js`, scoped to `/kiosk`). Taps queue on the device and sync when the internet returns.

## Kiosk voice, test alerts and appearance

- **Voice:** set `ELEVENLABS_API_KEY` (and optionally `ELEVENLABS_VOICE_ID`) and the kiosk greets children in that
  voice. Each phrase is made once by ElevenLabs, stored in the private `voice` bucket and cached on the kiosk, so a
  child's greeting costs one request ever, then plays instantly (also offline). If a clip is not ready within
  1.5 s, the device voice says the same words. Only first names are sent.
- **Alerts → Test sounds and alerts:** play every gate sound in the school voice, and send a test SMS with the real
  wording (marked TEST). Without Termii connected it shows the exact preview instead.
- **Appearance:** Light, Dark or Auto (follows the device), in the sidebar and on the sign-in page. The kiosk keeps its
  own colours, and printing is always light.
- **Kiosk result screen:** full portrait, name, class, admission number, late badge and time, with a bar that drains
  for 4 seconds before the next child.

## Password resets

- **Forgot password?** on the login page emails a one-time link (Supabase Auth). For the link to work, in Supabase →
  Authentication → URL Configuration set **Site URL** to your live address and add these **Redirect URLs**:
  `https://<your-app>.vercel.app/auth/callback` and `http://localhost:3000/auth/callback`.
- Supabase's built-in email is rate limited (a few per hour). Before launch, add your own SMTP in Supabase →
  Authentication → Emails.
- Locked-out admin, no email access: `node --env-file=.env.local scripts/reset-password.mjs <email>`.

## Deploy (Vercel)

Import the GitHub repo in Vercel and add these environment variables: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `TERMII_API_KEY`, `TERMII_SENDER_ID`, `TERMII_BASE_URL`, `TERMII_CHANNEL`.
Don't add `SUPABASE_DB_URL` (only needed on your machine to apply migrations) or `RUN_RLS_TESTS`.
In Supabase → Authentication → URL configuration, set the Site URL to your Vercel URL.
