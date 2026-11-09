# TapIn

Multi-school NFC attendance. Students and staff tap an ID card at the school gate; guardians get an SMS.
_Every child, safe and accounted for._

Stack: Next.js 16 (App Router, TypeScript strict), Tailwind CSS v4 + shadcn/ui, Supabase (Postgres, Auth, Storage, pg_cron), Termii SMS, Vercel.

## Status

| Stage | What | State |
| --- | --- | --- |
| 1 | Foundation: project, database, RLS, login, roles | ✅ built |
| 2 | Admin dashboard: classes, students, guardians, staff, photos, import, cards, devices | — |
| 3 | Kiosk: Web NFC, photo, voice greeting, `/api/tap`, offline queue | — |
| 4 | Alerts: Termii, `sms_logs`, retries, absence job, calendar | — |
| 5 | Reports and launch | — |

## Set up

1. `npm install`
2. Create a Supabase project. Copy `.env.example` to `.env.local` and fill in the URL, anon key and service role key
   (Supabase → Project Settings → API).
3. Apply the database schema — either:
   - **CLI:** `npx supabase link --project-ref <ref>` then `npx supabase db push`, or
   - **Dashboard:** paste `supabase/migrations/20261109000001_foundation.sql` into the SQL editor and run it.
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
| `npm run test:rls` | RLS integration test against the Supabase project in `.env.local`. Creates and deletes throwaway schools and users — **use a dev project, never production.** |

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

## Deploy (Vercel)

Import the GitHub repo in Vercel, add the same variables as `.env.local` (all except `RUN_RLS_TESTS`), deploy.
In Supabase → Authentication → URL configuration, set the Site URL to your Vercel URL.
