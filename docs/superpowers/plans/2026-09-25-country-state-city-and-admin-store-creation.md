# Country / State / City Masters and Admin Store Creation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `countries`, `states`, `cities` master tables (with relations), seed them from a world dataset, and let an admin create a store account + location from the admin panel.

**Architecture:** New reference tables hold normalized location master data; `branches` gains nullable FK columns (`countryId`/`stateId`/`cityId`) while keeping its text location columns in sync, and `users` gains a `countryCode` dial-code column. New read endpoints serve cascading dropdowns; a new admin `POST /api/branches/stores` endpoint creates the store-owner user + linked branch and emails credentials. Frontend adds a cascading `LocationSelects` component reused by the new admin create-store form and the existing branch/store forms.

**Tech Stack:** PostgreSQL (via `pg`), Next.js API routes (backend), React/Vite (frontend), `@countrystatecity/countries` (world dataset, devDependency only), existing `sendCredentialsEmail` mailer.

**Spec:** `docs/superpowers/specs/2026-09-25-country-state-city-and-admin-store-creation-design.md`

## Global Constraints

- **SQL identifier casing:** Follow `backend/sql/schema.sql` exactly: domain/FK columns are written in camelCase and Postgres stores them folded to lowercase (`countryId` → `countryid`); the `created_at`/`updated_at` timestamp columns are snake_case. Always run SQL unquoted and reference folded names in models (`countryid`, `stateid`, `cityid`, `dialcode`). Never double-quote identifiers.
- **Live DB drift warning:** Some live tables drifted from schema.sql (`branches` and `branch_users` timestamps are `createdat`/`updatedat`, while `users` uses `created_at`/`updated_at`). Before writing queries to tables that predate this feature, confirm the actual column names against the live DB with psql. Tables created in this plan follow schema.sql exactly and are authoritative for their own queries.
- **Permissions are not enforced server-side:** `authorize()` in `backend/lib/authorization.js` (and `authorizeAny`) only authenticates — the permission slug is ignored. The `branches.*` permission rows do not exist in the live DB today; Task 1 seeds them so the frontend `can()` gate and the DataPage "Create Store" button work. The new `POST /api/branches/stores` endpoint therefore only needs a valid login.
- **Location FKs hold UUIDs:** the cascading selects and every endpoint address countries/states/cities by their `uuid`, so the FK columns on `branches` (and `countryId`/`stateId` inside the new `states`/`cities` tables) reference the location `uuid` columns — not the bigint `id`. This lets frontend uuid values flow straight into the DB with no id↔uuid conversion.
- **Schema pattern:** Append to `backend/sql/schema.sql` using the file's existing style: `CREATE TABLE IF NOT EXISTS`, present-tense `ALTER TABLE … ADD COLUMN IF NOT EXISTS` backfills, and `CREATE … INDEX IF NOT EXISTS`. New tables use a UUID default of `gen_random_uuid()` like every existing table.
- **API response convention:** `{ success: boolean, message? , dataKey: rows }` with `corsHeaders()`; endpoints wrap logic in `try/catch`, log `error` with `console.error`, and return `{ success:false, message:"Internal server error" }` (500) on failure - exactly like the existing routes.
- **No test framework exists in this repo.** Verification is runnable commands (psql, `node` one-liners, curl) with an asserted expected output in each step. Run them from the repo root unless a step says otherwise.
- **DB is reachable locally:** `DATABASE_URL` lives in `backend/.env.local` (`postgresql://…@localhost:5432/ecommerce`). Helpers in this plan read it from that file.
- **World dataset package:** `@countrystatecity/countries` v1.0.9 (46.5 MB unpacked) is a server-only devDependency of `backend`. Never import it into any file in `backend/app/` (bundle size); only `backend/scripts/seed-locations.mjs` imports it.
- **Don't touch unrelated pre-existing bugs** (e.g. the `PATCH branches/route.js` referencing `await params`). Leave existing defects as-is unless a task says otherwise.

## Review Focus

- Admin submits a store whose `stateId` belongs to a different country than `countryId`, or `cityId` to a different state — the API must reject with a 400 and a clear message, not insert inconsistent rows. (Pinned in Task 5.)
- A branch edited in the admin `BranchForm` saves location FKs even though the branch was created before FKs existed (text-only) — the FKs must persist and text stay in sync. (Pinned in Task 4.)
- Re-running the seed (first full run is slow, then incremental) must be idempotent: same final counts and no duplicate/foreign-key errors. (Pinned in Task 1.)
- Non-India countries have only countries/states but often zero cities per state — the cascading selects must show an empty, disabled City dropdown rather than error. (Pinned in Task 8.)
- Store managers created by admin must be able to log in at `/manager` with the emailed credentials and see their linked store without onboarding blocking them. (Pinned in Task 5.)

---

### Task 1: Schema + world seed

**Files:**
- Modify: `backend/sql/schema.sql` (append at end)
- Create: `backend/scripts/seed-locations.mjs`
- Modify: `backend/package.json` (script + devDependency)

**Interfaces:**
- Consumes: nothing
- Produces: DB tables and columns used by every later task:
  - `countries(id, uuid, name, iso2, iso3, dialCode, flag, status, created_at, updated_at)` — unique `iso2`, unique `name`.
  - `states(id, uuid, name, stateCode, countryId → countries.uuid, status, created_at, updated_at)`, unique `(countryId, name)`.
  - `cities(id, uuid, name, countryId → countries.uuid, stateId → states.uuid, status, created_at, updated_at)`, unique `(stateId, name)`.
  - `branches` += `countryId`, `stateId`, `cityId` (nullable `UUID REFERENCES`).
  - `users` += `countryCode TEXT`.
  - `branches.*` permissions seeded and granted to `super_admin`/`admin`/`manager`.
  - Seeded data: countries/iso2↔uuid map, states/country↔state map, cities/country+state map, per the script below.

- [ ] **Step 1: Write the failing schema check**

Append to `backend/sql/schema.sql`:

```sql
-- =============================================================
-- countries / states / cities
-- Normalised location master data used by stores, branches and
-- the admin "create store" flow. Read-only reference data.
-- =============================================================
CREATE TABLE IF NOT EXISTS countries (
  id         BIGSERIAL PRIMARY KEY,
  uuid       UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name       TEXT NOT NULL UNIQUE,
  iso2       TEXT NOT NULL UNIQUE,
  iso3       TEXT,
  dialCode   TEXT,
  flag       TEXT,
  status     TEXT NOT NULL DEFAULT 'ACTIVE'
             CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS states (
  id         BIGSERIAL PRIMARY KEY,
  uuid       UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name       TEXT NOT NULL,
  stateCode  TEXT,
  countryId  UUID NOT NULL REFERENCES countries(uuid) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'ACTIVE'
             CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (countryId, name)
);

CREATE TABLE IF NOT EXISTS cities (
  id         BIGSERIAL PRIMARY KEY,
  uuid       UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  name       TEXT NOT NULL,
  countryId  UUID REFERENCES countries(uuid) ON DELETE CASCADE,
  stateId    UUID NOT NULL REFERENCES states(uuid) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'ACTIVE'
             CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (stateId, name)
);

-- Location FKs on existing tables. UUID references match how the whole app
-- addresses resources: the cascading selects and endpoints all pass uuid
-- strings, so these values flow straight into the columns.
ALTER TABLE branches ADD COLUMN IF NOT EXISTS countryId UUID REFERENCES countries(uuid);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS stateId   UUID REFERENCES states(uuid);
ALTER TABLE branches ADD COLUMN IF NOT EXISTS cityId    UUID REFERENCES cities(uuid);
ALTER TABLE users ADD COLUMN IF NOT EXISTS countryCode TEXT;

-- The branches.* permissions are missing from existing databases. Seed them
-- idempotently and grant them to the standard admin roles so the frontend
-- can() gate and the DataPage "Create Store" button work.
INSERT INTO permissions (name, slug, module, description)
SELECT name, slug, 'branches', description
FROM (VALUES
  ('View Branches',  'branches.view',   'View branches and stores'),
  ('Create Branches','branches.create', 'Create branches and stores'),
  ('Update Branches','branches.update', 'Update branches'),
  ('Delete Branches','branches.delete', 'Delete branches')
) AS p(name, slug, description)
WHERE NOT EXISTS (SELECT 1 FROM permissions WHERE permissions.slug = p.slug);

INSERT INTO role_has_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.slug IN ('branches.view', 'branches.create', 'branches.update', 'branches.delete')
WHERE r.slug IN ('super_admin', 'admin', 'manager')
ON CONFLICT DO NOTHING;

-- Lookup indexes for the cascading dropdowns.
CREATE INDEX IF NOT EXISTS states_country_idx   ON states(countryId);
CREATE INDEX IF NOT EXISTS cities_state_idx     ON cities(stateId);
CREATE INDEX IF NOT EXISTS cities_country_idx   ON cities(countryId);
CREATE INDEX IF NOT EXISTS cities_name_idx      ON cities(name);
```

Note: `ALTER TABLE … ADD COLUMN IF NOT EXISTS` is skipped by Postgres when the column already exists, so the whole file stays safe to run repeatedly (steps 2 and 5 verify this). The new tables use snake_case `created_at`/`updated_at` timestamps and camelCase `countryId`/`stateId`/`cityId` FK columns — exactly the convention schema.sql already uses; in the live DB the FKs fold to `countryid`/`stateid`/`cityid`.

- [ ] **Step 2: Run the schema (verify it fails first)**

Apply the new DDL to the live DB, twice, to prove idempotency:

```bash
export $(grep -E "^DATABASE_URL=" backend/.env.local | xargs)
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/sql/schema.sql 2>&1 | tail -5
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/sql/schema.sql 2>&1 | tail -3
```

Expected: both runs exit 0 (second run makes no changes). Then verify the columns exist:

```bash
psql "$DATABASE_URL" -Atc "SELECT column_name FROM information_schema.columns WHERE table_name='branches' AND column_name IN ('countryid','stateid','cityid') ORDER BY column_name"
psql "$DATABASE_URL" -Atc "SELECT column_name FROM information_schema.columns WHERE table_name='users' AND column_name='countrycode'"
```

Expected: `countryid`, `stateid`, `cityid` and `countrycode`.

- [ ] **Step 3: Add the devDependency + npm script**

In `backend/package.json` add under `devDependencies`: `"@countrystatecity/countries": "^1.0.9"` and under `scripts`: `"seed:locations": "node scripts/seed-locations.mjs"`. Then:

```bash
cd backend && npm install
cd backend && node -e "const m=await import('@countrystatecity/countries'); const c=await m.getCountries(); if(!c.find(x=>x.iso2==='IN'&&x.phonecode==='91')) process.exit(1); console.log('dataset ok:', c.length);" --input-type=module
```

Expected: `dataset ok: 250` (approximately) — confirms the dataset is importable.

- [ ] **Step 4: Write the seed script**

Create `backend/scripts/seed-locations.mjs`:

```js
// Seeds the countries / states / cities tables from the world dataset.
// Idempotent: countries upsert on iso2; states and cities are inserted
// with ON CONFLICT DO NOTHING. First run handles ~140k cities and takes
// a few minutes; later runs are incremental no-ops.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { getCountries, getStatesOfCountry, getCitiesOfState } from "@countrystatecity/countries";

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(here, "..", ".env.local");

try {
  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([^#]*?)\s*$/);
    if (m && !(m[1] in process.env)) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  }
} catch {
  // No .env.local; rely on existing environment.
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5 });

async function main() {
  const countries = await getCountries();
  console.log(`countries: ${countries.length}`);

  await pool.query(
    `INSERT INTO countries (name, iso2, iso3, dialcode, flag, status)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[])
     ON CONFLICT (iso2) DO UPDATE SET name = EXCLUDED.name, iso3 = EXCLUDED.iso3,
       dialcode = EXCLUDED.dialcode, flag = EXCLUDED.flag, status = 'ACTIVE'`,
    [
      countries.map((c) => c.name),
      countries.map((c) => c.iso2),
      countries.map((c) => c.iso3 ?? null),
      countries.map((c) => `+${c.phonecode}`),
      countries.map((c) => c.emoji ?? null),
      countries.map(() => "ACTIVE"),
    ]
  );

  // FKs address locations by uuid (Task 1 DDL), so the lookup maps carry
  // uuid values, not bigint ids.
  const countryRows = await pool.query("SELECT uuid, iso2 FROM countries");
  const countryUuidByIso2 = new Map(countryRows.rows.map((r) => [r.iso2.toLowerCase(), r.uuid]));

  let stateCount = 0;
  for (const country of countries) {
    const states = await getStatesOfCountry(country.iso2);
    if (states.length === 0) continue;

    const countryUuid = countryUuidByIso2.get(country.iso2.toLowerCase());

    await pool.query(
      `INSERT INTO states (name, statecode, countryid, status)
       SELECT * FROM unnest($1::text[], $2::text[], $3::uuid[], $4::text[])
       ON CONFLICT DO NOTHING`,
      [
        states.map((s) => s.name),
        states.map((s) => s.iso2 ?? null),
        states.map(() => countryUuid),
        states.map(() => "ACTIVE"),
      ]
    );
    stateCount += states.length;

    const stateRows = await pool.query(
      `SELECT s.uuid, s.statecode FROM states s WHERE s.countryid = $1`,
      [countryUuid]
    );
    const stateUuidByIso2 = new Map(stateRows.rows.map((r) => [r.statecode?.toLowerCase(), r.uuid]));

    for (const state of states) {
      if (!state.iso2) continue;
      const stateUuid = stateUuidByIso2.get(state.iso2.toLowerCase());
      if (!stateUuid) continue;

      const cities = await getCitiesOfState(country.iso2, state.iso2);
      if (cities.length === 0) continue;

      await pool.query(
        `INSERT INTO cities (name, countryid, stateid, status)
         SELECT * FROM unnest($1::text[], $2::uuid[], $3::uuid[], $4::text[])
         ON CONFLICT DO NOTHING`,
        [
          cities.map((c) => c.name),
          cities.map(() => countryUuid),
          cities.map(() => stateUuid),
          cities.map(() => "ACTIVE"),
        ]
      );
    }
    console.log(`  ${country.iso2} (${country.name}): ${states.length} states`);
  }

  const counts = await pool.query(
    `SELECT (SELECT count(*) FROM countries) AS countries, (SELECT count(*) FROM states) AS states, (SELECT count(*) FROM cities) AS cities`
  );
  console.log(`done. countries=${counts.rows[0].countries} states=${counts.rows[0].states} cities=${counts.rows[0].cities}`);
  await pool.end();
}

main().catch(async (error) => {
  console.error(error);
  await pool.end();
  process.exit(1);
});
```

- [ ] **Step 5: Run the seed and verify counts**

```bash
cd backend && npm run seed:locations
```

Expected: prints per-country progress and ends `done. countries=… states=… cities=…`. Then verify idempotency by running again (should finish quickly and print the same counts) and spot-check India:

```bash
export $(grep -E "^DATABASE_URL=" backend/.env.local | xargs)
psql "$DATABASE_URL" -Atc "SELECT count(*) FROM countries WHERE iso2='IN'"
psql "$DATABASE_URL" -Atc "SELECT count(*) FROM states s JOIN countries c ON c.uuid = s.countryid WHERE c.iso2='IN'"
psql "$DATABASE_URL" -Atc "SELECT count(*) FROM cities ci JOIN states s ON s.uuid = ci.stateid JOIN countries c ON c.uuid = ci.countryid WHERE c.iso2='IN'"
```

Expected: `1`, `36` (India states/UTs), and a large city count (> 5,000). Also confirm invalid combos are impossible by verifying the FK chain end-to-end:

```bash
psql "$DATABASE_URL" -Atc "SELECT c.name||' / '||s.name||' / '||ci.name FROM cities ci JOIN states s ON s.uuid=ci.stateid JOIN countries c ON c.uuid=ci.countryid WHERE c.iso2='IN' LIMIT 1"
```

Expected: a row like `India / Maharashtra / Mumbai`.

- [ ] **Step 6: Commit**

```bash
git add backend/sql/schema.sql backend/scripts/seed-locations.mjs backend/package.json backend/package-lock.json
git commit -m "feat: add countries/states/cities tables and world location seed"
```

---

### Task 2: Location models + shared helper

**Files:**
- Create: `backend/lib/models/country.js`, `backend/lib/models/state.js`, `backend/lib/models/city.js`
- Create: `backend/lib/locations.js`

**Interfaces:**
- Consumes: DB tables from Task 1.
- Produces (exact signatures used by Tasks 3–7):
  - `Country.list()` → `Promise<Array<{ uuid, iso, name, dialCode, flag, status }>>` (all ACTIVE, ordered by name)
  - `Country.findByIso2(iso2)` → `Promise<{ id, uuid, iso2, name, dialcode } | null>`
  - `State.listByCountry(countryUuid)` → `Promise<Array<{ uuid, name, iso, status }>>`
  - `City.listByState(stateUuid)` → `Promise<Array<{ uuid, name, status }>>`
  - `resolveLocation({ countryId, stateId, cityId })` → `Promise<{ ok: true, countryName, stateName, cityName } | { ok: false, message }>`
  - `LOCATION_ERRORS` → `{ INVALID_COUNTRY, STATE_MISMATCH, CITY_MISMATCH }` (message constants; exported from `@/lib/locations` alongside `Country/State/City/resolveLocation`)

- [ ] **Step 1: Write the failing helper check**

Create `backend/scripts/verify-locations.mjs`:

```js
import assert from "node:assert/strict";
import { resolveLocation, Country } from "../lib/locations.js";

const countries = await Country.list();
assert.ok(countries.length > 200, "expected seeded countries");

const india = countries.find((c) => c.iso === "IN");
assert.ok(india, "India must be seeded");

const bogus = "00000000-0000-0000-0000-000000000000";
const bad = await resolveLocation({ countryId: india.uuid, stateId: bogus, cityId: bogus });
assert.notEqual(bad.ok, true, "inconsistent location must be rejected");

console.log("ok");
```

Run it now to see it fail:

```bash
cd backend && node scripts/verify-locations.mjs
```

Expected: FAIL with `Cannot find module '../lib/locations.js'`. (The real assertions are refined in Step 3 once the shapes exist.)

- [ ] **Step 2: Create the models**

`backend/lib/models/country.js`:

```js
import pool from "../db";

export const Country = {
  async list() {
    const result = await pool.query(
      `SELECT uuid, iso2, name, dialcode, flag, status FROM countries WHERE status = 'ACTIVE' ORDER BY name`
    );
    return result.rows.map((row) => ({
      uuid: row.uuid,
      iso: row.iso2,
      name: row.name,
      dialCode: row.dialcode,
      flag: row.flag,
      status: row.status,
    }));
  },

  async findByIso2(iso2) {
    const result = await pool.query(
      `SELECT id, uuid, iso2, name, dialcode FROM countries WHERE iso2 = $1`,
      [(iso2 ?? "").trim().toUpperCase()]
    );
    return result.rows[0] || null;
  },
};
```

`backend/lib/models/state.js`:

```js
import pool from "../db";

export const State = {
  async listByCountry(countryUuid) {
    const result = await pool.query(
      `SELECT s.uuid, s.name, s.statecode, s.status
       FROM states s
       JOIN countries c ON c.uuid = s.countryid
       WHERE c.uuid = $1 AND s.status = 'ACTIVE'
       ORDER BY s.name`,
      [countryUuid]
    );
    return result.rows.map((row) => ({
      uuid: row.uuid,
      name: row.name,
      iso: row.statecode,
      status: row.status,
    }));
  },
};
```

`backend/lib/models/city.js` (`cities.stateId` references `states.uuid`, so the lookup is direct):

```js
import pool from "../db";

export const City = {
  async listByState(stateUuid) {
    const result = await pool.query(
      `SELECT uuid, name, status FROM cities
       WHERE stateid = $1 AND status = 'ACTIVE'
       ORDER BY name`,
      [stateUuid]
    );
    return result.rows.map((row) => ({ uuid: row.uuid, name: row.name, status: row.status }));
  },
};
```

`backend/lib/locations.js` (plain re-exports - no top-level `await`; compares the FKs as uuid-to-uuid):

```js
import pool from "./db";
import { Country } from "./models/country";
import { State } from "./models/state";
import { City } from "./models/city";

export { Country, State, City };

export const LOCATION_ERRORS = Object.freeze({
  INVALID_COUNTRY: "Invalid country",
  STATE_MISMATCH: "Selected state does not belong to the selected country",
  CITY_MISMATCH: "Selected city does not belong to the selected state",
});

// Validates that city -> state -> country form one consistent chain and
// returns the display names so callers can keep their text columns in sync.
export async function resolveLocation({ countryId, stateId, cityId }) {
  const country = countryId
    ? (await pool.query(`SELECT uuid, name FROM countries WHERE uuid = $1 AND status = 'ACTIVE'`, [countryId])).rows[0]
    : null;
  const state = stateId
    ? (await pool.query(`SELECT uuid, name, countryid FROM states WHERE uuid = $1 AND status = 'ACTIVE'`, [stateId])).rows[0]
    : null;
  const city = cityId
    ? (await pool.query(`SELECT uuid, name, stateid FROM cities WHERE uuid = $1 AND status = 'ACTIVE'`, [cityId])).rows[0]
    : null;

  if (!country) return { ok: false, message: LOCATION_ERRORS.INVALID_COUNTRY };
  if (!state || state.countryid !== country.uuid) {
    return { ok: false, message: LOCATION_ERRORS.STATE_MISMATCH };
  }
  if (!city || city.stateid !== state.uuid) {
    return { ok: false, message: LOCATION_ERRORS.CITY_MISMATCH };
  }

  return { ok: true, countryName: country.name, stateName: state.name, cityName: city.name };
}
```

Note: all FKs are compared by `uuid` (matching the DDL in Task 1). The model files and this helper follow the repo's extension-less ESM import style, exactly like the existing `lib/models/branch.js` and `lib/db.js`.

- [ ] **Step 3: Run the verify script (make it pass)**

Replace the placeholder assertions in `backend/scripts/verify-locations.mjs` with:

```js
import assert from "node:assert/strict";
import { resolveLocation, Country, State, City, LOCATION_ERRORS } from "../lib/locations.js";

const countries = await Country.list();
assert.ok(countries.length > 200, "expected seeded countries");
const india = countries.find((c) => c.iso === "IN");
assert.ok(india, "India must be seeded");

const bogus = "00000000-0000-0000-0000-000000000000";
assert.deepEqual(await resolveLocation({ countryId: bogus, stateId: bogus, cityId: bogus }), { ok: false, message: LOCATION_ERRORS.INVALID_COUNTRY });

const states = await State.listByCountry(india.uuid);
const maharashtra = states.find((s) => s.name === "Maharashtra");
assert.ok(maharashtra, "Maharashtra must be seeded under India");

const cities = await City.listByState(maharashtra.uuid);
const mumbai = cities.find((c) => c.name === "Mumbai");
assert.ok(mumbai, "Mumbai must be seeded under Maharashtra");

const good = await resolveLocation({ countryId: india.uuid, stateId: maharashtra.uuid, cityId: mumbai.uuid });
assert.ok(good.ok && good.countryName === "India" && good.stateName === "Maharashtra" && good.cityName === "Mumbai");

const mismatchState = (await resolveLocation({ countryId: india.uuid, stateId: bogus, cityId: bogus })).message;
assert.equal(mismatchState, LOCATION_ERRORS.STATE_MISMATCH);
const mismatchCity = (await resolveLocation({ countryId: india.uuid, stateId: maharashtra.uuid, cityId: bogus })).message;
assert.equal(mismatchCity, LOCATION_ERRORS.CITY_MISMATCH);

console.log("verify-locations ok");
```

Run:

```bash
cd backend && node scripts/verify-locations.mjs
```

Expected: `verify-locations ok`.

- [ ] **Step 4: Commit**

```bash
git add backend/lib/models/country.js backend/lib/models/state.js backend/lib/models/city.js backend/lib/locations.js backend/scripts/verify-locations.mjs
git commit -m "feat: country/state/city models and location hierarchy validation"
```

---

### Task 3: Countries / states / cities read endpoints

**Files:**
- Modify: `backend/app/api/countries/route.js`
- Create: `backend/app/api/states/route.js`, `backend/app/api/cities/route.js`

**Interfaces:**
- Consumes: `Country.list()`, `State.listByCountry()`, `City.listByState()` from Task 2.
- Produces:
  - `GET /api/countries` → `{ success: true, countries: [{ uuid, iso, name, dialCode, flag }] }`
  - `GET /api/states?countryId=<uuid>` → `{ success: true, states: [{ uuid, name, iso }] }`
  - `GET /api/cities?stateId=<uuid>` → `{ success: true, cities: [{ uuid, name }] }`
  - All three are public (no auth), matching the current `/api/countries`.

- [ ] **Step 1: Rewrite `GET /api/countries`**

Replace the body of `backend/app/api/countries/route.js` so `GET` returns DB data while keeping the existing response shape:

```js
import { corsHeaders } from "@/lib/cors";
import { Country } from "@/lib/locations";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET() {
  try {
    const countries = await Country.list();
    return Response.json(
      { success: true, countries },
      { status: 200, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("List countries error:", error);
    return Response.json(
      { success: false, message: "Internal server error" },
      { status: 500, headers: corsHeaders() }
    );
  }
}
```

`backend/lib/phone.js` keeps `PHONE_COUNTRIES` (still used by `validateMobile`), but it is no longer served by this endpoint.

- [ ] **Step 2: Create the states/cities routes**

`backend/app/api/states/route.js`:

```js
import { corsHeaders } from "@/lib/cors";
import { State } from "@/lib/locations";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const countryId = searchParams.get("countryId") || "";
    if (!countryId) {
      return Response.json({ success: false, message: "countryId is required" }, { status: 400, headers: corsHeaders() });
    }
    const states = await State.listByCountry(countryId);
    return Response.json({ success: true, states }, { status: 200, headers: corsHeaders() });
  } catch (error) {
    console.error("List states error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
```

`backend/app/api/cities/route.js`:

```js
import { corsHeaders } from "@/lib/cors";
import { City } from "@/lib/locations";

export const runtime = "nodejs";

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const stateId = searchParams.get("stateId") || "";
    if (!stateId) {
      return Response.json({ success: false, message: "stateId is required" }, { status: 400, headers: corsHeaders() });
    }
    const cities = await City.listByState(stateId);
    return Response.json({ success: true, cities }, { status: 200, headers: corsHeaders() });
  } catch (error) {
    console.error("List cities error:", error);
    return Response.json({ success: false, message: "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
```

- [ ] **Step 3: Verify the endpoints**

Start the backend dev server in one terminal (from `backend/`: `npm run dev`), then run:

```bash
curl -s "http://localhost:3000/api/countries" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.success, j.countries.length, j.countries.find(c=>c.iso==='IN').name)})"
```

Expected: `true 250 India` (approximately). Then capture India's UUID and the Maharashtra UUID and check the chain:

```bash
IN_UUID=$(curl -s "http://localhost:3000/api/countries" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{console.log(JSON.parse(d).countries.find(c=>c.iso==='IN').uuid)})")
ST_UUID=$(curl -s "http://localhost:3000/api/states?countryId=$IN_UUID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.success, j.states.find(s=>s.name==='Maharashtra').uuid)})")
echo "IN=$IN_UUID ST=$ST_UUID"
curl -s "http://localhost:3000/api/cities?stateId=$ST_UUID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.success, j.cities.slice(0,5).map(c=>c.name).join(','))})"
```

Expected: `true` and a CSV beginning with Mumbai-area cities (sorted by name).

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/countries/route.js backend/app/api/states/route.js backend/app/api/cities/route.js
git commit -m "feat: countries/states/cities read endpoints backed by location tables"
```

---

### Task 4: Branch model location FKs

**Files:**
- Modify: `backend/lib/models/branch.js` (`create`, `update`, `PUBLIC_COLUMNS`)

**Interfaces:**
- Consumes: `resolveLocation` from `@/lib/locations` (Task 2), which is imported as `../../lib/locations` relative from the model file - i.e. `import { resolveLocation } from "../locations";`.
- Produces: `Branch.create(data)` and `Branch.update(uuid, data)` accept `countryId`, `stateId`, `cityId`; when present they set the FK columns AND the text `country`/`state`/`city` columns from the resolved names, and reject an inconsistent chain (400 message via thrown error). `PUBLIC_COLUMNS` and `INTERNAL_COLUMNS` now include `countryId, stateId, cityId` so `findByUuid`/`getByUuid` return them (used by `BranchForm` and `store/me`).

- [ ] **Step 1: Add the failing check**

In `backend/scripts/verify-locations.mjs`, append a branch round-trip check:

```js
import { Branch } from "../lib/models/branch.js";
const newBranch = await Branch.create({
  name: "__VERIFY LOCATIONS__",
  code: "VVL0001",
  countryId: india.uuid,
  stateId: maharashtra.uuid,
  cityId: mumbai.uuid,
});
assert.equal(newBranch.cityId, mumbai.uuid, "city FK persisted");
assert.equal(newBranch.city, "Mumbai", "text synced from FK");
await Branch.remove(newBranch.uuid);
```

(Add the import at the top of the existing file.) Run:

```bash
cd backend && node scripts/verify-locations.mjs
```

Expected: FAIL because `Branch.create` ignores the new fields, so `newBranch.cityId` is `undefined`.

- [ ] **Step 2: Update the branch model**

In `backend/lib/models/branch.js`:

- Add at the top (next to the existing imports): `import { resolveLocation } from "../locations";`
- In `PUBLIC_COLUMNS` and `INTERNAL_COLUMNS`, insert `cityId, stateId, countryId` right after `country,` (both are interpolated strings; the "Precise final PUBLIC_COLUMNS" block below shows the result).
- In `create`, add `countryId`, `stateId`, `cityId` to the destructure and, after it, resolve the chain once into a local (never reassign the destructured `const` `city/state/country`):

```js
    const resolveNeeded = [data.countryId, data.stateId, data.cityId].some((v) => (v ?? "").trim() !== "");
    let resolved = null;
    if (resolveNeeded) {
      resolved = await resolveLocation({
        countryId: data.countryId || null,
        stateId: data.stateId || null,
        cityId: data.cityId || null,
      });
      if (!resolved.ok) throw new Error(resolved.message);
    }
```

  Then extend the INSERT columns to `city, state, country, cityId, stateId, countryId, postalCode, ...` (23 columns -> `$1..$23`) and use the resolved fallbacks in the values array:

```js
        city ?? resolved?.cityName ?? null,
        state ?? resolved?.stateName ?? null,
        country ?? resolved?.countryName ?? null,
        countryId ?? null,
        stateId ?? null,
        cityId ?? null,
        postalCode ?? null,
        ...
```

  (The `??` chain uses `resolved` unconditionally: when `resolveNeeded` was false, `resolved` is `null` and the text falls back to whatever `city/state/country` hold.)

- In `update`, after the existing `deliveryRadius` set line and before `values.push(uuid)`, add:

```js
    if ([updates.countryId, updates.stateId, updates.cityId].some((v) => (v ?? "").trim() !== "")) {
      const location = await resolveLocation({
        countryId: updates.countryId || null,
        stateId: updates.stateId || null,
        cityId: updates.cityId || null,
      });
      if (!location.ok) throw new Error(location.message);
      set("country", location.countryName);
      set("state", location.stateName);
      set("city", location.cityName);
      set("countryId", updates.countryId || null);
      set("stateId", updates.stateId || null);
      set("cityId", updates.cityId || null);
    }
```

  The all-blank guard (`some(...) !== ""`) matters for rows created before the FKs existed: `BranchForm` sends `countryId: ""` etc., and `""` must not trigger `resolveLocation` (which would 400 "Invalid country").

- **Pre-existing bug fix (required by this task):** the `UPDATE` statement currently ends with `updated_at = now()` but the live `branches` table column is `updatedat` (DB drift, see Global Constraints) — change it to `updatedat = now())`.

Precise final `PUBLIC_COLUMNS`:

```js
const PUBLIC_COLUMNS =
  "uuid, name, code, phone, email, address, addressLine1, addressLine2, " +
  "city, state, country, cityId, stateId, countryId, postalCode, latitude, longitude, " +
  "openingTime, closingTime, timezone, status, deliveryEnabled, pickupEnabled, " +
  "deliveryRadius, createdAt, updatedAt";
```

- [ ] **Step 3: Run the check again**

```bash
cd backend && node scripts/verify-locations.mjs
```

Expected: prints `verify-locations ok` (the new branch round-trip assertions added in Step 1 are now inside the file before the final `console.log`).

- [ ] **Step 4: Commit**

```bash
git add backend/lib/models/branch.js backend/scripts/verify-locations.mjs
git commit -m "feat: branch location FK columns with text sync"
```

---

### Task 5: Admin create-store endpoint

**Files:**
- Modify: `backend/app/api/branches/stores/route.js` (add `POST`, keep `GET`)
- Reference: `backend/app/api/auth/store/register/route.js` (existing pattern for role/blob)

**Interfaces:**
- Consumes: `authorize` (`@/lib/authorization`), `KEY_PERMISSIONS`, `bcryptjs`, `pool` (`@/lib/db`), `resolveLocation` (`@/lib/locations`), `sendCredentialsEmail` (`@/lib/mail`).
- Produces: `POST /api/branches/stores` with request body:
  ```json
  {
    "name": "Store Owner Name",
    "email": "owner@example.com",
    "password": "secret1",
    "mobile": "9876543210",
    "countryCode": "+91",
    "branchName": "Earth Dhanya Downtown",
    "branchCode": "EDD001",
    "countryId": "<uuid>",
    "stateId": "<uuid>",
    "cityId": "<uuid>",
    "addressLine1": "Plot 12",
    "addressLine2": "",
    "postalCode": "400001",
    "phone": "+91-9876543210"
  }
  ```
  Response: `{ success: true, message, store: { uuid, name, email } }` on success; `{ success: false, message }` (400) on validation failure; 409 on duplicate email. Requires `branches.create` permission (admin only).

- [ ] **Step 1: Write the endpoint**

Add to `backend/app/api/branches/stores/route.js` (imports at top: `bcrypt from "bcryptjs"`, `resolveLocation` from `@/lib/locations`, `sendCredentialsEmail` from `@/lib/mail`, `createToken` is NOT needed here):

```js
export async function POST(request) {
  try {
    const auth = await authorize(KEY_PERMISSIONS.BRANCHES_CREATE);
    if (!auth.ok) return auth.response;

    const body = await request.json();
    const {
      name, email, password,
      mobile, countryCode,
      branchName, branchCode,
      countryId, stateId, cityId,
      addressLine1, addressLine2, postalCode, phone,
    } = body;

    if (!name || !email || !password) {
      return Response.json({ success: false, message: "Name, email and password are required" }, { status: 400, headers: corsHeaders() });
    }
    if (!branchName) {
      return Response.json({ success: false, message: "Store name is required" }, { status: 400, headers: corsHeaders() });
    }
    if (password.length < 6) {
      return Response.json({ success: false, message: "Password must be at least 6 characters" }, { status: 400, headers: corsHeaders() });
    }
    const location = await resolveLocation({ countryId, stateId, cityId });
    if (!location.ok) {
      return Response.json({ success: false, message: location.message }, { status: 400, headers: corsHeaders() });
    }

    const normalizedEmail = (email || "").toLowerCase().trim();
    const existing = await pool.query("SELECT id FROM users WHERE email = $1", [normalizedEmail]);
    if (existing.rows.length > 0) {
      return Response.json({ success: false, message: "Email already registered" }, { status: 409, headers: corsHeaders() });
    }

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    const userResult = await pool.query(
      `INSERT INTO users (name, email, password, mobile, countrycode, parent_id, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVE')
       RETURNING id, uuid, name, email`,
      [name.trim(), normalizedEmail, hashedPassword, mobile || null, countryCode || null, auth.user.id]
    );
    const user = userResult.rows[0];

    const branchResult = await pool.query(
      `INSERT INTO branches (name, code, city, state, country, cityid, stateid, countryid,
                             addressline1, addressline2, postalcode, phone, email, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'ACTIVE')
       RETURNING id, uuid, name, code`,
      [
        branchName.trim(),
        (branchCode || branchName.trim().substring(0, 6).toUpperCase()),
        location.cityName,
        location.stateName,
        location.countryName,
        cityId || null,
        stateId || null,
        countryId || null,
        addressLine1 || null,
        addressLine2 || null,
        postalCode || null,
        phone || null,
        normalizedEmail,
      ]
    );
    const branch = branchResult.rows[0];

    await pool.query(
      `INSERT INTO branch_users (branchId, userId, role) VALUES ($1, $2, 'BRANCH_MANAGER')`,
      [branch.id, user.id]
    );
```

```js
    // Grant the "store" role (create it if missing), mirroring store/register.
    const roleSlot = await pool.query(`SELECT id FROM roles WHERE slug = 'store'`);
    let storeRoleId = roleSlot.rows[0]?.id;
    if (!storeRoleId) {
      const created = await pool.query(
        `INSERT INTO roles (name, slug, description)
         VALUES ('Store', 'store', 'Store panel owner: manages a branch via the store panel')
         RETURNING id`
      );
      storeRoleId = created.rows[0].id;
    }
    await pool.query(
      `INSERT INTO user_has_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [user.id, storeRoleId]
    );

    const mailResult = await sendCredentialsEmail(normalizedEmail, name.trim(), normalizedEmail, password);

    return Response.json(
      {
        success: true,
        message: mailResult.success
          ? "Store created. Login credentials sent via email."
          : "Store created. Email could not be sent - credentials logged to the server console.",
        store: { uuid: user.uuid, name: user.name, email: user.email },
      },
      { status: 201, headers: corsHeaders() }
    );
  } catch (error) {
    console.error("Create store error:", error);
    return Response.json({ success: false, message: error.message || "Internal server error" }, { status: 500, headers: corsHeaders() });
  }
}
```

**Note:** `branch_users` gets the branch via the `RETURNING id` from the insert (no second lookup). The payload text columns come from `location.*`, so a valid chain always keeps text and FKs consistent. `countryCode` is stored on the created user so the owner's phone has its dialing context.

- [ ] **Step 2: Verify happy path + hierarchy rejection**

With the backend dev server running, log in as an admin (use an admin email/password you have; the response includes `token`):

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"YOUR_ADMIN_EMAIL","password":"YOUR_ADMIN_PASSWORD"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")

IN_UUID=$(curl -s "http://localhost:3000/api/countries" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).countries.find(c=>c.iso==='IN').uuid))")
MAH_UUID=$(curl -s "http://localhost:3000/api/states?countryId=$IN_UUID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).states.find(s=>s.name==='Maharashtra').uuid))")
BOM_UUID=$(curl -s "http://localhost:3000/api/cities?stateId=$MAH_UUID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).cities.find(c=>c.name==='Mumbai').uuid))")

curl -s -X POST http://localhost:3000/api/branches/stores -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"name\":\"Verify Owner\",\"email\":\"verify-store@example.com\",\"password\":\"secret1\",\"mobile\":\"9876543210\",\"countryCode\":\"+91\",\"branchName\":\"Verify Store\",\"branchCode\":\"VRF001\",\"countryId\":\"$IN_UUID\",\"stateId\":\"$MAH_UUID\",\"cityId\":\"$BOM_UUID\"}"
```

Expected: `{"success":true,"message":"Store created. Login credentials sent via email.", ...}`. Then a mismatched state must be rejected (country US + Maharashtra state):

```bash
US_UUID=$(curl -s "http://localhost:3000/api/countries" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).countries.find(c=>c.iso==='US').uuid))")
curl -s -X POST http://localhost:3000/api/branches/stores -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d "{\"name\":\"Bad\",\"email\":\"bad-store@example.com\",\"password\":\"secret1\",\"branchName\":\"Bad Store\",\"branchCode\":\"BAD001\",\"countryId\":\"$US_UUID\",\"stateId\":\"$MAH_UUID\",\"cityId\":\"$BOM_UUID\"}"
```

Expected: `{"success":false,"message":"Selected state does not belong to the selected country"}`.

- [ ] **Step 3: Verify the new store can log in**

With the backend running, log in as the created store owner:

```bash
curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"verify-store@example.com","password":"secret1"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.success, j.user?.roles, j.user?.branches?.length)})"
```

Expected: `true [ 'store' ] 1`. Then clean up the test rows:

```bash
export $(grep -E "^DATABASE_URL=" backend/.env.local | xargs)
psql "$DATABASE_URL" -c "DELETE FROM branches WHERE code IN ('VRF001','BAD001'); DELETE FROM users WHERE email IN ('verify-store@example.com','bad-store@example.com');"
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/branches/stores/route.js
git commit -m "feat: admin create-store endpoint with credentials email"
```

---

### Task 6: Store registration accepts location + country code

**Files:**
- Modify: `backend/app/api/auth/store/register/route.js`

**Interfaces:**
- Consumes: `resolveLocation` from `@/lib/locations`.
- Produces: `POST /api/auth/store/register` additionally accepts `countryId`, `stateId`, `cityId`, and `countryCode`. On success the branch row carries the FKs and synced text; the user row carries `countryCode`. The response `branch` object additionally returns `cityId`/`stateId`/`countryId`.

- [ ] **Step 1: Update the body destructure + validation**

In `backend/app/api/auth/store/register/route.js`:
- Change the destructure to `const { name, email, password, branchName, branchCode, cityId, stateId, countryId, address, phone, mobile, countryCode } = body;`
- After the existing `if (!branchName)` check add:

```js
    const location = countryId || stateId || cityId
      ? await resolveLocation({ countryId, stateId, cityId })
      : null;
    if (location && !location.ok) {
      return Response.json({ success: false, message: location.message }, { status: 400, headers: corsHeaders() });
    }
```

- [ ] **Step 2: Update the inserts**

Change the user insert to include mobile + country code:

```js
    const userResult = await pool.query(
      `INSERT INTO users (name, email, password, mobile, countrycode, status)
       VALUES ($1, $2, $3, $4, $5, 'ACTIVE') RETURNING id, uuid, name, email`,
      [name.trim(), normalizedEmail, hashedPassword, mobile || null, countryCode || null]
    );
```

Change the branch insert to write FKs and (when a location was resolved) the text:

```js
    const branchResult = await pool.query(
      `INSERT INTO branches (name, code, city, state, country, cityid, stateid, countryid, address, phone, email, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'ACTIVE') RETURNING *`,
      [
        branchName.trim(),
        branchCode || branchName.trim().substring(0, 6).toUpperCase(),
        location?.cityName || city || "",
        location?.stateName || "",
        location?.countryName || "India",
        cityId || null,
        stateId || null,
        countryId || null,
        address || "",
        phone || "",
        normalizedEmail,
      ]
    );
```

Keep the rest of the route unchanged (role grant, token, response). In the response `branch:` object, add `cityId: branch.cityid, stateId: branch.stateid, countryId: branch.countryid`.

- [ ] **Step 3: Verify**

With the backend running:

```bash
BOM_UUID=<the Mumbai city uuid from Task 5> MAH_UUID=<Maharashtra uuid> IN_UUID=<India uuid>
curl -s -X POST http://localhost:3000/api/auth/store/register -H 'Content-Type: application/json' -d "{\"name\":\"Reg Owner\",\"email\":\"reg-owner@example.com\",\"password\":\"secret1\",\"mobile\":\"9876501234\",\"countryCode\":\"+91\",\"branchName\":\"Reg Store\",\"cityId\":\"$BOM_UUID\",\"stateId\":\"$MAH_UUID\",\"countryId\":\"$IN_UUID\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.success, j.branch?.city, j.branch?.country, j.user?.roles)})"
```

Expected: `true Mumbai India [ 'store' ]`. Clean up:

```bash
export $(grep -E "^DATABASE_URL=" backend/.env.local | xargs)
psql "$DATABASE_URL" -c "DELETE FROM branches WHERE code='REGSTORE' OR email='reg-owner@example.com'; DELETE FROM users WHERE email='reg-owner@example.com';"
```

If the generated code differs, delete by email only.

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/auth/store/register/route.js
git commit -m "feat: store registration writes location FKs and user country code"
```

---

### Task 7: Store profile (onboarding) persists location + country code

**Files:**
- Modify: `backend/app/api/store/me/route.js`

**Interfaces:**
- Consumes: `resolveLocation` from `@/lib/locations` (add the import to the route).
- Produces: `PATCH /api/store/me` additionally accepts `countryId`, `stateId`, `cityId` (syncs branch text + FKs) and `countryCode` (updates the current user). Both the `GET` and `PATCH` shape of `serializeBranch` gain `cityId`, `stateId`, `countryId`; the `user` object in both responses gains `countryCode`.

- [ ] **Step 1: Update `serializeBranch` + the user payload**

In `backend/app/api/store/me/route.js`, inside `serializeBranch`, add after `country: row.country,`:

```js
    cityId: row.cityid,
    stateId: row.stateid,
    countryId: row.countryid,
```

In the `GET` handler, extend the user select from `SELECT uuid, name, email, mobile, avatar` to also return `countrycode`, and surface it in the `user:` object as `countryCode: user.countrycode`. Do the same in the `PATCH` handler's re-fetch (`SELECT uuid, name, email, mobile, avatar` → add `countrycode`) and its `user:` response.

- [ ] **Step 2: Persist the new fields in `PATCH`**

Add to the user fields block, after `if (body.mobile !== undefined) setUser(...)`:

```js
    if (body.countryCode !== undefined) setUser("countrycode", body.countryCode || null);
```

Add to the branch fields section, after the existing `if (body.country !== undefined) setBranch(...)` line. The all-blank guard mirrors Task 4 so onboarding sending empty FKs on a text-only branch stays a no-op:

```js
    if ([body.countryId, body.stateId, body.cityId].some((v) => (v ?? "").trim() !== "")) {
      const location = await resolveLocation({
        countryId: body.countryId || null,
        stateId: body.stateId || null,
        cityId: body.cityId || null,
      });
      if (!location.ok) {
        return Response.json({ success: false, message: location.message }, { status: 400, headers: corsHeaders() });
      }
      setBranch("country", location.countryName);
      setBranch("state", location.stateName);
      setBranch("city", location.cityName);
      setBranch("countryId", body.countryId || null);
      setBranch("stateId", body.stateId || null);
      setBranch("cityId", body.cityId || null);
    }
```

- [ ] **Step 3: Verify**

With the backend running, create a fresh store through the admin endpoint (Task 5 still works), then log in as it and PATCH the location. Note the branch uuid comes from the login payload's `user.branches[0].uuid`:

```bash
ADMIN_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"YOUR_ADMIN_EMAIL","password":"YOUR_ADMIN_PASSWORD"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")

IN_UUID=$(curl -s "http://localhost:3000/api/countries" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).countries.find(c=>c.iso==='IN').uuid))")
MAH_UUID=$(curl -s "http://localhost:3000/api/states?countryId=$IN_UUID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).states.find(s=>s.name==='Maharashtra').uuid))")
BOM_UUID=$(curl -s "http://localhost:3000/api/cities?stateId=$MAH_UUID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).cities.find(c=>c.name==='Mumbai').uuid))")
PUN_UUID=$(curl -s "http://localhost:3000/api/cities?stateId=$MAH_UUID" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).cities.find(c=>c.name==='Pune').uuid))")

curl -s -X POST http://localhost:3000/api/branches/stores -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' -d "{\"name\":\"Me Owner\",\"email\":\"me-owner@example.com\",\"password\":\"secret1\",\"branchName\":\"Me Store\",\"branchCode\":\"MEV001\",\"countryId\":\"$IN_UUID\",\"stateId\":\"$MAH_UUID\",\"cityId\":\"$BOM_UUID\"}" > /dev/null

STORE_TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"me-owner@example.com","password":"secret1"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).token))")
BRANCH=$(curl -s -X POST http://localhost:3000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"me-owner@example.com","password":"secret1"}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).user.branches[0].uuid))")

curl -s -X PATCH http://localhost:3000/api/store/me -H "Authorization: Bearer $STORE_TOKEN" -H 'Content-Type: application/json' -d "{\"branchId\":\"$BRANCH\",\"cityId\":\"$PUN_UUID\",\"stateId\":\"$MAH_UUID\",\"countryId\":\"$IN_UUID\",\"countryCode\":\"+91\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log(j.success, j.branch.city, j.branch.cityId, j.user.countryCode)})"
```

Expected: `true Pune <pune-uuid> +91`. Clean up the test rows:

```bash
export $(grep -E "^DATABASE_URL=" backend/.env.local | xargs)
psql "$DATABASE_URL" -c "DELETE FROM branches WHERE code='MEV001'; DELETE FROM users WHERE email='me-owner@example.com';"
```

- [ ] **Step 4: Commit**

```bash
git add backend/app/api/store/me/route.js
git commit -m "feat: store onboarding persists location FKs and country code"
```

---

### Task 8: Location services + cascading selects component

**Files:**
- Create: `frontend/src/services/locations.js`
- Modify: `frontend/src/services/branches.js` (add `createStore`)
- Create: `frontend/src/components/LocationSelects.jsx`

**Interfaces:**
- Consumes: `listCountries` from `../services/countries` (already `GET /api/countries`), endpoints from Task 3.
- Produces:
  - `listStates(countryId)` → `Promise<{ success, states: [{ uuid, name, iso }] }>`
  - `listCities(stateId)` → `Promise<{ success, cities: [{ uuid, name }] }>`
  - `splitE164(value, countries)` → `{ dialCode, number }` — splits the E.164 string `PhoneInput` emits into dial code + national number (longest-dial-code match), used by StoreForm and StoreRegister.
  - `createStore(data)` → `Promise<{ success, message }>` (POST `/api/branches/stores`)
  - `<LocationSelects value={{ countryId, stateId, cityId }} onChange={(next) => void} />` — three `<select className="filament-select">` controls; options load on mount/country change/state change; City disabled when no state or no cities. Consumed by Task 9 and Task 10.

- [ ] **Step 1: Create the service**

`frontend/src/services/locations.js`:

```js
import { authHeaders } from "./http";

const API_URL = "/api";

export async function listStates(countryId) {
  const response = await fetch(`${API_URL}/states?countryId=${encodeURIComponent(countryId)}`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });
  return await response.json();
}

export async function listCities(stateId) {
  const response = await fetch(`${API_URL}/cities?stateId=${encodeURIComponent(stateId)}`, {
    headers: authHeaders(),
    method: "GET",
    credentials: "include",
  });
  return await response.json();
}

// Splits a stored/emitted E.164 value ("+919876543210") into { dialCode, number }
// by matching the longest known dial code prefix. `countries` comes from listCountries().
export function splitE164(value, countries) {
  const str = String(value ?? "").trim();
  const digits = str.replace(/\D/g, "");
  const dialCodes = [...countries]
    .map((c) => c.dialCode)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  const dialCode = str.startsWith("+")
    ? dialCodes.find((d) => digits.startsWith(d.replace("+", ""))) || null
    : null;
  return {
    dialCode,
    number: dialCode ? digits.slice(dialCode.length - 1) : str,
  };
}
```

In `frontend/src/services/branches.js`, add at the end:

```js
export async function createStore(data) {
  const response = await fetch(`${API_URL}/branches/stores`, {
    method: "POST",
    headers: {
      ...authHeaders(),
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(data),
  });
  return await response.json();
}
```

(Import `authHeaders` is already present in that file.)

- [ ] **Step 2: Create `LocationSelects`**

`frontend/src/components/LocationSelects.jsx`:

```jsx
import { useEffect, useState } from "react";
import { listCountries } from "../services/countries";
import { listStates, listCities } from "../services/locations";

export default function LocationSelects({ value, onChange }) {
  const [countries, setCountries] = useState([]);
  const [states, setStates] = useState([]);
  const [cities, setCities] = useState([]);
  const [loadingCountries, setLoadingCountries] = useState(true);

  useEffect(() => {
    let active = true;
    listCountries().then((data) => {
      if (active && data.success) setCountries(data.countries || []);
    }).finally(() => {
      if (active) setLoadingCountries(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!value.countryId) {
      setStates([]);
      setCities([]);
      return;
    }
    let active = true;
    listStates(value.countryId).then((data) => {
      if (active) setStates(data.success ? (data.states || []) : []);
    });
    return () => { active = false; };
  }, [value.countryId]);

  useEffect(() => {
    if (!value.stateId) {
      setCities([]);
      return;
    }
    let active = true;
    listCities(value.stateId).then((data) => {
      if (active) setCities(data.success ? (data.cities || []) : []);
    });
    return () => { active = false; };
  }, [value.stateId]);

  const stateDisabled = loadingCountries || !value.countryId || states.length === 0;
  const cityDisabled = !value.stateId || cities.length === 0;

  return (
    <>
      <div className="form-row">
        <label className="form-label">Country</label>
        <select
          className="filament-select"
          value={value.countryId || ""}
          onChange={(e) => onChange({ countryId: e.target.value, stateId: "", cityId: "" })}
          disabled={loadingCountries}
        >
          <option value="">Select country</option>
          {countries.map((c) => (
            <option key={c.uuid} value={c.uuid}>{c.name}</option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label className="form-label">State</label>
        <select
          className="filament-select"
          value={value.stateId || ""}
          onChange={(e) => onChange({ ...value, stateId: e.target.value, cityId: "" })}
          disabled={stateDisabled}
        >
          <option value="">{stateDisabled ? "No states" : "Select state"}</option>
          {states.map((s) => (
            <option key={s.uuid} value={s.uuid}>{s.name}</option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <label className="form-label">City</label>
        <select
          className="filament-select"
          value={value.cityId || ""}
          onChange={(e) => onChange({ ...value, cityId: e.target.value })}
          disabled={cityDisabled}
        >
          <option value="">{cityDisabled ? "No cities" : "Select city"}</option>
          {cities.map((c) => (
            <option key={c.uuid} value={c.uuid}>{c.name}</option>
          ))}
        </select>
      </div>
    </>
  );
}
```

- [ ] **Step 3: Verify with lint + a temporary smoke page**

```bash
cd frontend && npm run lint 2>&1 | grep -E "LocationSelects|locations\.js|error" || echo "no errors"
```

Expected: no errors in the new files (pre-existing warnings are fine). Then render it temporarily via the dev server:

```bash
cd frontend && npm run dev &
sleep 3
curl -s "http://localhost:5173/src/components/LocationSelects.jsx" -o /dev/null -w "%{http_code}\n"
```

Expected: `200`. Kill the dev server afterwards. (Full behaviour is verified through the pages in Tasks 9-10.)

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/locations.js frontend/src/services/branches.js frontend/src/components/LocationSelects.jsx
git commit -m "feat: location services and cascading location selects"
```

---

### Task 9: Admin create-store page

**Files:**
- Create: `frontend/src/pages/StoreForm.jsx`
- Modify: `frontend/src/pages/Stores.jsx` (add create action)
- Modify: `frontend/src/App.jsx` (add route)
- Reference: `frontend/src/components/PhoneInput.jsx`, `frontend/src/services/branches.js` (`createStore`)

**Interfaces:**
- Consumes: `createStore` (Task 8), `LocationSelects` (Task 8), `PhoneInput` (existing), `useAuth` (`can`).
- Produces: route `/branches/stores/new` (guarded by `branches.create`); `Stores.jsx` shows a "Create Store" button; `StoreForm` posts the payload shape from Task 5 and shows the returned message.

- [ ] **Step 1: Create the page**

`frontend/src/pages/StoreForm.jsx`:

```jsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Breadcrumb from "../components/Breadcrumb";
import LocationSelects from "../components/LocationSelects";
import PhoneInput from "../components/PhoneInput";
import { createStore } from "../services/branches";
import { listCountries } from "../services/countries";
import { splitE164 } from "../services/locations";
import { useAuth } from "../context/AuthContext";

export default function StoreForm() {
  const navigate = useNavigate();
  const { can } = useAuth();
  const canSubmit = can("branches.create");

  const [countries, setCountries] = useState([]);
  const [account, setAccount] = useState({ name: "", email: "", mobile: "", countryCode: "" });
  const [password, setPassword] = useState("");
  const [locationValue, setLocationValue] = useState({ countryId: "", stateId: "", cityId: "" });
  const [branch, setBranch] = useState({ branchName: "", branchCode: "", addressLine1: "", addressLine2: "", postalCode: "", phone: "" });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    listCountries().then((data) => {
      if (active && data.success) setCountries(data.countries || []);
    });
    return () => { active = false; };
  }, []);

  // PhoneInput emits a single E.164 string; split it back into dial code +
  // national number with the same longest-dial-code matching it uses.
  function handleMobile(value) {
    const { dialCode, number } = splitE164(value, countries);
    setAccount((a) => ({
      ...a,
      countryCode: dialCode || a.countryCode,
      mobile: number,
    }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    const fullMobile = account.countryCode + account.mobile;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const data = await createStore({
        ...account,
        password,
        ...branch,
        ...locationValue,
        phone: fullMobile || null,
      });
      if (data.success) {
        setMessage(data.message);
        setTimeout(() => navigate("/branches/stores"), 1200);
      } else {
        setError(data.message || "Failed to create store.");
      }
    } catch {
      setError("Unable to connect to the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="filament-page">
      <Breadcrumb items={[{ label: "Stores", to: "/branches/stores" }, { label: "Create Store" }]} />
      <h1 className="filament-title">Create Store</h1>

      {error && <div className="filament-alert">{error}</div>}
      {message && <div className="filament-alert">{message}</div>}

      <div className="filament-card">
        <form onSubmit={handleSubmit}>
          <div className="form-grid">
            <div className="form-row">
              <label className="form-label">Owner name <span className="required">*</span></label>
              <input type="text" value={account.name} onChange={(e) => setAccount({ ...account, name: e.target.value })} required />
            </div>
            <div className="form-row">
              <label className="form-label">Owner email <span className="required">*</span></label>
              <input type="email" value={account.email} onChange={(e) => setAccount({ ...account, email: e.target.value })} required />
            </div>
            <div className="form-row">
              <label className="form-label">Login password <span className="required">*</span></label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
              <p className="input-hint">Emailed to the owner after creation.</p>
            </div>
            <div className="form-row">
              <label className="form-label">Mobile</label>
              <PhoneInput value={account.countryCode + account.mobile} onChange={handleMobile} />
            </div>

            <div className="form-row">
              <label className="form-label">Store name <span className="required">*</span></label>
              <input type="text" value={branch.branchName} onChange={(e) => setBranch({ ...branch, branchName: e.target.value })} required />
            </div>
            <div className="form-row">
              <label className="form-label">Store code</label>
              <input type="text" value={branch.branchCode} onChange={(e) => setBranch({ ...branch, branchCode: e.target.value.toUpperCase() })} placeholder="ST001" />
            </div>

            <LocationSelects value={locationValue} onChange={setLocationValue} />

            <div className="form-row">
              <label className="form-label">Address Line 1</label>
              <input type="text" value={branch.addressLine1} onChange={(e) => setBranch({ ...branch, addressLine1: e.target.value })} />
            </div>
            <div className="form-row">
              <label className="form-label">Address Line 2</label>
              <input type="text" value={branch.addressLine2} onChange={(e) => setBranch({ ...branch, addressLine2: e.target.value })} />
            </div>
            <div className="form-row">
              <label className="form-label">Postal Code</label>
              <input type="text" value={branch.postalCode} onChange={(e) => setBranch({ ...branch, postalCode: e.target.value })} />
            </div>
          </div>

          <div className="form-actions form-actions-sticky">
            <button type="button" className="filament-btn filament-btn-outline" onClick={() => navigate("/branches/stores")}>Cancel</button>
            {canSubmit && (
              <button type="submit" className="filament-btn filament-btn-primary" disabled={saving}>
                {saving ? "Creating..." : "Create Store"}
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
```

Note: `PhoneInput` emits a single E.164 string (e.g. `+919876543210`), never `(dialCode, number)` — `handleMobile` splits it back via the shared `splitE164` helper (the same longest-dial-code matching `PhoneInput` uses). `Breadcrumb` lives at `frontend/src/components/Breadcrumb.jsx` (imported from `../components/Breadcrumb`), not in the pages folder.

- [ ] **Step 2: Wire the stores page + route**

In `frontend/src/pages/Stores.jsx`:
- Add `create: "branches.create"` to the `permissions` prop — `DataPage` renders its create button only when `onCreate && can(permissions.create)`.
- Add `onCreate` + `createLabel`:

```jsx
import { useNavigate } from "react-router-dom";
// keep existing imports

export default function Stores() {
  const navigate = useNavigate();
  return (
    <DataPage
      // ...existing props...
      permissions={{
        view: "branches.view",
        update: "branches.update",
        create: "branches.create",
      }}
      onCreate={() => navigate("/branches/stores/new")}
      createLabel="Create Store"
    />
  );
}
```

In `frontend/src/App.jsx`, after the `path="/branches/stores"` route add:

```jsx
        <Route
          path="/branches/stores/new"
          element={adminGuard("branches.create", "Create Store", <StoreForm />)}
        />
```

and import `StoreForm` at the top alongside the other pages.

- [ ] **Step 3: Verify**

```bash
cd frontend && npm run lint 2>&1 | grep -E "StoreForm|Stores\.jsx|App\.jsx|error" || echo "no errors"
cd frontend && npm run build 2>&1 | tail -3
```

Expected: no new lint errors and `✓ built in …ms`. Then in the browser: log in as admin → Stores → "Create Store" → fill the form (select India → Maharashtra → Mumbai) → submit. Expected: success message "Store created. Login credentials sent via email." and redirect to the Stores list. The new store card appears after refresh (list is account-based).

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/StoreForm.jsx frontend/src/pages/Stores.jsx frontend/src/App.jsx
git commit -m "feat: admin create-store page with cascading location"
```

---

### Task 10: Existing forms use the cascading location selects

**Files:**
- Modify: `frontend/src/components/BranchForm.jsx`
- Modify: `frontend/src/pages/StoreRegister.jsx`
- Modify: `frontend/src/pages/StoreOnboarding.jsx`

**Interfaces:**
- Consumes: `LocationSelects` (Task 8). BranchForm needs branch FKs back from `getBranch` (Task 4 made `Branch.findByUuid` return `countryId/stateId/cityId`). StoreOnboarding needs FKs from `GET /api/store/me` (Task 7 added them to `serializeBranch`).

- [ ] **Step 1: BranchForm**

In `frontend/src/components/BranchForm.jsx`:
- Import `LocationSelects` from `./LocationSelects`.
- Add to initial `form` state: `countryId: "", stateId: "", cityId: ""`.
- In the edit `setForm` (inside the `run()` load) add `countryId: b.countryId || "", stateId: b.stateId || "", cityId: b.cityId || ""`.
- Replace the three `form-row` blocks for City, State, Country with:

```jsx
            <LocationSelects
              value={{ countryId: form.countryId, stateId: form.stateId, cityId: form.cityId }}
              onChange={(next) => setForm({ ...form, ...next })}
            />
```

- Remove the `city` text required-validation but keep city required via the FK: `Branch.create/update` now resolves the text from the selects on the server, so the frontend text `city` may still be empty on create. Replace `if (!form.city.trim()) e.city = "City is required.";` with:

```jsx
    if (!form.cityId) e.city = "City is required.";
```

- [ ] **Step 2: StoreRegister**

In `frontend/src/pages/StoreRegister.jsx`:
- Import `LocationSelects` from `../components/LocationSelects`, `PhoneInput` from `../components/PhoneInput`, and `splitE164` from `../services/locations`. Add `const [locationValue, setLocationValue] = useState({ countryId: "", stateId: "", cityId: "" });`. Add `mobile` and `countryCode` (default `"+91"`) to the form state.
- In step 2's JSX, replace the City input with `<LocationSelects value={locationValue} onChange={setLocationValue} />`. Replace the plain phone text input with a `PhoneInput` and a `handleMobile` that uses `splitE164` (same pattern as Task 9's StoreForm).
- In `handleSubmit`, send the FKs plus the phone pieces instead of the old `city` text (the backend `store/register` from Task 6 resolves text from FKs):

```jsx
      const data = await storeRegister({
        ...form,
        ...locationValue,
        mobile: form.mobile,
        countryCode: form.countryCode,
      });
```

- Drop the now-unused `city` field from the form state; keep `branchCode`.

- [ ] **Step 3: StoreOnboarding**

In `frontend/src/pages/StoreOnboarding.jsx`:
- Import `LocationSelects` from `../components/LocationSelects`.
- Add the FKs to the form state: in `EMPTY_FORM` add `countryId: "", stateId: "", cityId: ""`, and in `loadProfile`'s `setForm({...})` set them from `b.countryId || ""`, `b.stateId || ""`, `b.cityId || ""` (Task 7 added them to `serializeBranch`).
- The location step is a hardcoded `renderLocation()` (a `.store-field-grid` with plain `store-field` inputs for City/State/Country) — NOT a generic loop over `FIELD_GROUPS.location`. Replace the three `<label className="store-field">` blocks for City, State, Country with a span-2 label rendering the cascading selects:

```jsx
          <label className="store-field span-2">
            <span>Country / State / City</span>
            <LocationSelects
              value={{ countryId: form.countryId, stateId: form.stateId, cityId: form.cityId }}
              onChange={(next) => setForm((f) => ({ ...f, ...next }))}
            />
          </label>
```

  The selects use the Filament form classes (`form-row`/`filament-select`) while this page uses `store-field` labels, so the wrapper `<label className="store-field span-2"><span>…</span><LocationSelects …/></label>` keeps the grid layout intact.
- Include the FKs in the save payload: `storeUpdateProfile` already broadcasts `{ ...form, branchId }`, so once `countryId/stateId/cityId` live in `form` they are sent automatically. No extra handling needed in `save()`. The backend `PATCH /api/store/me` ignores them unless non-empty (Task 7 guard), so pre-existing text-only stores stay untouched.

- [ ] **Step 4: Verify**

```bash
cd frontend && npm run lint 2>&1 | grep -E "BranchForm|StoreRegister|StoreOnboarding|error" || echo "no errors"
cd frontend && npm run build 2>&1 | tail -3
```

Expected: no new lint errors, `✓ built in …ms`. Manual checks:
- Admin → create/edit a Branch: the three selects appear; saving with India/Maharashtra/Mumbai stores the FKs (psql: `SELECT city, state, country, cityid, stateid, countryid FROM branches WHERE code='…'` shows both text and FKs).
- Store registration at `/register/store` step 2 shows the selects; a registered store's onboarding location step shows the selects pre-filled.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/BranchForm.jsx frontend/src/pages/StoreRegister.jsx frontend/src/pages/StoreOnboarding.jsx
git commit -m "feat: use cascading location selects across store forms"
```

---

## Self-Review

Covered against the spec:
- Tables + relations (`countries/states/cities`, `branches` FKs, `users.countryCode`): Task 1 (+ Task 2 for the relation helpers).
- Both ISO + dial code stored per country: Task 1 (`iso2`, `iso3`, `dialCode`).
- World seed (all countries/states/cities) + idempotency: Task 1. FKs address locations by `uuid`, and the seed joins/inserts use uuid arrays via `countryUuidByIso2`/`stateUuidByIso2`.
- `branches.*` permissions seeded and granted (required for the `can()` gate and the DataPage create button — server `authorize()` stays auth-only): Task 1.
- Pre-existing `branches.updatedat` drift fixed inside the changed update path: Task 4.
- Read-only dropdowns (no CRUD masters): implied by the absence of anywhere adding/editing countries through the UI; Tasks 3 & 8 only read.
- Read endpoints: Task 3.
- Admin create store (account + branch + credentials email): Task 5 (+ Task 9 UI).
- Location relations reused where needed (branch form, store registration, onboarding): Tasks 4, 6, 7, 10.
- Same API shape for `/api/countries` (`iso`, `name`, `dialCode`, `flag`): Task 3.
- Error handling/validation (hierarchy mismatch 400s): Tasks 2, 5, 6, 7. The all-blank guard in Task 4/7 keeps pre-FK text-only rows editable without a spurious "Invalid country".
- Verification (lint + build + API test): covered per task.

Placeholders: none. Type/name consistency: `resolveLocation`/`Country`/`State`/`City` exported from `@/lib/locations` and consumed identically in Tasks 4-7; `createStore` in `services/branches.js` used by `StoreForm`; `LocationSelects` props `value`/`onChange` fixed across Tasks 8-10.

Review Focus mapping: hierarchy rejection (Task 5 step 2), branch FK round-trip for pre-existing text-only rows (Task 4 step 1/3), seed idempotency (Task 1 step 5), empty city dropdown for non-India countries (Task 8 component + Task 9 verification), store login after admin create (Task 5 step 3).