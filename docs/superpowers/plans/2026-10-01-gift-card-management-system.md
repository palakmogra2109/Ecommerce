# E-Gift Card Management System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace direct-at-checkout gift card spending with a spec-compliant system: admin-authored gift card templates, one-time redeemable codes, delivery, a customer wallet that redeemed value credits into, and bucket-aware wallet spending at checkout.

**Architecture:** `gift_cards` becomes a template table; every redeemable unit moves to `gift_card_codes` with its code stored as a hash. A claim is a single transaction that locks the code row and credits a *restricted bucket* in a wallet ledger, so a card limited to spices cannot be spent on rice. Checkout debits wallet buckets instead of drawing cards. A `PaymentProvider` interface with a sandbox implementation gates code issuance behind real payment.

**Tech Stack:** Node 22, Next.js API routes, raw `pg`, PostgreSQL, plain ESM pure-logic tests via `node --test`, React + Vite (oxlint) admin and storefront.

**Spec:** `docs/superpowers/specs/2026-10-01-gift-card-management-system-design.md`

---

## Global Constraints

- **Do not commit, push, or merge.** The user handles all repository operations. Every task's final step is a verification, not a `git commit`.
- Migrations are **additive only**. Never edit an already-applied migration. Never drop a table or column that holds data.
- Every new migration is **idempotent** and re-runnable. Verify with a second `npm run migrate` that prints `skip`.
- `backend/sql/schema.sql` must be updated in the **same task** as any migration, so a fresh install matches the live database.
- Tests are **pure logic** in `backend/lib/__tests__/*.test.mjs`, run with `npm test`. No test may require a database.
- Backend lint: `npm run lint` in `backend/` (must be 0 errors). Frontend lint: `npm run lint` in `frontend/` (must be 0 errors).
- **Class names must exist in a stylesheet.** Three bugs in this project shipped because JSX referenced classes that were never defined. Before adding a class to JSX, confirm it exists in `frontend/src/index.css` or `frontend/src/styles/Storefront.css`. Verify with the audit in Task 26.
- Frontend build must pass: `npm run build` in `frontend/`.
- Never log a gift card code — not in errors, not in debug output, not in "helpful" messages.
- Money is `NUMERIC(12,2)`; all arithmetic rounds through `round2` in `backend/lib/giftCardRules.js`.

---

## Review Focus

Inputs the spec implies but no task's happy-path test would catch. Each is pinned to a task below.

1. **A second claim of the same code arriving simultaneously.** The shopper must be credited exactly once; the loser sees "already claimed". → Task 13
2. **A restricted credit meeting an ineligible basket.** A spices-only credit on a rice-only order must contribute zero, not silently pay for it. → Task 9
3. **Payment succeeding but delivery failing.** The code must still exist and be resendable, because the shopper already paid. → Task 15
4. **A code that expires while unclaimed.** It must read as expired and be unclaimable without a sweeper job. → Task 8
5. **A wallet spent to exactly zero, then refunded.** The refund must restore the same buckets it took from, not create unbacked value. → Task 14

---

## File Structure

**New backend library files** (one responsibility each):

| File | Responsibility |
|---|---|
| `backend/lib/payment/provider.js` | `PaymentProvider` contract + registry |
| `backend/lib/payment/sandbox.js` | Deterministic sandbox provider |
| `backend/lib/models/giftCardCode.js` | Code CRUD, hash lookup, status transitions |
| `backend/lib/models/wallet.js` | Wallet balance, credit, debit, refund, bucket reading |
| `backend/lib/services/claimGiftCard.js` | Atomic one-time claim |
| `backend/lib/services/purchaseGiftCard.js` | Create purchase → pay → issue N codes |
| `backend/lib/services/deliverGiftCard.js` | Delivery rows, real email, honest SMS skip |
| `backend/lib/giftCardBuckets.js` | Pure bucket allocation maths (no DB) |
| `backend/lib/giftCardApplicability.js` | Pure applicability matching and eligible totals |
| `backend/lib/reports/giftCardReports.js` | Dashboard aggregates |

**New frontend files:**

| File | Responsibility |
|---|---|
| `frontend/src/pages/GiftCardTemplates.jsx` | Admin template list |
| `frontend/src/components/GiftCardTemplateForm.jsx` | Admin template create/edit |
| `frontend/src/pages/GiftCardCodes.jsx` | Admin issued-code list, revoke, resend |
| `frontend/src/pages/GiftCardReports.jsx` | Admin dashboard |
| `frontend/src/pages/RedeemGiftCard.jsx` | Customer claim screen |
| `frontend/src/pages/WalletPanel.jsx` | Customer balance + ledger |

**Modified:** `backend/sql/migrations/*`, `backend/sql/schema.sql`,
`backend/lib/giftCardRules.js`, `backend/app/api/gift-cards/*`,
`backend/app/api/store/gift-cards/*`, `backend/app/api/store/checkout/*`,
`backend/app/api/orders/store/route.js`, `shared/constants.js`,
`frontend/src/pages/Storefront.jsx`, `frontend/src/services/*`,
`frontend/src/App.jsx`, `frontend/src/index.css`,
`frontend/src/styles/Storefront.css`.

---

## Phase 0 — Foundations

### Task 1: Payment provider interface

**Files:**
- Create: `backend/lib/payment/provider.js`
- Create: `backend/lib/payment/sandbox.js`
- Test: `backend/lib/__tests__/paymentProvider.test.mjs`

**Interfaces:**
- Produces:
  - `createPaymentProvider(name)` → provider
  - `provider.createIntent({ amount, currency, reference, metadata })` → `{ intentId, status }`
  - `provider.confirm(intentId, { outcome })` → `{ status: 'PAID'|'FAILED', reference, failureReason }`
  - `provider.refund(reference, amount)` → `{ status, reference }`
  - `provider.name` → string
  - Sandbox: `outcome` is `'succeed' | 'fail'`; `'fail'` returns `failureReason: 'Card declined'`.

- [ ] **Step 1: Write the failing test**

Create `backend/lib/__tests__/paymentProvider.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { createPaymentProvider } from "../payment/provider.js";
import { SandboxProvider } from "../payment/sandbox.js";

test("sandbox provider settles a successful intent", async () => {
  const p = new SandboxProvider();
  const intent = await p.createIntent({ amount: 500, currency: "INR", reference: "r1" });
  assert.equal(intent.status, "PENDING");
  const done = await p.confirm(intent.intentId, { outcome: "succeed" });
  assert.equal(done.status, "PAID");
  assert.ok(done.reference);
});

test("sandbox provider reports failure with a reason", async () => {
  const p = new SandboxProvider();
  const intent = await p.createIntent({ amount: 500, currency: "INR", reference: "r2" });
  const done = await p.confirm(intent.intentId, { outcome: "fail" });
  assert.equal(done.status, "FAILED");
  assert.equal(done.failureReason, "Card declined");
});

test("confirming an unknown intent fails rather than settling", async () => {
  const p = new SandboxProvider();
  const done = await p.confirm("nope", { outcome: "succeed" });
  assert.equal(done.status, "FAILED");
});

test("registry returns the sandbox by name and throws otherwise", () => {
  assert.equal(createPaymentProvider("sandbox").name, "sandbox");
  assert.throws(() => createPaymentProvider("stripe"), /Unknown payment provider/);
});

test("amounts are echoed exactly, to the paisa", async () => {
  const p = new SandboxProvider();
  const intent = await p.createIntent({ amount: 333.33, currency: "INR", reference: "r3" });
  assert.equal(intent.amount, 333.33);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm test -- lib/__tests__/paymentProvider.test.mjs`
Expected: FAIL — `Cannot find module '../payment/provider.js'`

- [ ] **Step 3: Write the sandbox provider**

Create `backend/lib/payment/sandbox.js`:

```javascript
import { randomUUID } from "node:crypto";

// Deterministic stand-in for a real gateway. It exists so purchase, issue,
// refund and failure paths are exercisable in development and tests. It never
// claims to be a real charge.
export class SandboxProvider {
  constructor({ failEvery = 0 } = {}) {
    this.name = "sandbox";
    this.intents = new Map();
    this.calls = 0;
    this.failEvery = failEvery;
  }

  async createIntent({ amount, currency = "INR", reference, metadata = {} }) {
    const intentId = `sbx_${randomUUID()}`;
    this.intents.set(intentId, { amount, currency, reference, metadata });
    return { intentId, status: "PENDING", amount, currency, reference };
  }

  async confirm(intentId, { outcome = "succeed" } = {}) {
    const intent = this.intents.get(intentId);
    if (!intent) {
      return { status: "FAILED", failureReason: "Unknown payment intent" };
    }
    // Lets a test force intermittent failure without stubbing the method.
    this.calls += 1;
    const forced = this.failEvery > 0 && this.calls % this.failEvery === 0;
    if (outcome === "fail" || forced) {
      intent.status = "FAILED";
      return { status: "FAILED", failureReason: "Card declined" };
    }
    intent.status = "PAID";
    return { status: "PAID", reference: `sbx_ref_${intentId}` };
  }

  async refund(reference, amount) {
    return { status: "REFUNDED", reference, amount };
  }
}
```

- [ ] **Step 4: Write the registry**

Create `backend/lib/payment/provider.js`:

```javascript
import { SandboxProvider } from "./sandbox.js";

const REGISTRY = { sandbox: SandboxProvider };

// The rest of the system depends only on this contract, so adding a live
// gateway is a new class plus one registry entry — no call site changes.
export function createPaymentProvider(name = "sandbox") {
  const Ctor = REGISTRY[name];
  if (!Ctor) {
    throw new Error(`Unknown payment provider: ${name}`);
  }
  return new Ctor();
}

export function registeredProviders() {
  return Object.keys(REGISTRY);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npm test -- lib/__tests__/paymentProvider.test.mjs`
Expected: PASS, 5 tests

- [ ] **Step 6: Verify lint**

Run: `cd backend && npm run lint`
Expected: 0 errors

---

### Task 2: Secure code generation and hashing

**Files:**
- Create: `backend/lib/giftCardCodeGen.js`
- Test: `backend/lib/__tests__/giftCardCodeGen.test.mjs`

**Interfaces:**
- Produces:
  - `generateCode()` → `string` shaped `GIFT-XXXX-XXXX`
  - `hashCode(code)` → 64-char lowercase hex
  - `normalizeCode(value)` → uppercase, single dashes
  - `codeLast4(code)` → 4 chars
  - `looksLikeCode(value)` → boolean

- [ ] **Step 1: Write the failing test**

Create `backend/lib/__tests__/giftCardCodeGen.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import {
  generateCode,
  hashCode,
  normalizeCode,
  codeLast4,
  looksLikeCode,
} from "../giftCardCodeGen.js";

test("generated codes match the documented shape", () => {
  for (let i = 0; i < 200; i++) {
    assert.match(generateCode(), /^GIFT-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/);
  }
});

test("generated codes do not repeat across a large sample", () => {
  const seen = new Set();
  for (let i = 0; i < 5000; i++) seen.add(generateCode());
  assert.equal(seen.size, 5000);
});

test("normalization is case and whitespace insensitive", () => {
  assert.equal(normalizeCode("  gift 8k4p 92xm "), "GIFT-8K4P-92XM");
  assert.equal(normalizeCode("gift-8k4p-92xm"), "GIFT-8K4P-92XM");
});

test("hashing is stable, lowercase hex, and case insensitive", () => {
  const a = hashCode("GIFT-8K4P-92XM");
  assert.equal(a, hashCode("gift-8k4p-92xm"));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("last4 ignores separators", () => {
  assert.equal(codeLast4("GIFT-8K4P-92XM"), "92XM");
});

test("code detection rejects obvious non-codes", () => {
  assert.equal(looksLikeCode("GIFT-8K4P-92XM"), true);
  assert.equal(looksLikeCode("nope"), false);
  assert.equal(looksLikeCode(""), false);
  assert.equal(looksLikeCode("123"), false);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm test -- lib/__tests__/giftCardCodeGen.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `backend/lib/giftCardCodeGen.js`:

```javascript
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// No 0/O, 1/I/L: a code read aloud or retyped must have one spelling.
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_RE = /^GIFT-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/;

export function normalizeCode(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "-")
    .toUpperCase();
}

export function hashCode(code) {
  return createHash("sha256").update(normalizeCode(code)).digest("hex");
}

export function codeLast4(code) {
  return normalizeCode(code).replace(/[^A-Z0-9]/g, "").slice(-4);
}

export function looksLikeCode(value) {
  return CODE_RE.test(normalizeCode(value));
}

export function generateCode() {
  // 8 bytes over a 32-character alphabet: rejection sampling would be tidier,
  // but 256 % 32 === 0, so every value maps to exactly one character and the
  // distribution is already uniform.
  const bytes = randomBytes(8);
  let tail = "";
  for (let i = 0; i < 8; i++) tail += ALPHABET[bytes[i] % ALPHABET.length];
  return `GIFT-${tail.slice(0, 4)}-${tail.slice(4)}`;
}

// Constant-time compare of two code hashes, for any path that verifies a
// supplied code against a stored one outside a database lookup.
export function codeHashesMatch(a, b) {
  if (!a || !b) return false;
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm test -- lib/__tests__/giftCardCodeGen.test.mjs`
Expected: PASS, 6 tests

- [ ] **Step 5: Verify lint**

Run: `cd backend && npm run lint`
Expected: 0 errors

---

## Phase 1 — Schema

### Task 3: Create the new tables

**Files:**
- Create: `backend/sql/migrations/015-gift-card-v2-tables.sql`
- Modify: `backend/sql/schema.sql`

**Interfaces:**
- Produces tables: `gift_card_purchases`, `gift_card_codes`,
  `gift_card_applicability`, `gift_card_deliveries`, `gift_card_redemptions`,
  `customer_wallets`, `customer_reward_transactions`
  — columns exactly as specified in the design doc §2.2.

- [ ] **Step 1: Record the pre-migration state for later verification**

```bash
cd backend
node --input-type=module -e "
import './scripts/lib/env.mjs';
" 2>/dev/null || true
psql "$DATABASE_URL" -c "SELECT COUNT(*) AS cards, SUM(balance) AS value FROM gift_cards;"
```

Write the printed `cards` and `value` into the task notes. Migration 17 asserts
against them.

- [ ] **Step 2: Write the migration**

Create `backend/sql/migrations/015-gift-card-v2-tables.sql` with the full DDL
from the design doc §2.2, including:

- `gift_card_purchases` with `quantity > 0` and `payment_status` CHECK
- `gift_card_codes` with `UNIQUE (code_hash)` and the six-value status CHECK
  (`PENDING_PAYMENT`, `UNUSED`, `REDEEMED`, `EXPIRED`, `REVOKED`, `SCHEDULED`)
- `gift_card_applicability` with `UNIQUE (gift_card_id, scope_type, scope_value)`
- `gift_card_deliveries` with `UNIQUE (code_id, channel)`
- `gift_card_redemptions` with `UNIQUE (code_id)` — the idempotency anchor
- `customer_wallets` with `CHECK (balance >= 0)`
- `customer_reward_transactions` with the **partial unique index**:
  ```sql
  CREATE UNIQUE INDEX customer_reward_transactions_code_credit_key
    ON customer_reward_transactions (code_id)
    WHERE type = 'GIFT_CARD_CREDIT';
  ```
  (A `UNIQUE (code_id, type) WHERE ...` inside `CREATE TABLE` is invalid DDL —
  a filtered index must be created separately.)

Plus every index listed in the design doc §2.2 "Indexes to create".

- [ ] **Step 3: Apply the migration**

Run: `cd backend && npm run migrate`
Expected: `apply 015-gift-card-v2-tables.sql`

- [ ] **Step 4: Verify idempotency**

Run: `cd backend && npm run migrate`
Expected: `skip 015-gift-card-v2-tables.sql`

- [ ] **Step 5: Mirror into schema.sql**

Append the same DDL (without `IF NOT EXISTS` wrappers that the migration needs)
to `backend/sql/schema.sql` so a fresh install matches. The file already uses
`CREATE TABLE IF NOT EXISTS` throughout — follow that convention.

- [ ] **Step 6: Verify lint and existing tests still pass**

Run: `cd backend && npm run lint && npm test`
Expected: 0 errors, 111 passing

---

### Task 4: Template columns on gift_cards

**Files:**
- Create: `backend/sql/migrations/016-gift-card-template-columns.sql`
- Modify: `backend/sql/schema.sql`

**Interfaces:**
- `gift_cards` gains: `name TEXT NOT NULL DEFAULT 'Gift Card'`,
  `description TEXT NOT NULL DEFAULT ''`, `validity_days INTEGER`,
  `quantity_cap INTEGER`, `starts_at TIMESTAMPTZ`, `ends_at TIMESTAMPTZ`
- `gift_denominations` gains `gift_card_id BIGINT REFERENCES gift_cards(id) ON DELETE CASCADE`

Existing issued-card columns (`code`, `code_hash`, `balance`, `recipient_email`,
`applicable_*`) are **left in place** — Task 5 migrates out of them, and
dropping them is deliberately deferred so a rollback is possible.

- [ ] **Step 1: Write the migration**

```sql
-- gift_cards gains its template role. Existing issued-card columns stay until
-- 017 has moved the data out, so a rollback is possible.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Gift Card';
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS validity_days INTEGER;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS quantity_cap INTEGER;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS starts_at TIMESTAMPTZ;
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS ends_at TIMESTAMPTZ;

-- Denominations now hang off a template rather than floating alone.
ALTER TABLE gift_denominations
  ADD COLUMN IF NOT EXISTS gift_card_id BIGINT REFERENCES gift_cards(id) ON DELETE CASCADE;

-- A template is purchasable only inside its window.
CREATE INDEX IF NOT EXISTS gift_cards_live_idx
  ON gift_cards (status, starts_at, ends_at);
```

- [ ] **Step 2: Apply and verify idempotency**

Run: `cd backend && npm run migrate && npm run migrate`
Expected: `apply 016-...` then `skip 016-...`

- [ ] **Step 3: Mirror into schema.sql**

- [ ] **Step 4: Verify nothing broke**

Run: `cd backend && npm test && npm run lint`
Expected: 111 passing, 0 errors

---

### Task 5: Migrate the live cards

**Files:**
- Create: `backend/sql/migrations/017-migrate-cards-to-codes.sql`
- Test: `backend/lib/__tests__/giftCardMigration.test.mjs` (pure assertions about the expected invariant, not a DB test)

**Interfaces:**
- Every row in `gift_cards` with a non-null `code` or `code_hash` becomes a
  `gift_card_codes` row, preserving `value`, `balance`, status, recipient,
  dates, `code_hash`, `code_last4`.
- A synthetic template is created per distinct configuration so migrated codes
  stay linked to a real template.
- Every `gift_card_transactions` row of type `REDEEM` with an order becomes a
  `gift_card_redemptions` row plus a `customer_reward_transactions` credit.
- `gift_card_scheduled` rows become `gift_card_deliveries` rows.

- [ ] **Step 1: Write the migration**

Create `backend/sql/migrations/017-migrate-cards-to-codes.sql`. It must be
idempotent — guard every insert with `WHERE NOT EXISTS (SELECT 1 FROM gift_card_codes WHERE code_hash = ...)`.

```sql
-- One synthetic template per distinct configuration, so migrated codes are
-- attached to a real template rather than floating.
INSERT INTO gift_cards (uuid, name, description, status, source, created_at, updated_at)
SELECT gen_random_uuid(), 'Gift Card', 'Migrated from the pre-v2 gift card system',
       'ACTIVE', 'FIXED', now(), now()
WHERE NOT EXISTS (SELECT 1 FROM gift_cards WHERE description = 'Migrated from the pre-v2 gift card system');

-- The codes themselves. Status is mapped onto the six-value vocabulary;
-- a card past its expiry is written as UNUSED and reads as EXPIRED at read time.
INSERT INTO gift_card_codes (
  gift_card_id, code_hash, code_last4, value, balance, currency,
  status, sender_name, recipient_name, recipient_email,
  purchased_at, activated_at, expires_at, created_at, updated_at)
SELECT
  (SELECT id FROM gift_cards WHERE description = 'Migrated from the pre-v2 gift card system' LIMIT 1),
  g.code_hash,
  COALESCE(g.code_last4, right(regexp_replace(COALESCE(g.code, ''), '[^A-Za-z0-9]', '', 'g'), 4)),
  g.initial_amount,
  g.balance,
  g.currency,
  CASE
    WHEN g.status = 'CANCELLED'  THEN 'REVOKED'
    WHEN g.status = 'REDEEMED'   THEN 'REDEEMED'
    WHEN g.status = 'DRAFT'       THEN 'PENDING_PAYMENT'
    ELSE 'UNUSED'
  END,
  NULL, NULL,
  g.recipient_email,
  g.created_at, g.activated_at, g.expires_at, g.created_at, now()
FROM gift_cards g
WHERE (g.code_hash IS NOT NULL OR g.code IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM gift_card_codes c WHERE c.code_hash = g.code_hash);

-- Redemption history becomes real redemptions plus a wallet credit, so a
-- migrated card that was already spent is not spendable a second time.
INSERT INTO gift_card_redemptions (uuid, code_id, customer_id, credit_amount, created_at)
SELECT gen_random_uuid(), c.id, o.customer_id, t.amount, t.created_at
FROM gift_card_transactions t
JOIN gift_cards g ON g.id = t.gift_card_id
JOIN gift_card_codes c ON c.code_hash = g.code_hash
JOIN orders o ON o.id = t.order_id
WHERE t.type = 'REDEEM'
  AND NOT EXISTS (SELECT 1 FROM gift_card_redemptions r WHERE r.code_id = c.id);

-- Backstop: a wallet row for every customer who now has credit history.
INSERT INTO customer_wallets (customer_id, balance, updated_at)
SELECT DISTINCT r.customer_id, 0, now()
FROM gift_card_redemptions r
WHERE r.customer_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM customer_wallets w WHERE w.customer_id = r.customer_id);

-- Scheduled sends become delivery rows. The old gift_card_scheduled table
-- stored no link to a card, so the only reliable correlation is the recipient
-- email plus the amount. Rows that do not correlate are counted, not guessed.
DO $$
DECLARE migrated INTEGER := 0; skipped INTEGER := 0;
BEGIN
  INSERT INTO gift_card_deliveries (uuid, code_id, channel, status, scheduled_for, created_at, updated_at)
  SELECT gen_random_uuid(), c.id, 'SCHEDULED',
         CASE WHEN s.card_uuid IS NOT NULL THEN 'SENT' ELSE 'PENDING' END,
         s.scheduled_for, s.created_at, now()
  FROM gift_card_scheduled s
  JOIN gift_card_codes c
    ON c.recipient_email = s.recipient_email
   AND c.value = s.amount
  WHERE NOT EXISTS (
    SELECT 1 FROM gift_card_deliveries d
    WHERE d.code_id = c.id AND d.channel = 'SCHEDULED'
  );
  GET DIAGNOSTICS migrated = ROW_COUNT;

  -- Anything left had no matching code and must not be invented.
  SELECT count(*) INTO skipped
  FROM gift_card_scheduled s
  WHERE NOT EXISTS (
    SELECT 1 FROM gift_card_codes c
    WHERE c.recipient_email = s.recipient_email AND c.value = s.amount
  );

  RAISE NOTICE 'scheduled deliveries migrated: %, skipped (no matching code): %', migrated, skipped;
END $$;
```

If `skipped` is greater than 0, record it in the task notes and carry the rows
into a follow-up migration once a reliable key exists. Do not fabricate a link.

- [ ] **Step 2: Apply and inspect**

Run: `cd backend && npm run migrate`
Then:

```bash
psql "$DATABASE_URL" -c "
  SELECT (SELECT COUNT(*) FROM gift_cards WHERE code_hash IS NOT NULL) AS before_cards,
         (SELECT COUNT(*) FROM gift_card_codes) AS after_codes,
         (SELECT COALESCE(SUM(balance),0) FROM gift_cards WHERE code_hash IS NOT NULL) AS before_value,
         (SELECT COALESCE(SUM(balance),0) FROM gift_card_codes) AS after_value;"
```

Expected: `before_cards = after_codes` and `before_value = after_value`.

If they differ, **stop and roll back** rather than proceeding.

- [ ] **Step 3: Verify idempotency**

Run: `cd backend && npm run migrate`
Expected: `skip 017-...` and the counts above unchanged.

- [ ] **Step 4: Restore the deleted 008 marker**

`008-gift-card-delivery.sql` is recorded as applied in `schema_migrations` but
the file no longer exists, so a fresh install silently skips it. Create it as a
documented no-op so the ledger and the directory agree:

```sql
-- 008 was applied to the live database and then its file was removed. Its
-- columns were dropped again by 010, so a fresh install needs nothing from
-- it. This file exists only so the migration ledger and the directory agree.
SELECT 1;
```

- [ ] **Step 5: Run the full suite**

Run: `cd backend && npm test && npm run lint`
Expected: 111 passing, 0 errors

---

## Phase 2 — Pure domain logic

### Task 6: Applicability rules

**Files:**
- Create: `backend/lib/giftCardApplicability.js`
- Test: `backend/lib/__tests__/giftCardApplicability.test.mjs`

**Interfaces:**
- Produces:
  - `matchesRule(rule, line)` → boolean
  - `eligibleTotal(rules, lines)` → number — the order total that satisfies `rules`
  - `scopeSummary(rules)` → string
  - `normalizeRules(rows)` → `[{ type, value }]`

  A `line` is `{ productId, productUuid, brandId, categoryId, categorySlug, price, quantity }`.
  A `rule` is `{ type: 'PRODUCT'|'BRAND'|'CATEGORY', value }`. Empty rules match everything.

- [ ] **Step 1: Write the failing test**

Create `backend/lib/__tests__/giftCardApplicability.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { matchesRule, eligibleTotal, normalizeRules } from "../giftCardApplicability.js";

const lines = [
  { productUuid: "p1", categorySlug: "spices-masalas", brandId: 3, price: 100, quantity: 2 },
  { productUuid: "p2", categorySlug: "grains-pulses", brandId: 1, price: 250, quantity: 1 },
];

test("empty rules match everything", () => {
  assert.equal(eligibleTotal([], lines), 450);
});

test("a category rule only counts matching lines", () => {
  const rules = normalizeRules([{ scope_type: "CATEGORY", scope_value: "spices-masalas" }]);
  assert.equal(eligibleTotal(rules, lines), 200);
});

test("a product rule matches on uuid or id", () => {
  const byUuid = normalizeRules([{ scope_type: "PRODUCT", scope_value: "p2" }]);
  assert.equal(eligibleTotal(byUuid, lines), 250);
});

test("a brand rule matches the numeric brand id", () => {
  const rules = normalizeRules([{ scope_type: "BRAND", scope_value: "3" }]);
  assert.equal(eligibleTotal(rules, lines), 200);
});

test("rules of different types are OR-ed, not AND-ed", () => {
  const rules = normalizeRules([
    { scope_type: "CATEGORY", scope_value: "spices-masalas" },
    { scope_type: "PRODUCT", scope_value: "p2" },
  ]);
  assert.equal(eligibleTotal(rules, lines), 450);
});

test("a rule matching nothing yields zero, never the whole order", () => {
  const rules = normalizeRules([{ scope_type: "CATEGORY", scope_value: "nope" }]);
  assert.equal(eligibleTotal(rules, lines), 0);
});

test("a line missing the relevant id cannot satisfy a rule", () => {
  assert.equal(matchesRule({ type: "BRAND", value: "3" }, { categorySlug: "x" }), false);
});

test("normalisation drops malformed rows", () => {
  const rules = normalizeRules([
    { scope_type: "CATEGORY", scope_value: "a" },
    { scope_type: "NOPE", scope_value: "b" },
    { scope_type: "CATEGORY", scope_value: "" },
  ]);
  assert.deepEqual(rules, [{ type: "CATEGORY", value: "a" }]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm test -- lib/__tests__/giftCardApplicability.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `backend/lib/giftCardApplicability.js`:

```javascript
// Pure applicability maths. A rule list is empty when the card applies to
// everything; a non-empty list is OR-ed, and an order line satisfying any rule
// contributes its full value.
const TYPES = new Set(["PRODUCT", "BRAND", "CATEGORY"]);

export function normalizeRules(rows) {
  return (rows || [])
    .map((r) => ({
      type: String(r.scope_type ?? r.type ?? "").toUpperCase(),
      value: String(r.scope_value ?? r.value ?? "").trim(),
    }))
    .filter((r) => TYPES.has(r.type) && r.value !== "");
}

export function matchesRule(rule, line) {
  if (!rule || !line) return false;
  const v = String(rule.value);
  if (rule.type === "PRODUCT") {
    return v === String(line.productUuid ?? "") || v === String(line.productId ?? "");
  }
  if (rule.type === "BRAND") {
    return line.brandId != null && v === String(line.brandId);
  }
  if (rule.type === "CATEGORY") {
    return v === String(line.categorySlug ?? "") || v === String(line.categoryId ?? "");
  }
  return false;
}

function lineValue(line) {
  return round2((Number(line.price) || 0) * (Number(line.quantity) || 0));
}

export function eligibleTotal(rules, lines) {
  const list = rules || [];
  const all = lines || [];
  if (list.length === 0) {
    return round2(all.reduce((s, l) => s + lineValue(l), 0));
  }
  return round2(
    all.reduce((s, l) => (list.some((r) => matchesRule(r, l)) ? s + lineValue(l) : s), 0)
  );
}

export function scopeSummary(rules) {
  const list = rules || [];
  if (list.length === 0) return "Any product";
  const parts = list.slice(0, 3).map((r) => `${r.type.toLowerCase()}: ${r.value}`);
  return parts.join(", ") + (list.length > 3 ? ` +${list.length - 3} more` : "");
}

function round2(v) {
  return Math.round((Number(v) || 0) * 100) / 100;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm test -- lib/__tests__/giftCardApplicability.test.mjs`
Expected: PASS, 8 tests

- [ ] **Step 5: Verify lint**

Run: `cd backend && npm run lint`
Expected: 0 errors

---

### Task 7: Restricted wallet bucket allocation

**Files:**
- Create: `backend/lib/giftCardBuckets.js`
- Test: `backend/lib/__tests__/giftCardBuckets.test.mjs`

**Interfaces:**
- Produces:
  - `eligibleByScope(rules, lines)` → `Map<string, number>` keyed by a stable scope key
  - `spendableBuckets(transactions)` → `[{ id, remaining, rules }]`
  - `allocateSpend({ buckets, lines, total })` →
    `{ allocations: [{ transactionId, amount }], spent, residual, breakdown }`
  - `scopeKey(rules)` → string, `"*"` for unrestricted

A `bucket` is `{ id, remaining, rules }`. `rules` come from
`normalizeRules`. Restricted buckets are spent before unrestricted ones so
short-dated value is not stranded.

- [ ] **Step 1: Write the failing test**

Create `backend/lib/__tests__/giftCardBuckets.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { allocateSpend, spendableBuckets, scopeKey } from "../giftCardBuckets.js";

const lines = [
  { productUuid: "rice", categorySlug: "grains-pulses", price: 400, quantity: 1 },
  { productUuid: "tur", categorySlug: "spices-masalas", price: 100, quantity: 3 },
];

test("scope key is * for unrestricted and stable otherwise", () => {
  assert.equal(scopeKey([]), "*");
  assert.equal(scopeKey([{ type: "CATEGORY", value: "a" }]), scopeKey([{ type: "CATEGORY", value: "a" }]));
  assert.notEqual(scopeKey([{ type: "CATEGORY", value: "a" }]), scopeKey([{ type: "CATEGORY", value: "b" }]));
});

test("fully spent buckets drop out", () => {
  const out = spendableBuckets([
    { id: 1, amount: 100, rules: [] },
    { id: 2, amount: 0, rules: [] },
  ]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 1);
  assert.equal(out[0].remaining, 100);
});

test("a restricted bucket cannot pay for an ineligible basket", () => {
  const buckets = [{ id: 1, remaining: 1000, rules: [{ type: "CATEGORY", value: "spices-masalas" }] }];
  const riceOnly = [{ productUuid: "rice", categorySlug: "grains-pulses", price: 400, quantity: 1 }];
  const res = allocateSpend({ buckets, lines: riceOnly, total: 400 });
  assert.equal(res.spent, 0);
  assert.equal(res.residual, 400);
  assert.equal(res.allocations.length, 0);
});

test("a restricted bucket is capped at the eligible portion", () => {
  // 1000 credit restricted to spices; only 300 of this basket is spices.
  const buckets = [{ id: 1, remaining: 1000, rules: [{ type: "CATEGORY", value: "spices-masalas" }] }];
  const res = allocateSpend({ buckets, lines, total: 700 });
  assert.equal(res.spent, 300);
  assert.equal(res.residual, 400);
});

test("restricted buckets are spent before unrestricted ones", () => {
  const buckets = [
    { id: 1, remaining: 1000, rules: [] },
    { id: 2, remaining: 300, rules: [{ type: "CATEGORY", value: "spices-masalas" }] },
  ];
  const res = allocateSpend({ buckets, lines, total: 700 });
  assert.deepEqual(res.allocations, [
    { transactionId: 2, amount: 300 },
    { transactionId: 1, amount: 400 },
  ]);
  assert.equal(res.spent, 700);
  assert.equal(res.residual, 0);
});

test("a bucket is never drawn below zero", () => {
  const buckets = [{ id: 1, remaining: 250, rules: [] }];
  const res = allocateSpend({ buckets, lines, total: 900 });
  assert.equal(res.spent, 250);
  assert.equal(res.residual, 650);
});

test("the split is reported so the shopper can see it", () => {
  const buckets = [
    { id: 7, remaining: 100, rules: [{ type: "CATEGORY", value: "spices-masalas" }] },
  ];
  const res = allocateSpend({ buckets, lines, total: 700 });
  assert.equal(res.breakdown.length, 1);
  assert.equal(res.breakdown[0].label, "Spices & Masalas");
  assert.equal(res.breakdown[0].amount, 100);
});

test("nothing allocated when the order is empty", () => {
  const res = allocateSpend({ buckets: [{ id: 1, remaining: 100, rules: [] }], lines: [], total: 0 });
  assert.equal(res.spent, 0);
  assert.equal(res.allocations.length, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm test -- lib/__tests__/giftCardBuckets.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

Create `backend/lib/giftCardBuckets.js`:

```javascript
import { eligibleTotal, scopeSummary } from "./giftCardApplicability.js";

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

export function scopeKey(rules) {
  const list = rules || [];
  if (list.length === 0) return "*";
  return list
    .map((r) => `${r.type}:${r.value}`)
    .sort()
    .join("|");
}

export function spendableBuckets(transactions) {
  return (transactions || [])
    .map((t) => ({
      id: t.id,
      remaining: round2(Number(t.remaining ?? 0)),
      rules: t.rules || [],
      label: scopeSummary(t.rules || []),
    }))
    .filter((b) => b.remaining > 0);
}

export function allocateSpend({ buckets, lines, total }) {
  const target = round2(total);
  const caps = new Map();
  for (const b of buckets || []) {
    caps.set(scopeKey(b.rules), eligibleTotal(b.rules, lines));
  }

  // Restricted first: scarce, short-dated value must not be stranded in an
  // unrestricted pot that gets spent on something it was never for.
  const ordered = [...(buckets || [])].sort((a, b) => {
    const ka = scopeKey(a.rules);
    const kb = scopeKey(b.rules);
    if (ka === "*" && kb !== "*") return 1;
    if (kb === "*" && ka !== "*") return -1;
    return b.remaining - a.remaining;
  });

  const allocations = [];
  const breakdown = [];
  let left = target;
  for (const b of ordered) {
    if (left <= 0) break;
    const cap = caps.get(scopeKey(b.rules));
    const room = Math.min(left, b.remaining, cap);
    if (room <= 0) continue;
    const amount = round2(room);
    allocations.push({ transactionId: b.id, amount });
    breakdown.push({ label: b.label, amount });
    left = round2(left - amount);
  }

  return { allocations, spent: round2(target - left), residual: left, breakdown };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm test -- lib/__tests__/giftCardBuckets.test.mjs`
Expected: PASS, 8 tests

- [ ] **Step 5: Verify the Review Focus case explicitly**

Confirm "a restricted credit meeting an ineligible basket contributes zero" is
pinned by the third test above. Expected: that test passes and asserts
`res.spent === 0`.

- [ ] **Step 6: Verify lint**

Run: `cd backend && npm run lint`
Expected: 0 errors

---

## Phase 3 — Backend services

### Task 8: Code model

**Files:**
- Create: `backend/lib/models/giftCardCode.js`

**Interfaces:**
- Consumes: `generateCode`, `hashCode`, `codeLast4` from Task 2
- Produces:
  - `createCodes({ purchaseId, giftCardId, denominationUuid, quantity, unitValue, unitPrice, sender, recipient, message, validForDays, startsAt })` → `[{ id, uuid, code }]` — full codes returned **once**
  - `findByHash(hash)` → row or null (raw, unmasked)
  - `findByUuid(uuid)` → masked row or null
  - `listForCustomer({ email, customerId })` → masked rows
  - `markStatus(ids, status, extra)` → affected count
  - `dueForDelivery(now)` → rows

- [ ] **Step 1: Write the model**

Create `backend/lib/models/giftCardCode.js` using the project's existing model
style (see `backend/lib/models/giftCard.js`): a plain exported object, `pool`
imported from `../db`, and `paginate` from `../pagination` for lists.

Key requirements, all of which have bitten this project before:

- `createCodes` inserts all N rows in **one transaction** on a single client,
  and on a `23505` collision regenerates only the colliding code and retries
  (up to 5 attempts), because every card needs a unique hash.
- Returns plaintext codes in the result and **never stores or logs them**.
- Status starts `PENDING_PAYMENT`; callers move it to `UNUSED` after payment.
- `listForCustomer` excludes `PENDING_PAYMENT`, and never returns `code_hash`.
- Masks codes the way `GiftCard.maskRow` does.

- [ ] **Step 2: Verify the model imports cleanly**

```bash
cd backend
node --input-type=module -e "
import { loadEnv } from './scripts/lib/env.mjs'; loadEnv();
const m = await import('./lib/models/giftCardCode.js');
console.log(Object.keys(m.GiftCardCode).join(','));
"
```

Expected: the interface names above.

- [ ] **Step 3: Verify lint**

Run: `cd backend && npm run lint`
Expected: 0 errors

---

### Task 9: Wallet model

**Files:**
- Create: `backend/lib/models/wallet.js`

**Interfaces:**
- Consumes: `spendableBuckets`, `allocateSpend` from Task 7
- Produces:
  - `getBalance(customerId)` → number
  - `bucketsFor(customerId)` → `[{ id, remaining, rules }]`
  - `creditInTx(client, { customerId, type, amount, codeId, metadata, reference })` → `{ balance }`
  - `debitInTx(client, { customerId, total, lines })` → `{ spent, residual, allocations, breakdown }`
  - `refundInTx(client, { customerId, allocations, reference })` → restores to the same buckets
  - `listLedger(customerId, { page, limit })` → `{ rows, pagination }`
  - `ensureWallet(client, customerId)`

`creditInTx` **must** accept the caller's client so a claim can be one
transaction. It must not start its own transaction.

- [ ] **Step 1: Write the model**

Create `backend/lib/models/wallet.js`.

Critical properties:

- `ensureWallet` uses `INSERT ... ON CONFLICT (customer_id) DO NOTHING`, then
  the caller locks with `SELECT ... FOR UPDATE`.
- `debitInTx` locks the wallet row first, then computes allocations from
  `bucketsFor`, then inserts one `PURCHASE_DEBIT` ledger row per allocation
  carrying the same `metadata.applicability` the credit had — so a refund can
  restore to the correct bucket.
- `refundInTx` takes the allocations from the original debit and credits each
  original bucket id back, not a generic pool. This is the Review Focus case
  "a refund restores the same buckets".
- Every function round2's its money.

- [ ] **Step 2: Verify the model imports and exposes the interface**

Run the same import check as Task 8 Step 2 against `./lib/models/wallet.js`.
Expected: `ensureWallet, getBalance, bucketsFor, creditInTx, debitInTx, refundInTx, listLedger`

- [ ] **Step 3: Verify lint**

Run: `cd backend && npm run lint`
Expected: 0 errors

---

### Task 10: Atomic one-time claim

**Files:**
- Create: `backend/lib/services/claimGiftCard.js`
- Test: `backend/lib/__tests__/claimGiftCard.test.mjs` (validation rules, no DB)
- Test: `backend/scripts/claim-race-check.mjs` (real concurrency check against the database, run manually)

**Interfaces:**
- Consumes: `findByHash`, wallet `creditInTx`/`ensureWallet`
- Produces:
  - `validateClaimable({ code, now, customer, rules })` → `null | reason string`
  - `claimGiftCard({ code, customer })` → `{ credited, balance, codeUuid }`
  - Throws `GiftCardError` with a shopper-safe `message` for every rejection.

- [ ] **Step 1: Write the failing validation test**

Create `backend/lib/__tests__/claimGiftCard.test.mjs`:

```javascript
import test from "node:test";
import assert from "node:assert/strict";
import { validateClaimable } from "../services/claimGiftCard.js";

const now = new Date("2026-06-01T00:00:00.000Z");
const base = {
  code: { status: "UNUSED", expires_at: null, recipient_customer_id: null },
  customer: { id: 1 },
  rules: [],
};

test("a plain unused card is claimable", () => {
  assert.equal(validateClaimable({ ...base, now }), null);
});

test("an already redeemed card is refused", () => {
  assert.match(
    validateClaimable({ ...base, code: { ...base.code, status: "REDEEMED" }, now }),
    /already been claimed/i
  );
});

test("a revoked card is refused", () => {
  assert.match(validateClaimable({ ...base, code: { ...base.code, status: "REVOKED" }, now }), /revoked/i);
});

test("a card whose expiry has passed is refused", () => {
  const reason = validateClaimable({
    ...base,
    code: { ...base.code, expires_at: "2026-05-01T00:00:00.000Z" },
    now,
  });
  assert.match(reason, /expired/i);
});

test("a pending payment card cannot be claimed", () => {
  assert.match(
    validateClaimable({ ...base, code: { ...base.code, status: "PENDING_PAYMENT" }, now }),
    /not ready/i
  );
});

test("a card owned by another customer is refused", () => {
  const reason = validateClaimable({
    ...base,
    code: { ...base.code, recipient_customer_id: 99 },
    now,
  });
  assert.match(reason, /another account/i);
});

test("the owner may claim their own card", () => {
  const reason = validateClaimable({
    ...base,
    code: { ...base.code, recipient_customer_id: 1 },
    now,
  });
  assert.equal(reason, null);
});

test("a missing code is refused without leaking whether it exists", () => {
  assert.match(validateClaimable({ ...base, code: null, now }), /not valid/i);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd backend && npm test -- lib/__tests__/claimGiftCard.test.mjs`
Expected: FAIL — module not found

- [ ] **Step 3: Write the service**

Create `backend/lib/services/claimGiftCard.js`. It must export both
`validateClaimable` (pure, DB-free) and `claimGiftCard`.

`validateClaimable` checks in this order and returns a shopper-safe string:
missing → not valid; not `UNUSED` (distinguish redeemed / revoked /
pending) → the matching reason; `expires_at` in the past → expired; owned by
another customer → another account; otherwise `null`.

`claimGiftCard` performs, on **one** client in **one** transaction:

```
BEGIN
  SELECT * FROM gift_card_codes WHERE code_hash = $1 FOR UPDATE
  -- a second concurrent claim now blocks here, then sees status='REDEEMED'
  re-run validateClaimable against the LOCKED row
  ensureWallet + SELECT wallet FOR UPDATE
  INSERT gift_card_redemptions     -- UNIQUE(code_id) is the real guarantee
  UPDATE wallet SET balance = balance + value
  INSERT customer_reward_transactions (type='GIFT_CARD_CREDIT', metadata.applicability)
  UPDATE gift_card_codes SET status='REDEEMED', claimed_at=now()
COMMIT
```

Catch `23505` on `gift_card_redemptions.code_id` and translate it to
"already claimed" rather than surfacing a database error.

- [ ] **Step 4: Run the validation test to verify it passes**

Run: `cd backend && npm test -- lib/__tests__/claimGiftCard.test.mjs`
Expected: PASS, 8 tests

- [ ] **Step 5: Prove the double-claim is impossible under real concurrency**

Create `backend/scripts/claim-race-check.mjs` that: issues a code for a
throwaway customer, then fires **two** `claimGiftCard` calls in parallel
against the real database, and asserts exactly one succeeded and the wallet was
credited exactly once.

```bash
cd backend && node scripts/claim-race-check.mjs
```

Expected: prints `credited exactly once: true` and exits 0.
Delete the throwaway customer and code when it finishes.

This is the Review Focus case #1. Do not accept a green unit test as
substitute for it.

- [ ] **Step 6: Verify lint and the full suite**

Run: `cd backend && npm run lint && npm test`
Expected: 0 errors, all passing

---

### Task 11: Purchase and code issuance

**Files:**
- Create: `backend/lib/services/purchaseGiftCard.js`

**Interfaces:**
- Consumes: `createPaymentProvider` (Task 1), `createCodes` (Task 8)
- Produces:
  - `purchaseGiftCard({ customer, giftCard, denomination, quantity, recipient, sender, message, channels, sendLater, scheduledFor, providerName })` → `{ purchase, codes, deliveries, totalPaid, orderNumber }`
  - Codes are `PENDING_PAYMENT` until the provider settles, then `UNUSED`.
  - On provider failure: purchase `FAILED`, **no codes issued**.

- [ ] **Step 1: Write the service**

Create `backend/lib/services/purchaseGiftCard.js` implementing design doc §5.1:

1. Insert `gift_card_purchases` with `payment_status = 'PENDING'`. **No code
   exists yet** — an abandoned checkout must leave nothing usable.
2. `provider.createIntent(...)`, then `provider.confirm(...)`.
3. On `FAILED`: set `payment_status='FAILED'` and `failure_reason`, return.
4. On `PAID`: in **one** transaction set `payment_status='PAID'`, create N codes
   as `PENDING_PAYMENT`, then flip them to `UNUSED` with `activated_at`.
5. Insert one `gift_card_deliveries` row per requested channel.
6. Book an `orders` row **only** once payment succeeded, so an abandoned
   purchase never appears in sales figures. Reuse the existing order-number
   scheme from `backend/lib/models/order.js` (`MAX(id)+1`) rather than inventing
   a second sequence.
7. Validate the template's `quantity_cap` and its `starts_at`/`ends_at` window
   before step 1.

- [ ] **Step 2: Verify the service imports**

Run the standard import check against `./lib/services/purchaseGiftCard.js`.
Expected: `purchaseGiftCard`

- [ ] **Step 3: Verify lint**

Run: `cd backend && npm run lint`
Expected: 0 errors

---

### Task 12: Delivery

**Files:**
- Create: `backend/lib/services/deliverGiftCard.js`
- Modify: `backend/lib/mail.js` (add `quantity` support if not already present)

**Interfaces:**
- Produces:
  - `deliver(codeId, { channel, scheduledFor })` → delivery row
  - `deliverDue(now)` → `{ sent, failed, skipped }`, idempotent
  - Email is real. **SMS records `SKIPPED` with a reason** — no provider is
    connected and it must never be reported as sent.

- [ ] **Step 1: Write the service**

Create `backend/lib/services/deliverGiftCard.js`:

- `deliver` upserts on `UNIQUE (code_id, channel)`, so a retry updates the row
  instead of duplicating it.
- `EMAIL` calls `sendGiftCardEmail`. On success set `SENT` + `sent_at`; on
  failure set `FAILED` + `failure_reason` and **leave the code `UNUSED`** —
  the shopper paid, so the value must stay recoverable.
- `SMS` sets `SKIPPED` with `failure_reason = 'No SMS provider configured'`.
  Never `SENT`.
- `deliverDue` claims `PENDING` rows whose `scheduled_for <= now`, in
  ascending date order, limited to 100. Re-runnable: a claimed row flips status
  in the same pass.

- [ ] **Step 2: Verify lint**

Run: `cd backend && npm run lint`
Expected: 0 errors

---

## Phase 4 — APIs

### Task 13: Admin gift card APIs

**Files:**
- Create: `backend/app/api/gift-cards/templates/route.js`
- Create: `backend/app/api/gift-cards/templates/[id]/route.js`
- Create: `backend/app/api/gift-cards/codes/route.js`
- Create: `backend/app/api/gift-cards/codes/[id]/route.js`
- Create: `backend/app/api/gift-cards/reports/route.js`
- Modify: `backend/lib/reports/giftCardReports.js`
- Modify: `shared/constants.js`

**Interfaces:**
- All admin routes use `authorize(KEY_PERMISSIONS.GIFT_CARDS_*)` and
  `corsHeaders()`, matching the existing gift-card routes.
- New permissions: `GIFT_CARD_TEMPLATES_VIEW/CREATE/UPDATE/DELETE`,
  `GIFT_CARD_CODES_REVOKE`, `GIFT_CARD_REPORTS_VIEW`. Add them to
  `shared/constants.js` **and** seed them in a migration, or the routes will
  403 for every role.
- `giftCardReports.summary({ from, to, giftCardId })` →
  `{ created, sold, salesValue, unused, redeemed, expired, revoked, credited }`

- [ ] **Step 1: Add permissions**

Add the new keys to `KEY_PERMISSIONS` in `shared/constants.js`, then a
migration inserting the `permissions` rows and granting them to the roles that
already hold `gift_cards.view`, so behaviour is unchanged for existing admins.

Run: `cd backend && npm run migrate` → `apply`, then again → `skip`.

- [ ] **Step 2: Write the reports aggregator**

Create `backend/lib/reports/giftCardReports.js` with a single aggregate query
over `gift_card_codes` and `gift_card_purchases`, and a second for the credited
total from `customer_reward_transactions` where `type='GIFT_CARD_CREDIT'`.
`EXPIRED` is counted as `UNUSED` codes whose `expires_at < now()`, never as a
stored status.

- [ ] **Step 3: Write the template routes**

`GET /api/gift-cards/templates` supports `search`, `status`, `page`, `limit`.
`POST` validates: name required, at least one denomination when
`source = 'FIXED'`, `quantity_cap >= 1` when set, `ends_at > starts_at` when
both set, and `min_order_amount >= 0`.
`PATCH /[id]` allows editing and never edits a balance.

Applicability is written to `gift_card_applicability` as full replace
(delete + insert in one transaction).

- [ ] **Step 4: Write the code routes**

`GET /api/gift-cards/codes` supports `search`, `status`, `giftCardId`, `page`.
Search hashes the term so admins can find a code by its plaintext, reusing the
fix already made to `GiftCard.list`.
`PATCH /[id]` supports `REVOKED` with a required `revoke_reason`, and a
`resend` action that calls `deliver`.

- [ ] **Step 5: Write the reports route**

`GET /api/gift-cards/reports` returns the summary, and accepts the filters
design doc §3.4 names.

- [ ] **Step 6: Verify every route compiles and guards auth**

```bash
cd backend
for f in $(find app/api/gift-cards -name route.js); do node --check "$f" || echo "SYNTAX FAIL $f"; done
for u in api/gift-cards/templates api/gift-cards/codes api/gift-cards/reports; do
  printf "%-34s %s\n" "$u" "$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/$u)"
done
```

Expected: no syntax failures; every route `401` unauthenticated. A `500` here
means the route does not compile — fix before continuing.

- [ ] **Step 7: Verify lint and tests**

Run: `cd backend && npm run lint && npm test`
Expected: 0 errors, all passing

---

### Task 14: Customer gift card APIs

**Files:**
- Create: `backend/app/api/store/gift-cards/route.js` (rewrite: list purchasable templates)
- Create: `backend/app/api/store/gift-cards/buy/route.js`
- Create: `backend/app/api/store/gift-cards/mine/route.js`
- Create: `backend/app/api/store/gift-cards/redeem/route.js`
- Create: `backend/app/api/store/wallet/route.js` (rewrite: wallet + ledger)

**Interfaces:**
- `GET /api/store/gift-cards` — **public**, no auth. Active templates with
  denominations, applicability summary, validity and price.
- `POST /api/store/gift-cards/buy` — `authenticate()`, then `purchaseGiftCard`.
- `GET /api/store/gift-cards/mine` — `authenticate()`. Cards received **or**
  purchased by the customer, masked, with sender/recipient/dates/status.
- `POST /api/store/gift-cards/redeem` — `authenticate()`, then `claimGiftCard`.
  Shares the per-client throttle from `backend/lib/giftCardGuards.js` with the
  quote endpoint, so guessing a code is throttled on both entry points.
- `GET /api/store/wallet` — `authenticate()`. `{ balance, buckets, ledger }`.

- [ ] **Step 1: Write the public store route**

It must not require auth. Return only `status = 'ACTIVE'` templates inside
their `starts_at`/`ends_at` window, and never expose internal columns.

- [ ] **Step 2: Write the buy route**

Validate the same bounds the existing purchase route uses (min ₹100, max
₹50,000, quantity 1–20), require an email **or** mobile for the recipient, and
call `purchaseGiftCard`. Return every generated code **once** — they are
unrecoverable afterwards.

- [ ] **Step 3: Write the mine route**

Match on `recipient_customer_id` **or** `recipient_email`, plus cards the
customer purchased. Exclude `PENDING_PAYMENT`. Mask codes. Return derived
`EXPIRED` at read time.

- [ ] **Step 4: Write the redeem route**

Throttle first, then `claimGiftCard`. Map every `GiftCardError` to a 400 with
its shopper-safe message. Return `{ credited, balance }`.

- [ ] **Step 5: Rewrite the wallet route**

Return the balance, the spendable buckets with their scope labels, and a
paginated ledger. A signed-out shopper gets 401.

- [ ] **Step 6: Verify the routes**

```bash
cd backend
for f in $(find app/api/store -path '*gift-cards*' -o -path '*wallet*' | grep route.js); do node --check "$f" || echo "FAIL $f"; done
curl -s -o /dev/null -w "public store: %{http_code}\n" http://localhost:3000/api/store/gift-cards
curl -s -o /dev/null -w "wallet:       %{http_code}\n" http://localhost:3000/api/store/wallet
```

Expected: no syntax failures; public store `200`; wallet `401`.

- [ ] **Step 7: Verify lint and tests**

Run: `cd backend && npm run lint && npm test`
Expected: 0 errors, all passing

---

### Task 15: Checkout spends the wallet

**Files:**
- Modify: `backend/app/api/store/checkout/quote/route.js`
- Modify: `backend/app/api/orders/store/route.js`
- Modify: `backend/lib/giftCardRules.js` (stop spending cards directly)
- Test: `backend/lib/__tests__/giftCardRules.test.mjs` (remove the now-obsolete
  `allocateAcrossCards` allocation tests, keep the applicability ones)

**Interfaces:**
- Consumes: `debitInTx` (Task 9)
- `quote` accepts `useWallet: true` and returns `{ wallet: { spent, residual, breakdown } }`
- Order placement debits inside its existing transaction and writes one
  `PURCHASE_DEBIT` row per allocation.

- [ ] **Step 1: Change the quote endpoint**

Replace the `useGiftCard` wallet branch with `useWallet`. Return the
`breakdown` so the storefront can show which bucket paid for what.

- [ ] **Step 2: Change order placement**

Inside the existing transaction, after the order row exists (so the ledger can
reference `order_id`): lock the wallet, compute allocations, debit, write one
`PURCHASE_DEBIT` per allocation, and treat any residual as the payable amount.

Remove the direct card-redemption path. The old `lockAndAllocate` call and
`gift_card_transactions` REDEEM insert go away.

- [ ] **Step 3: Update the tests**

Remove the `allocateAcrossCards` describe blocks. **Keep** every applicability
test — those rules are still enforced at claim time.

Run: `cd backend && npm test`
Expected: all passing, with the obsolete allocation tests gone.

- [ ] **Step 4: Add a refund hook**

On order cancellation or refund, call `wallet.refundInTx` with the original
allocations. This is Review Focus case #5.

- [ ] **Step 5: Prove two concurrent checkouts cannot overdraw**

Write `backend/scripts/wallet-race-check.mjs`: give a throwaway customer a
fixed balance, fire two parallel checkouts each for more than the balance, and
assert the wallet never goes negative and the order totals respect the
residual.

Run: `cd backend && node scripts/wallet-race-check.mjs`
Expected: exits 0, prints the balance is non-negative.

- [ ] **Step 6: Verify lint**

Run: `cd backend && npm run lint`
Expected: 0 errors

---

## Phase 5 — Frontend

### Task 16: Admin template screens

**Files:**
- Create: `frontend/src/pages/GiftCardTemplates.jsx`
- Create: `frontend/src/components/GiftCardTemplateForm.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/services/giftCards.js`
- Modify: `frontend/src/index.css`

**Interfaces:**
- Consumes: the template APIs from Task 13
- Reuses `DataPage` with `permissions={{ view: "gift_cards.templates.view", ... }}`

- [ ] **Step 1: Add the service functions**

`listGiftCardTemplates`, `createGiftCardTemplate`,
`updateGiftCardTemplate`, following the existing
`frontend/src/services/giftCards.js` pattern exactly.

- [ ] **Step 2: Build the list**

`DataPage` with columns: image, name, type, status, price range, validity,
window, sold/stock. Filters for status and type.

- [ ] **Step 3: Build the form**

Fields per design doc §3.2. The applicability picker reuses the cascading
pattern already proven in `frontend/src/components/GiftCardForm.jsx`
(`gc-scope-modes` + `gc-chip` + chip lists), reading brands/categories/products
from `getGiftCardReferences()`.

**Wrap the form in `<form className="admin-form resource-form" onSubmit={...}>`.**
All admin input styling is scoped to `.admin-form`; without it the inputs render
as raw browser defaults. This already shipped as a bug once.

- [ ] **Step 4: Register routes**

In `frontend/src/App.jsx`, add `/gift-cards/templates` and
`/gift-cards/templates/:id` **before** the `/gift-cards/:id` route, or `:id`
will swallow them.

- [ ] **Step 5: Verify build and lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: build succeeds, 0 lint errors

---

### Task 17: Admin codes and reports screens

**Files:**
- Create: `frontend/src/pages/GiftCardCodes.jsx`
- Create: `frontend/src/pages/GiftCardReports.jsx`
- Modify: `frontend/src/App.jsx`
- Modify: `frontend/src/services/giftCards.js`
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Codes list**

`DataPage` over the codes API. Row actions: revoke (with a required reason in a
confirm panel — never a bare instant-delete button), resend delivery, view.

- [ ] **Step 2: Reports page**

Stat cards for the eight figures, plus filters. Reuse the existing
`stat-grid` / `stat-card` classes.

- [ ] **Step 3: Verify build and lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: build succeeds, 0 errors

---

### Task 18: Customer store and purchase

**Files:**
- Modify: `frontend/src/pages/Storefront.jsx` (E-Cards shelf, buy flow)
- Modify: `frontend/src/services/storefront.js`
- Modify: `frontend/src/styles/Storefront.css`

**Interfaces:**
- Consumes: `GET /api/store/gift-cards` and `POST /api/store/gift-cards/buy`
- Purchase form gains: for-myself / as-a-gift, sender name, recipient email or
  mobile, delivery channel checkboxes, send now or later.

- [ ] **Step 1: Rework the shelf**

Show the template's real art, name, description, denominations, applicability
summary and validity. Keep the "not the cards you own" wording added earlier —
it solved a real confusion.

- [ ] **Step 2: Rework the buy flow**

Four steps: template and amount, who it is for, message, delivery and timing.
Channel checkboxes render only for channels the API reports as configured.

- [ ] **Step 3: Success screen**

List every generated code, prominently, with a warning that they are shown
once. This is the only moment the shopper can copy them.

- [ ] **Step 4: Verify build and lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: build succeeds, 0 errors

---

### Task 19: My gift cards, redeem, wallet

**Files:**
- Create: `frontend/src/pages/RedeemGiftCard.jsx`
- Create: `frontend/src/pages/WalletPanel.jsx`
- Modify: `frontend/src/pages/Storefront.jsx` (route the new views)
- Modify: `frontend/src/styles/Storefront.css`

- [ ] **Step 1: My gift cards**

Cards received and purchased, with masked code, value, sender, recipient,
dates, status and remaining balance. Expired and revoked cards shown faded,
consistent with the current wallet behaviour.

- [ ] **Step 2: Redeem screen**

One code input, a clear result panel showing the credited amount and the new
balance, and the reason when a claim is refused.

- [ ] **Step 3: Wallet page**

Balance, then bucket breakdown with scope labels, then a ledger table.

- [ ] **Step 4: Verify build and lint**

Run: `cd frontend && npm run build && npm run lint`
Expected: build succeeds, 0 errors

---

## Phase 6 — Verification

### Task 20: Class audit

**Files:**
- Create: `frontend/scripts/audit-classes.mjs`
- Modify: `frontend/package.json` (add `"audit:classes"` script)

**Interfaces:**
- Produces: a non-zero exit and a list of offending classes when JSX references
  a class that no stylesheet defines.

- [ ] **Step 1: Write the audit**

Scan every `.jsx` in `src/`, collect `className="..."` and template-literal
class names, strip `${...}` expressions, and compare against every selector in
`src/index.css`, `src/styles/Storefront.css` and any other `src/**/*.css`.
Ignore known global utilities (`sf-btn`, `primary`, `muted`, `small`,
`ok-text`, `green`, `ghost`, `danger`).

Three bugs shipped in this project from undefined classes. This makes it
impossible to ship a fourth.

- [ ] **Step 2: Run it and fix everything it finds**

Run: `cd frontend && npm run audit:classes`
Expected: exits 0. Fix every reported class before continuing.

- [ ] **Step 3: Wire it into the build**

Add `"build": "oxlint && node scripts/audit-classes.mjs && vite build"` so the
audit gates merges.

Run: `cd frontend && npm run build`
Expected: succeeds

---

### Task 21: End-to-end verification

**Files:**
- Create: `backend/scripts/giftcard-e2e.mjs`

- [ ] **Step 1: Write the end-to-end script**

Drive the real HTTP API with the sandbox provider, in this order, and assert
each step:

1. Admin creates a template restricted to one category, with a discount.
2. It appears in `GET /api/store/gift-cards` unauthenticated.
3. A customer buys 3 of them, paying `3 × price`.
4. Exactly 3 codes exist, all `UNUSED`, and the purchase is `PAID`.
5. The codes appear for the recipient in `/api/store/gift-cards/mine`.
6. Recipient claims one code → wallet credited, code `REDEEMED`.
7. Claiming the same code again → refused, no second credit.
8. A cart of only ineligible items spends 0 from a restricted bucket.
9. A mixed cart spends only the eligible portion.
10. A failed payment issues no codes.

Print a pass/fail line per assertion. Exit non-zero on any failure.

- [ ] **Step 2: Run it**

Run: `cd backend && node scripts/giftcard-e2e.mjs`
Expected: all assertions pass

- [ ] **Step 3: Clean up test data**

The script must delete the template, codes, wallet and customer it created.

- [ ] **Step 4: Final full verification**

```bash
cd backend
npm run migrate          # expect all skips
npm test                 # expect all passing
npm run lint             # expect 0 errors
cd ../frontend
npm run build            # expect success
npm run lint             # expect 0 errors
```

- [ ] **Step 5: Report honestly**

State what was verified, and restate the four items that remain blocked on the
user: live payment keys, an SMS provider, an image API key, and a scheduler for
expiry reminders and scheduled deliveries.
