# Ecommerce Platform

Full-stack e-commerce monorepo: **Next.js 16 API + 3 Vite/React apps + PostgreSQL**.

| App | Path | Port | Purpose |
|-----|------|------|---------|
| Backend API | `backend/` | 3000 | Next.js App Router API, auth, DB access |
| Admin panel | `frontend/` | 5173 | Admin dashboard (products, orders, users, purchases…) |
| Storefront | `frontend/storepub/` | 5174 | Public customer store |
| Store panel | `frontend/storepanel/` | 5175 | Branch/store staff panel |
| Shared | `shared/` | – | Vite dev proxy config shared by all 3 frontends |

---

## 1. Prerequisites

- **Node.js** 22+
- **npm** 10+
- **PostgreSQL** 14+ (running locally)

```bash
node -v
npm -v
psql --version
pg_isready          # must say "accepting connections"
```

---

## 2. Clone

```bash
git clone https://github.com/palakmogra2109/Ecommerce.git
cd Ecommerce
```

## 3. Install dependencies

Five separate installs (root + 4 workspaces):

```bash
# root (Playwright e2e tests)
npm install

# backend (Next.js API)
cd backend && npm install && cd ..

# admin panel
cd frontend && npm install && cd ..

# customer storefront
cd frontend/storepub && npm install && cd ../..

# store panel
cd frontend/storepanel && npm install && cd ../..
```

---

## 4. Environment configuration

### Root `.env` (committed, dev-only)

```env
BACKEND_URL=http://localhost:3000
```

All three Vite apps read this through `shared/viteProxy.mjs` to proxy `/api` and
`/media` requests. Changing the backend port means editing this one line only.

### `backend/.env.local` (secrets — NOT committed)

```env
DATABASE_URL=postgresql://postgres:password@localhost:5432/ecommerce
JWT_SECRET=<long-random-string>
FRONTEND_URL=http://localhost:5173

SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=<your-gmail>
SMTP_PASSWORD=<gmail-app-password>
SMTP_SECURE=false
SMTP_FROM=<your-gmail>

APP_NAME=Earth धान्य
LOGIN_URL=http://localhost:3000
```

> Generate a JWT secret: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
>
> For Gmail SMTP use an **App Password** (Google Account → Security → 2-Step Verification → App passwords).

---

## 5. Create the database

```bash
PGPASSWORD=password psql -U postgres -h localhost -c "CREATE DATABASE ecommerce;"
```

Adjust user/password to match your `DATABASE_URL`.

## 6. Schema, seed and migrations

Run **only on a fresh database**:

```bash
cd backend

# 1. Bootstrap DDL (~72 tables)
PGPASSWORD=password psql -U postgres -h localhost -d ecommerce -f sql/schema.sql

# 2. Seed data (modules, roles, permissions, sample catalog, email templates)
PGPASSWORD=password psql -U postgres -h localhost -d ecommerce -f sql/seed.sql

# 3. Incremental migrations (tracked in schema_migrations)
npm run migrate
```

For an existing database, only run:

```bash
cd backend && npm run migrate
```

---

## 7. Run the apps

Open **4 terminals**:

```bash
# Terminal 1 — API
cd backend && npm run dev          # http://localhost:3000

# Terminal 2 — Admin panel
cd frontend && npm run dev         # http://localhost:5173

# Terminal 3 — Storefront
cd frontend/storepub && npm run dev   # http://localhost:5174

# Terminal 4 — Store panel
cd frontend/storepanel && npm run dev # http://localhost:5175
```

Frontends automatically fall back to `http://localhost:3000` if root `.env` is missing.

---

## 8. Verify the setup

```bash
curl http://localhost:3000/api/countries     # API responds with JSON
```

| Symptom | Cause / Fix |
|---------|-------------|
| 502 on login | Backend not running, or `BACKEND_URL` in root `.env` points at the wrong port |
| `DATABASE_URL not found` | `backend/.env.local` missing or empty |
| relation does not exist | Steps 5–6 not run (schema/seed/migrate) |
| Migration skipped | Already applied — tracked in the `schema_migrations` table |

---

## 9. Tests and linting

```bash
# Playwright e2e (repo root) — install browsers once
npx playwright install --with-deps
npx playwright test

# Backend unit tests
cd backend && npm test

# Lint
cd backend && npm run lint        # eslint
cd frontend && npm run lint       # oxlint
```

---

## 10. Backend scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js dev server |
| `npm run build` | Production build |
| `npm run start` | Start production server |
| `npm test` | Node built-in test runner (`lib/__tests__/`) |
| `npm run migrate` | Apply pending `.sql` migrations |
| `npm run gen:inventory` | Dump live schema shape → `sql/inventory.md` |
| `npm run verify:phase1` | Fail if `schema.sql` drifts from the live DB |
| `npm run lint` | ESLint |

---

## 11. Project structure

```
Ecommerce/
├── .env                    # BACKEND_URL (shared Vite proxy target)
├── backend/                # Next.js 16 API (port 3000)
│   ├── app/api/            #   API route handlers
│   ├── src/modules/        #   controllers / services / routes
│   ├── lib/                #   models, auth, helpers, unit tests
│   ├── scripts/            #   migrate, gen-inventory, verify-phase1
│   ├── sql/
│   │   ├── schema.sql      #   bootstrap DDL (fresh install)
│   │   ├── seed.sql        #   idempotent seed data
│   │   └── migrations/     #   numbered incremental migrations
│   └── public/media/       #   uploaded product images
├── frontend/               # Admin panel (Vite + React, port 5173)
│   ├── storepub/           #   Customer storefront (port 5174)
│   └── storepanel/         #   Store staff panel (port 5175)
├── shared/
│   └── viteProxy.mjs       # Single source of truth for /api proxy
├── tests/                  # Playwright specs
└── docs/                   # Design specs and implementation plans
```

---

## Fresh-machine checklist

1. Install Node 22 + PostgreSQL, start Postgres
2. `git clone` then `npm install` in all 5 locations
3. Fill in `backend/.env.local`
4. `CREATE DATABASE ecommerce`
5. `sql/schema.sql` → `sql/seed.sql` → `npm run migrate`
6. Start the 4 dev servers
