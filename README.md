# ThunderMix — Terminal Portal

A hacker-themed, real-time communication portal. Visitors identify themselves (name + email),
get a terminal, and send messages. Human operators read and answer them live from a private
dashboard. Replies appear in the visitor's terminal as `[ INCOMING TRANSMISSION ]` blocks, with
no operator identity. There is no AI in the loop.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind CSS 4 · Neon Postgres (`pg`) ·
Server-Sent Events · Vercel. No other external services.

---

## Contents

1. [Architecture](#architecture)
2. [Security model](#security-model)
3. [Local development](#local-development)
4. [Neon setup](#neon-setup)
5. [Admin accounts](#admin-accounts)
6. [Deploy to Vercel](#deploy-to-vercel)
7. [Security checklist](#security-checklist)
8. [Realtime & free-tier notes](#realtime--free-tier-notes)
9. [Testing](#testing)
10. [Known limitations](#known-limitations)
11. [Project structure & deviations from the brief](#project-structure--deviations-from-the-brief)

---

## Architecture

```
Browser (visitor)                Next.js on Vercel                      Neon Postgres
─────────────────                ─────────────────                      ─────────────
 /  entry + boot   ── POST ──▶  /api/visitor/register  ─┐
 /terminal         ── POST ──▶  /api/visitor/messages   ├─ BEGIN
                   ◀── SSE ───  /api/visitor/stream     │  set_config(tp.visitor_token)
                                                        │  SET LOCAL ROLE tp_app   ──▶  RLS + SECURITY DEFINER
Browser (operator)                                      │  <query / function>          functions (validation,
 /admin/*          ── GET/POST ▶ /api/admin/*           │  COMMIT                      rate limits, ownership)
                   ◀── SSE ───  /api/admin/stream      ─┘
```

- **Writes** go through route handlers into PL/pgSQL functions (`visitor_send_message`,
  `admin_send_reply`, …). The functions validate input and enforce ownership, blocked status,
  rate limits and idempotency inside the database.
- **Reads** are plain SQL run as the restricted `tp_app` role, so Row Level Security decides
  which rows each caller can see.
- **Realtime** uses Server-Sent Events. Each open stream polls Postgres every 2 s for rows
  whose `updated_at` moved past a cursor, then pushes them to the browser. Streams rotate every
  ~50 s, and `EventSource` resumes via `Last-Event-ID`, so nothing is missed. See
  [Realtime & free-tier notes](#realtime--free-tier-notes).

### Data model (`db/migrations/`)

| Table | Purpose |
|---|---|
| `users` | One row per **normalized** email (trimmed, lower-cased, `UNIQUE`). Status `active`/`blocked`. |
| `visitor_access` | One row per browser identity: SHA-256 hash of the visitor cookie token → `user_id`. |
| `sessions` | `SESS_XXXXXX` code, owner `visitor_access_id`, status `active`/`closed`, trigger-maintained `message_count` / `unanswered_count`, `visitor_hidden_at` (the visitor deleted it from their history; kept, closed and flagged for operators). |
| `messages` | `sender_type` user/admin/system, `delivery_status` sent/delivered/read, `client_msg_id` idempotency key. |
| `admin_profiles` | Operator accounts: bcrypt password hash (pgcrypto), role `admin`/`super_admin`, lockout counters. |
| `admin_sessions` | SHA-256 hashes of operator session tokens with expiry. |
| `admin_reply_log` | Which operator wrote which reply. Admin-only, never exposed to visitors. |
| `app_config` | Single row: message length limit (2000), messages/minute (10), sessions/hour (20). Editable in **/admin/settings**. |

---

## Security model

**Visitor access (email is *not* identity).** Email is not verified, so it never grants access.
On first registration the server creates a random 256-bit token and stores it in an
**httpOnly, SameSite=Lax, Secure** cookie (`__Host-tp_visitor` in production). Only its SHA-256
hash is stored, in `visitor_access`. Each session is owned by that browser identity. If someone
types another person's email in a different browser, they reuse the same `users` row (no
duplicates), but they get their own `visitor_access` and see **only sessions created in their own
browser**. "Exit" revokes the token.

**Database-enforced authorization.** Each request runs in a transaction that:

1. places the caller's raw cookie tokens in transaction-local settings (`tp.visitor_token`,
   `tp.admin_token`),
2. runs `SET LOCAL ROLE tp_app`, a role without table ownership and with minimal grants,
3. runs its queries. RLS policies and functions hash the tokens and look them up, so **Postgres
   itself verifies who the caller is**.

Visitors have no `INSERT`/`UPDATE`/`DELETE` privilege on any table. `visitor_access` and
`admin_sessions` cannot be read by the runtime role at all.

**Admins.** Accounts exist only if created with the CLI; there is no sign-up endpoint. Passwords
are bcrypt hashes (cost 12) verified inside Postgres. Five failures lock the account for 15
minutes, and email enumeration is mitigated. Sessions use httpOnly cookies and expire after 12 h.
Admin routes are checked three times: the proxy (cookie present), the layout/route (token
validated by the DB), and RLS on every query.

**Other controls.**
- Every mutating route requires a same-origin `Origin` header plus a JSON body (CSRF).
- All input is validated with zod in the API layer and again in SQL.
- Everything is rendered as React text nodes, never `dangerouslySetInnerHTML`, so markup is
  shown literally (XSS is tested).
- All SQL is parameterized.
- Headers: a strict CSP (`connect-src 'self'`), `frame-ancestors 'none'`, HSTS and nosniff.
- Raw database errors are never returned. Only mapped, safe messages (`TP:<code>`) are.
- User text is never executed. `/help`, `/new`, `/sessions` and `/clear` are client-side UI
  commands only.

### Security hardening (recommended for production)

By default the app can connect as the database **owner** and switch to `tp_app` per
transaction. Parameterized queries prevent SQL injection, but as defense in depth you should make
the runtime connection **be** `tp_app`:

```bash
npm run db:app-role        # sets a random password on tp_app and prints a pooled DATABASE_URL
```

Use the printed URL as `DATABASE_URL` on Vercel. After that, the runtime credentials cannot
bypass RLS even if something goes wrong: `RESET ROLE` stays restricted, which the integration
suite tests. Keep the owner URL only in `DATABASE_URL_UNPOOLED`, on your machine, for migrations
and the admin CLI. Re-running the command rotates the password.

---

## Local development

Requirements: Node ≥ 20.9 (22 recommended). Docker is optional, needed only for the integration
tests.

```bash
npm install
cp env.example .env.local            # then fill in your Neon URLs
npm run db:migrate                   # applies db/migrations/*.sql (idempotent)
npm run admin:create -- --email you@example.com --password 'a-long-password' --name "Operator"
npm run dev                          # http://localhost:3000
```

- Visitor portal: <http://localhost:3000>
- Operator console: <http://localhost:3000/admin/login>

To develop fully offline against a local Postgres instead of Neon:

```bash
npm run db:test:start                               # Postgres 18 in Docker on port 54329
docker exec tp-postgres-test psql -U postgres -c "create database terminal_portal_dev"
export DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54329/terminal_portal_dev
DATABASE_URL_UNPOOLED=$DATABASE_URL npm run db:migrate
DATABASE_URL_UNPOOLED=$DATABASE_URL npm run admin:create -- --email admin@local.test --password 'LocalAdmin#2026'
npm run dev                                         # process env overrides .env.local
```

## Neon setup

1. Create a project at <https://console.neon.tech> (the free plan is enough to start).
2. In **Connect**, copy both connection strings:
   - **Pooled** (host contains `-pooler`) → `DATABASE_URL`
   - **Direct** → `DATABASE_URL_UNPOOLED`
3. `npm run db:migrate`. This enables `pgcrypto`, creates the `tp_app` role, tables, RLS
   policies and functions.
4. (Recommended) `npm run db:app-role`, then use its output as the runtime `DATABASE_URL`.

## Admin accounts

```bash
# create, or reset the password of, an administrator
npm run admin:create -- --email ops@example.com --password '<min 10 chars>' --name "Night shift" --role admin
# rename / change role without touching the password
npm run admin:create -- --email ops@example.com --name "Lead" --role super_admin
```

Several administrators are supported. Each reply is attributed internally in `admin_reply_log`,
and visitors never see who replied.

---

## Deploy to Vercel

1. Push the repository to GitHub.
2. In Vercel: **Add New → Project →** import the repo. The framework is detected as Next.js; keep
   the defaults.
3. **Environment variables** (Production, and Preview if you use it):
   - `DATABASE_URL`: the Neon **pooled** URL. Preferably the `tp_app` URL from
     `npm run db:app-role`.
   - Do **not** add `DATABASE_URL_UNPOOLED` (the owner URL). The deployed app doesn't need it.
4. Run migrations from your machine against Neon before or after the first deploy:
   `npm run db:migrate`.
5. Create your first admin with `npm run admin:create -- …` (see above).
6. Deploy. The SSE routes set `maxDuration = 60`, which fits Vercel Hobby. Streams close at ~50 s
   and the browser reconnects.
7. Optional: pick a Vercel function region close to your Neon region (e.g. `iad1` for
   `us-east-1`) under **Settings → Functions**.

## Security checklist

- [ ] `.env.local` is gitignored and never committed. Rotate any credential that was ever
      pasted into chat, email or tickets (**Neon console → Roles → Reset password**).
- [ ] Vercel `DATABASE_URL` uses the restricted `tp_app` login (`npm run db:app-role`), not the
      owner.
- [ ] The owner/unpooled URL exists only on trusted machines (migrations/admin CLI).
- [ ] Every admin has a unique, strong password (≥ 10 chars; longer is better).
- [ ] Production is served over HTTPS only (Vercel default). Cookies become `__Host-` + `Secure`.
- [ ] `npm run test:integration` passes against a local Postgres before schema changes ship.
- [ ] Neon: enable IP Allow (paid) if available to you, or keep credentials tightly held.
- [ ] Review `app_config` limits in **/admin/settings** for your expected traffic.

---

## Realtime & free-tier notes

- **How it works:** Neon has no push channel usable from serverless functions, so each open SSE
  stream runs a small indexed query every **2 s** (`updated_at > cursor`, with a 4 s overlap
  window and server-side de-duplication). The client merges by message id, so reconnects never
  duplicate output. The visitor stream closes after the tab has been hidden for 60 s (5 min for
  the operator console) and catches up when the tab becomes visible again.
- **Latency:** typically under 2–3 s end to end.
- **Neon compute:** polling keeps the Neon compute awake while at least one tab is open, so it
  won't auto-suspend during those periods. On the free plan this consumes compute hours. Hidden
  tabs disconnect to limit this, but a portal with visitors around the clock can exhaust free
  compute. Monitor usage in the Neon console.
- **Vercel:** each open stream is one long-running function invocation (≤ 60 s, then it
  reconnects). This counts toward Hobby function-duration limits. Fine for testing and
  moderate traffic; watch usage as it grows.
- Neither service is unlimited. Check current plan limits before launch.

---

## Testing

| Suite | Command | What it covers |
|---|---|---|
| Unit (13 tests) | `npm test` | validation & normalization, error mapping (no leaks), timeline merge/dedupe/order, rate limiter, formatting |
| Integration (35 tests) | `npm run db:test:start` then `npm run test:integration` | Runs against real Postgres 18: registration & email reuse, no duplicate users, token hashing, RLS isolation (anonymous, forged tokens, same email in another browser), no direct writes, `RESET ROLE` escape blocked for `tp_app`, admin-only functions, admin login lockout & expiry, bcrypt storage, idempotency, duplicate/empty/over-length messages, per-user rate limit across sessions, blocked users, closed sessions, session-creation limit, visitor session deletion (hidden for the visitor, kept for operators), read receipts, cascade delete, stats from real data, config permissions |
| Static | `npm run lint` · `npm run typecheck` · `npm run build` | all clean |

**Browser end-to-end (manual, Playwright), all passing:**
- Landing: boot sequence, validation errors, privacy acknowledgement, email normalization.
- Terminal: send (XSS payload rendered inert), "Message received / Awaiting response", operator
  reply arriving live as a multiline incoming transmission.
- Operator: sees visitor messages live, READ receipt, unanswered badge.
- Rate limit message with retry time, ↑ recalls the failed message, page-refresh recovery.
- `/new` with multiple sessions, and the "new transmission" indicator on an inactive session.
- Close session (visitor input disabled), block/unblock (live restriction, plus a server 403).
- Offline → online reconnection recovering a missed reply without duplicates.
- Mobile layout and drawer, admin overview with real figures, user delete with typed
  confirmation (the visitor's terminal then reports access terminated).

The integration suite drops and recreates the schema in its database, and it refuses to run
against `*.neon.tech`.

---

## Known limitations

- **Realtime is polling-based SSE**, not true push: roughly 2 s latency, with the compute and
  duration costs described above. For push-based realtime, a later version could add a small
  always-on worker (Postgres `LISTEN/NOTIFY` → WebSocket) or a hosted realtime service.
- **History is per browser.** Clearing cookies, using another device or pressing *Exit* starts a
  new, empty history (by design, because email is unverified). Operators still see everything.
- **IP rate limiting** in the API layer is in-memory, so it is per server instance on Vercel. The
  authoritative per-user limits live in Postgres and are global.
- **Deletion is permanent** (with typed confirmation). There is no soft delete or undo.
- **Operators are managed from the CLI**; there is no in-app user management for admins.
- No email notifications to operators. They need the dashboard open.
- CSP allows `'unsafe-inline'` scripts (required by Next.js without a nonce setup).

---

## Project structure & deviations from the brief

```
app/
  page.tsx                     entry / boot sequence
  terminal/page.tsx            visitor terminal
  admin/login/page.tsx
  admin/(dashboard)/…          overview, users, users/[id], sessions, sessions/[id], settings
  api/visitor/*                register, sessions, sessions/[id]/messages, messages, ack, logout, stream
  api/admin/*                  login, logout, stats, users, sessions, reply, read, settings, profile, stream
components/terminal|admin|ui/
hooks/                         use-terminal-session, use-event-stream, use-api, use-query-params, …
lib/db/                        pool (withDb: role + token context), queries
lib/auth|validation|rate-limit|realtime|terminal/
db/migrations/                 SQL migrations (applied by scripts/migrate.mjs)
scripts/                       migrate, create-admin, create-app-role
tests/unit|integration/
proxy.ts                       Next 16 "proxy" (formerly middleware): cookie gate for /admin & /terminal
```

**Deviations (and why):**
- **Neon instead of Supabase** (at the owner's request). That required replacing Supabase Auth
  and Realtime:
  - httpOnly cookie tokens instead of Supabase anonymous auth.
  - Database-verified admin sessions (bcrypt via pgcrypto) instead of Supabase Auth.
  - SSE polling instead of Supabase Realtime.
  - Role switching + transaction-local token settings instead of `auth.uid()` in RLS.
  - Migrations live in `db/migrations`.
- Added `/admin/users/[id]` (user details and sessions) and `/api/admin/stream`.
- `hooks/use-realtime-messages.ts` became `use-event-stream.ts` (generic SSE client) plus
  realtime handling inside `use-terminal-session.ts` and `components/admin/admin-realtime.tsx`.
