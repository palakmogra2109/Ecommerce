# Country / State / City masters and admin store creation — Design

Date: 2026-09-25
Status: Draft (awaiting review)

## Goal

1. Give the platform proper master-data tables for `countries`, `states` and
   `cities` (with both ISO code and telephone dial code on each country) and
   use them wherever a store/location is recorded.
2. Let an admin create a store from the admin panel: one form that creates the
   store-owner account (store role) plus its linked branch/location, and sends
   the login credentials by email.

## Requirements (confirmed with user)

- "Country code" means **both** the ISO code and the telephone dialing code
  (e.g. `IN`, `+91` for India), stored on the `countries` table.
- Seed **all countries + all states + all cities** from the world dataset.
- The location masters are **read-only reference dropdowns** (no admin
  maintenance screens). Cascading Country → State → City selects are used in
  the admin create-store form, branch form, store registration and onboarding.
- Admin "create store" = **account + branch together** in one form.

## Current state (summary)

- Countries are a static list generated in `backend/lib/phone.js`
  (`PHONE_COUNTRIES`) served by `GET /api/countries` (`iso`, `name`,
  `dialCode`, `flag`). No `states`/`cities` data exists as tables.
- `branches` stores location as free text: `city`, `state`, `country`,
  `postalCode`, plus `address`/`addressLine1`/`addressLine2`.
- Store accounts are `users` rows with the `store` role; listing them is
  `GET /api/branches/stores` (`backend/app/api/branches/stores/route.js`).
  Store registration is `POST /api/auth/store/register` and store profile
  update is `PATCH /api/store/me`.
- Admin user creation already emails credentials via
  `sendCredentialsEmail()` (`backend/lib/mail.js`); the same helper is reused
  for the new create-store flow.
- `PhoneInput.jsx` and `GET /api/countries` already share the shape
  `{ iso, name, dialCode, flag }`.

## Schema changes (`backend/sql/schema.sql`)

Follows the file's existing pattern: `CREATE TABLE IF NOT EXISTS` plus
`ALTER TABLE … ADD COLUMN IF NOT EXISTS` backfills and `CREATE … INDEX IF NOT EXISTS`.

### `countries`

| column | type | notes |
| --- | --- | --- |
| `id` | BIGSERIAL PK | |
| `uuid` | UUID UNIQUE default `gen_random_uuid()` | |
| `name` | TEXT NOT NULL UNIQUE | display name |
| `iso2` | TEXT NOT NULL UNIQUE | ISO 3166-1 alpha-2 (e.g. `IN`) |
| `iso3` | TEXT | ISO 3166-1 alpha-3 (e.g. `IND`) |
| `dialCode` | TEXT | telephone dialing code, `+91` |
| `flag` | TEXT | emoji flag |
| `status` | TEXT default `'ACTIVE'` | `ACTIVE` / `INACTIVE` |
| `created_at` / `updated_at` | TIMESTAMPTZ default now() | |

### `states`

| column | type | notes |
| --- | --- | --- |
| `id` | BIGSERIAL PK | |
| `uuid` | UUID UNIQUE default `gen_random_uuid()` | |
| `name` | TEXT NOT NULL | |
| `stateCode` | TEXT | e.g. `MH` |
| `countryId` | BIGINT NOT NULL REFERENCES `countries(id)` ON DELETE CASCADE | |
| `status` | TEXT default `'ACTIVE'` | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

Indexes: `states_country_idx (countryId)`, unique composite on
`(countryId, name)`.

### `cities`

| column | type | notes |
| --- | --- | --- |
| `id` | BIGSERIAL PK | |
| `uuid` | UUID UNIQUE default `gen_random_uuid()` | |
| `name` | TEXT NOT NULL | |
| `countryId` | BIGINT REFERENCES `countries(id)` | denormalized for fast filtering |
| `stateId` | BIGINT NOT NULL REFERENCES `states(id)` ON DELETE CASCADE | |
| `status` | TEXT default `'ACTIVE'` | |
| `created_at` / `updated_at` | TIMESTAMPTZ | |

Indexes: `cities_state_idx (stateId)`, `cities_country_idx (countryId)`,
`cities_name_idx (name)`.

### `branches` (add, nullable)

- `countryId` BIGINT REFERENCES `countries(id)`
- `stateId` BIGINT REFERENCES `states(id)`
- `cityId` BIGINT REFERENCES `cities(id)`

The existing text `city`, `state`, `country` columns stay. They are kept for
admin search/list and as a stable display fallback (existing rows have no FKs).

### `users` (add, nullable)

- `countryCode` TEXT — dialing code for the account's mobile, e.g. `+91`.

## Relations ("where needed")

- `states.countryId → countries.id`
- `cities.countryId → countries.id` (denormalized), `cities.stateId → states.id`
- `branches.countryId → countries.id`, `branches.stateId → states.id`,
  `branches.cityId → cities.id`
- `users.countryCode ↔ countries.dialCode` — not a DB FK (transient dialing
  metadata); validated/derived in the backend from the `countries` table.
- `customers.address` and `orders.shipping_address` remain JSONB text
  snapshots by design (order/customer history must stay stable), so they get
  **no** FK relations.

## Seed strategy

- Add server-only devDependency `country-state-city` (~17 MB) — world dataset
  of countries, states and cities.
- New script `backend/scripts/seed-locations.js` (run via
  `npm run seed:locations`):
  - connects using the same `DATABASE_URL` as `lib/db.js`;
  - upserts all countries (name/iso2/iso3/dialCode/flag), then all states,
    then all cities — idempotent via natural keys + `ON CONFLICT`;
  - drops/recreates is out of scope; status defaults to `ACTIVE`.
- First run will take a few minutes (≈140k cities). Subsequent runs are
  incremental/no-ops.
- `country-state-city` maps to ISO2/ISO3 and phone codes; flags are generated
  with the same regional-indicator logic already in `lib/phone.js`.

## Backend

### New models (`backend/lib/models/`)

- `country.js`, `state.js`, `city.js` with a small read API:
  - `Country.list()` → `{ uuid, iso, name, dialCode, flag, status }`
  - `Country.findByIso2(iso)`, `State.listByCountry(countryUuid)`,
    `City.listByState(stateUuid)`
  - all filter to `status = 'ACTIVE'` for dropdown use.

### Endpoints

- `GET /api/countries` — rewrite to read from the `countries` table, keeping
  the existing response shape `{ success, countries: [{ iso, name, dialCode,
  flag }] }`. Remains public (used by registration + `PhoneInput`).
- `GET /api/states?countryId=<uuid>` — public; returns active states for a
  country.
- `GET /api/cities?stateId=<uuid>` — public; returns active cities for a
  state, ordered by name.
- `POST /api/branches/stores` (add handler to the existing route file) —
  admin creates a store. Requires `KEY_PERMISSIONS.BRANCHES_CREATE`.
  Request body: account (`name`, `email`, `mobile`, `countryCode`, password)
  + location (`branchName`, `branchCode`, `countryId`, `stateId`, `cityId`,
  `addressLine1`, `addressLine2`, `postalCode`, `phone`).
  Behaviour:
  1. validate email unique, password ≥ 6 chars, and that `stateId` belongs to
     `countryId` and `cityId` to `stateId` (server-side, from the tables);
  2. hash password (bcrypt, same as registration);
  3. insert `users` row (`status=ACTIVE`, `parent_id` = creating admin,
     `mobile`, `countryCode`);
  4. insert `branches` row — copy the location text from the joined
     country/state/city names into the text columns and set the FKs;
  5. insert `branch_users` link (role `BRANCH_MANAGER`);
  6. assign the `store` role (create it if missing, same as registration);
  7. send `sendCredentialsEmail(ownerEmail, ownerName, ownerEmail, password)`
     — best effort, same pattern as `POST /api/users`;
  8. return `{ success, message, store }` (no auth token — the store logs in
     with its own credentials later).
- `Branch.create/update` (`backend/lib/models/branch.js`) accept
  `countryId`/`stateId`/`cityId`; when provided they resolve the names from
  the tables and set **both** the FK and the corresponding text column so
  the two never drift. A helper `resolveLocation({ countryId, stateId,
  cityId })` is added (shared by branch model, store register, store/me).
- `POST /api/auth/store/register` — accept the same location fields +
  `countryCode` for the user; validate and write via the shared helper.
- `PATCH /api/store/me` — accept and persist the location FKs (and user
  `countryCode`), keeping text columns in sync.

## Frontend

- `services/countries.js` — unchanged call shape (`GET /api/countries`), now
  DB-backed.
- New `services/locations.js` — `listStates(countryId)`, `listCities(stateId)`.
- New `services` helper for admin store creation — `createStore(data)` →
  `POST /api/branches/stores`. (Adds to `services/branches.js` next to
  `listStoreAccounts`.)
- New component `LocationSelects.jsx` — cascading Country → State → City
  selects; loads countries from `listCountries`, states on country change,
  cities on state change; controllable: `{ countryId, stateId, cityId }` +
  `onChange`. Used by:
  - admin `StoreForm` (new),
  - `BranchForm.jsx` (replaces the city/state/country text inputs),
  - `StoreRegister.jsx` (adds state/city/country selects, phone country code),
  - `StoreOnboarding.jsx` (location step).
- New page `StoreForm.jsx` (admin "Create Store") — account section (name,
  email, mobile, countryCode, auto-generated password) + location section
  (branch name, code, `LocationSelects`, address, postal code). On success
  shows a confirmation that credentials were emailed and navigates back to
  the Stores list.
- `Stores.jsx` — add the DataPage `onCreate` "Create Store" action →
  `/branches/stores/new`.
- `App.jsx` — add route `/branches/stores/new` behind
  `adminGuard("branches.create", …)`.
- `PhoneInput.jsx` — unchanged (already driven by `GET /api/countries`).

## Validation rules

- password: ≥ 6 characters (same as registration).
- email: unique across `users`.
- mobile: validated with the dial country code via `lib/phone.js`
  (`validateMobile`) where a raw mobile is supplied.
- location: `stateId` must belong to `countryId`; `cityId` must belong to
  `stateId`; otherwise 400 with a clear message.

## Error handling

- All new endpoints follow the existing `try/catch` + `console.error` +
  JSON `{ success: false, message }` convention with `corsHeaders()`.
- Credentials email send failure is non-fatal (logged; message tells the
  admin credentials were printed to the server console, mirroring
  `POST /api/users`).

## Verification

- Backend: `npm run lint` (backend), plus a manual API pass:
  - seed locations, confirm `GET /api/countries`, `/api/states`,
    `/api/cities` return data;
  - `POST /api/branches/stores` creates the account + branch, links them, and
    the new store can log in at `/manager`;
  - branch create/edit + store onboarding persist FKs and text in sync.
- Frontend: `npm run lint` (oxlint) and `npm run build` (vite) in
  `frontend/`.

## Out of scope

- Admin maintenance (CRUD) screens for countries/states/cities — seeded
  reference data only.
- FK relations on `customers`/`orders` address JSONB (kept as snapshots).
- Historical branch rows backfill — existing rows keep their text location and
  NULL FKs.