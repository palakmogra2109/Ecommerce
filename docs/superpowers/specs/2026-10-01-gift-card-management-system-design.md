# E-Gift Card Management System — Design

**Date:** 2026-10-01
**Status:** Approved
**Scope:** Admin panel, customer storefront, wallet, and the supporting backend, schema and migrations.

---

## 1. Purpose and the decision that shapes everything

Build the E-Gift Card system described in the requirements: an admin panel that
creates and governs gift card products, a customer-facing E-Cards store, secure
code generation, delivery, a one-time claim flow, and a reward balance that the
claimed value feeds.

**A gift card code is claimed exactly once.** Claiming credits its full value to
the customer's wallet balance, after which the code is permanently `REDEEMED`
and can never be claimed again. This is stricter than the requirements' optional
"partial redemption" clause, and it was chosen deliberately: one-time claiming
makes double-crediting structurally impossible rather than merely unlikely.

**Consequence:** the existing behaviour where a gift card is spent directly at
checkout is replaced. Checkout now spends **wallet balance**. The customer-facing
UI shape is unchanged — the same "Use my balance" checkbox — but it is backed by
the wallet instead of by unclaimed cards.

### Prior state being replaced

| Existing | Fate |
|---|---|
| `gift_cards` holding issued cards | Repurposed as admin *templates* |
| Codes on `gift_cards.code` / `code_hash` | Moved to `gift_card_codes` |
| Synthetic `orders` rows standing in for purchases | Replaced by `gift_card_purchases` |
| JSONB `applicable_*` columns | Normalised into `gift_card_applicability` |
| `gift_card_transactions` | Stays, read-only, as the historical ledger |
| `gift_card_scheduled` | Replaced by `gift_card_deliveries` |
| `gift_card_reservations` | Stays, read-only; superseded by the wallet |
| No wallet at all | Newly built |

Five live cards worth ₹17,244 must be migrated, not discarded. See §10.

---

## 2. Domain model

### 2.1 Entity roles

- **Template** — what the admin configures and the customer browses. Has a name,
  image, description, price, validity and rules. Holds no codes and no balance.
- **Code** — one redeemable unit. Exactly one code per purchased card. Carries the
  value, the sender, the recipient, its own validity window, and a status.
- **Purchase** — a payment record. Created before payment, completed only after
  the provider settles.
- **Applicability** — the product/brand/category restriction set.
- **Delivery** — one row per channel attempt (email, SMS, scheduled send).
- **Redemption** — one row per claim. The idempotency anchor.
- **Wallet** — a per-customer balance plus a ledger of credits and debits.

### 2.2 Tables

All DDL is additive. No existing table is dropped or renamed in place; new
columns are added with defaults so existing rows stay valid.

```
gift_cards                      -- TEMPLATE (repurposed)
  id, uuid                      -- uuid: UNIQUE
  name            TEXT NOT NULL
  description     TEXT NOT NULL DEFAULT ''
  image_url       TEXT
  status          TEXT NOT NULL DEFAULT 'DRAFT'
                  -- DRAFT | ACTIVE | SUSPENDED | CANCELLED
  validity_days   INTEGER        -- null = never expires
  min_order_amount      NUMERIC(12,2) NOT NULL DEFAULT 0
  max_redemption_amount NUMERIC(12,2)
  quantity_cap    INTEGER        -- null = unlimited stock
  starts_at, ends_at TIMESTAMPTZ  -- purchase window
  source          TEXT NOT NULL DEFAULT 'FIXED'   -- FIXED|CUSTOM|PROMOTIONAL
  created_by      BIGINT REFERENCES users(id) ON DELETE SET NULL
  created_at, updated_at

gift_denominations              -- existing; now references a template
  id, uuid, gift_card_id BIGINT REFERENCES gift_cards(id) ON DELETE CASCADE
  label, face_value, selling_price, valid_for_days, is_active, sort_order

gift_card_codes                 -- one redeemable unit
  id, uuid
  gift_card_id      BIGINT REFERENCES gift_cards(id) ON DELETE SET NULL
  denomination_uuid UUID REFERENCES gift_denominations(uuid) ON DELETE SET NULL
  purchase_id       BIGINT REFERENCES gift_card_purchases(id) ON DELETE SET NULL
  -- code is stored as a hash; plaintext exists only at issue and is never
  -- persisted after delivery.
  code_hash  TEXT NOT NULL UNIQUE
  code_last4 TEXT NOT NULL
  value            NUMERIC(12,2) NOT NULL CHECK (value > 0)
  balance          NUMERIC(12,2) NOT NULL   -- value at issue; == value until claimed
  currency         TEXT NOT NULL DEFAULT 'INR'
  status           TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'
                   -- PENDING_PAYMENT | UNUSED | REDEEMED | EXPIRED | REVOKED | SCHEDULED
  sender_name      TEXT
  sender_email     TEXT
  sender_customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL
  recipient_name   TEXT
  recipient_email  TEXT
  recipient_mobile TEXT
  recipient_customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL
  gift_message     TEXT
  purchased_at     TIMESTAMPTZ
  activated_at     TIMESTAMPTZ
  expires_at       TIMESTAMPTZ
  claimed_at       TIMESTAMPTZ
  revoked_at, revoked_by, revoke_reason
  created_at, updated_at

gift_card_purchases
  id, uuid, customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL
  gift_card_id      BIGINT REFERENCES gift_cards(id) ON DELETE SET NULL
  denomination_uuid UUID REFERENCES gift_denominations(uuid) ON DELETE SET NULL
  quantity      INTEGER NOT NULL CHECK (quantity > 0)
  unit_value    NUMERIC(12,2) NOT NULL
  unit_price    NUMERIC(12,2) NOT NULL
  total_value   NUMERIC(12,2) NOT NULL
  total_paid    NUMERIC(12,2) NOT NULL
  payment_provider TEXT NOT NULL
  payment_reference  TEXT
  payment_status TEXT NOT NULL DEFAULT 'PENDING'
                  -- PENDING | PAID | FAILED | REFUNDED
  failure_reason TEXT
  purchased_at, created_at, updated_at

gift_card_applicability
  id, uuid
  gift_card_id BIGINT NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE
  scope_type   TEXT NOT NULL CHECK (scope_type IN ('PRODUCT','BRAND','CATEGORY'))
  scope_value  TEXT NOT NULL       -- uuid, brand id, or category slug
  UNIQUE (gift_card_id, scope_type, scope_value)

gift_card_deliveries
  id, uuid
  code_id     BIGINT NOT NULL REFERENCES gift_card_codes(id) ON DELETE CASCADE
  channel     TEXT NOT NULL CHECK (channel IN ('EMAIL','SMS','SCHEDULED'))
  status      TEXT NOT NULL DEFAULT 'PENDING'
              -- PENDING | SENT | SKIPPED | FAILED
  scheduled_for TIMESTAMPTZ
  sent_at     TIMESTAMPTZ
  failure_reason TEXT
  created_at, updated_at
  -- One attempt per channel per code: a retry updates, never duplicates.
  UNIQUE (code_id, channel)

gift_card_redemptions
  id, uuid
  code_id     BIGINT NOT NULL REFERENCES gift_card_codes(id) ON DELETE CASCADE
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE
  credit_amount NUMERIC(12,2) NOT NULL CHECK (credit_amount > 0)
  balance_before NUMERIC(12,2) NOT NULL
  balance_after  NUMERIC(12,2) NOT NULL
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  -- THE idempotency guarantee. A second claim of the same code cannot be
  -- written, whatever the application code does.
  UNIQUE (code_id)

customer_wallets
  customer_id BIGINT PRIMARY KEY REFERENCES customers(id) ON DELETE CASCADE
  balance    NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance >= 0)
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()

customer_reward_transactions
  id, uuid
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE
  type    TEXT NOT NULL CHECK (type IN ('GIFT_CARD_CREDIT','PURCHASE_DEBIT','ADJUSTMENT','REFUND'))
  amount  NUMERIC(12,2) NOT NULL
  balance_after NUMERIC(12,2) NOT NULL
  code_id BIGINT REFERENCES gift_card_codes(id) ON DELETE SET NULL
  order_id BIGINT REFERENCES orders(id) ON DELETE SET NULL
  reference TEXT
  metadata JSONB NOT NULL DEFAULT '{}'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()

-- One credit per code, enforced at the ledger level as well as on
-- gift_card_redemptions. A partial index, because a code must be credited
-- once while a code may legitimately be referenced by other row types.
CREATE UNIQUE INDEX customer_reward_transactions_code_credit_key
  ON customer_reward_transactions (code_id)
  WHERE type = 'GIFT_CARD_CREDIT';
```

Indexes to create alongside the tables:

```
CREATE INDEX gift_card_codes_status_idx   ON gift_card_codes (status, expires_at);
CREATE INDEX gift_card_codes_recipient_idx ON gift_card_codes (recipient_email);
CREATE INDEX gift_card_codes_recipient_customer_idx
  ON gift_card_codes (recipient_customer_id);
CREATE INDEX gift_card_codes_template_idx ON gift_card_codes (gift_card_id);
CREATE INDEX gift_card_codes_hash_idx     ON gift_card_codes (code_hash);
CREATE INDEX gift_card_purchases_customer_idx ON gift_card_purchases (customer_id, created_at DESC);
CREATE INDEX gift_card_deliveries_due_idx ON gift_card_deliveries (scheduled_for)
  WHERE status = 'PENDING' AND channel = 'SCHEDULED';
CREATE INDEX customer_reward_transactions_customer_idx
  ON customer_reward_transactions (customer_id, created_at DESC);
CREATE INDEX customer_reward_transactions_spendable_idx
  ON customer_reward_transactions (customer_id, type)
  WHERE type = 'GIFT_CARD_CREDIT';
```

### 2.3 Restricted wallet buckets

This is the mechanism that satisfies: *"Do not allow the gift card's restrictions
be bypassed through the reward balance."*

A wallet balance is not a single number. It is a set of **buckets**, each a
credit plus the applicability it inherited from the card it came from.

| Credit | Bucket |
|---|---|
| `GIFT-X7K9-P2LM`, ₹1,000, spices only | `spices-masalas` |
| `GIFT-91KD-M4RT`, ₹500, unrestricted | `∅` |
| `GIFT-KK22-77AB`, ₹250, Nila Organics | `brand:3` |

`customer_reward_transactions.metadata` carries the bucket, e.g.
`{"applicability":[{"type":"CATEGORY","value":"spices-masalas"}]}`.

**Spending rule.** A wallet balance is the sum of buckets with remaining value. To
pay for an order:

1. Compute the order's *eligible* total per applicability scope.
2. Spend from the matching buckets only, restricted buckets first (so scarce,
   short-dated value is not stranded in an unrestricted pot).
3. A restricted bucket may cover at most the eligible portion of the order — the
   same rule that governs direct redemption. A spices-only ₹1,000 credit cannot
   cover more than ₹1,000 of eligible spices, and cannot cover a rice order at all.
4. Unrestricted buckets cover whatever remains.

The split is shown to the customer before payment, so the shopper sees *which*
balance funded *what* rather than a single opaque number.

---

## 3. Admin panel

### 3.1 Gift card list
- Table: image, name, type, status, price range, denominations, sold/stock,
  validity, start–end, created date.
- Search by name, description, image filename. Filter by status, type, and date
  range.
- Row actions: view, edit, activate, suspend, and a link to its codes.

### 3.2 Create / edit a template
| Field | Notes |
|---|---|
| Name | Required |
| Image | URL, or generated SVG art when blank |
| Description | Plain text |
| Amount | One fixed amount, or a set of denominations |
| Type | All products / Specific products / Specific brands / Specific categories |
| Targets | Cascading dropdowns. Brand selection filters the product list. |
| Validity | 7 / 30 / 90 days, 6 months, 1 year, or a custom day count, or never |
| Usage limit | One claim per code (enforced by schema, not a setting) |
| Minimum purchase | Optional |
| Maximum redemption | Optional per-claim cap |
| Status | Draft / Active / Suspended |
| Start and end dates | Purchase window |
| Quantity cap | Optional stock limit |

### 3.3 Codes
- Every code issued from a template, with masked code, value, sender, recipient,
  status, and expiry.
- Actions: revoke (with reason), resend delivery, view ledger.
- Export to CSV.

### 3.4 Reports
Total created, sold, sales value, unused, redeemed, expired, revoked, and total
credited to wallets. Filterable by date, template, type, customer, status, and
amount range.

---

## 4. Customer panel

### 4.1 E-Cards store
Public, browsable before login. Grid of active templates: image, name,
description, denominations, applicability, validity, price, Buy.

### 4.2 Purchase
- Choose a denomination.
- **For myself, or as a gift.**
- Recipient name, email or mobile. Sender name. Optional message.
- Delivery: email, SMS, or both — only channels that are actually configured are
  offered, so an unconfigured channel is never presented as if it works.
- Immediate or scheduled delivery.
- Quantity: N cards, each with its own code, one purchase and one payment.

### 4.3 My gift cards
Purchased-for-me and received cards: image, masked code, value, sender and
recipient, dates, status, and remaining balance. A full code is shown only in the
issue confirmation, once.

### 4.4 Redeem gift card
Enter a code. The server validates and claims it, credits the wallet, and shows
the new balance and the resulting ledger entry.

### 4.5 Wallet
Balance, and a ledger of every credit and debit with date, type, reference, and
running balance.

---

## 5. Core flows

### 5.1 Purchase and issue
```
1. Create gift_card_purchases row            status PENDING_PAYMENT
   (no code exists yet — an abandoned checkout leaves nothing usable)
2. Charge via the payment provider interface
3. On success, in ONE transaction:
     purchase.status = PAID
     for each of N cards:
       code = generate  crypto.randomBytes, store hash + last4
       insert gift_card_codes                status UNUSED
       insert gift_card_deliveries           per requested channel
4. Commit, then deliver outside the transaction
5. On provider failure:
     purchase.status = FAILED, failure_reason recorded, no codes issued
```

Codes are generated **after** payment settles. A pending purchase can never
produce a usable code.

### 5.2 Claim a code
```
BEGIN
  SELECT * FROM gift_card_codes WHERE code_hash = $1 FOR UPDATE
  reject if: missing | not UNUSED | expired | revoked | owned by another
  validate applicability against the customer's identity
  SELECT/INSERT customer_wallets FOR UPDATE
  INSERT gift_card_redemptions        -- UNIQUE(code_id)
  INSERT customer_reward_transactions -- UNIQUE(code_id, type)
  UPDATE customer_wallets SET balance = balance + value
  UPDATE gift_card_codes SET status = 'REDEEMED', claimed_at = now()
COMMIT
```

The row lock serialises simultaneous claims of the same code; the unique
constraints make double-crediting impossible even if the application logic were
wrong. This is verified by a concurrent test, not asserted.

### 5.3 Spend at checkout
```
BEGIN
  lock customer_wallets
  load spendable buckets, restricted first
  for each bucket, capped at the eligible portion of the order
  debit wallet, write one PURCHASE_DEBIT ledger row per bucket used
  reserve stock / apply the order total
COMMIT
```

Refunds reverse the debit, returning value to the same buckets it came from.

### 5.4 Delivery
Delivery is deliberately **outside** the purchase transaction. Ordering it after
means a slow SMTP server can never roll back a paid purchase.

- **Email** — real, via the existing mailer.
- **SMS** — no provider is connected. The delivery row is recorded as `SKIPPED`
  with a reason and is visible in admin. It is never reported as sent.
- **Scheduled** — rows with `scheduled_for`; a delivery worker claims and sends
  them. The worker is idempotent and re-runnable.

A code whose delivery fails is still `UNUSED` and marked for redelivery. The
shopper paid, so the value must remain recoverable.

---

## 6. Security

| Requirement | Mechanism |
|---|---|
| Unpredictable codes | `crypto.randomBytes` over a 32-character unambiguous alphabet |
| No duplicate codes | `UNIQUE (code_hash)`, plus collision retry on generate |
| Secure storage | SHA-256 hash + last4; plaintext never persisted after delivery |
| No code in logs | Codes are never logged, including in error paths |
| Brute-force resistance | Per-client throttle on every code entry point; 20 failures → lockout |
| No double credit | Row lock + `UNIQUE(code_id)` on redemptions and on the ledger |
| Server-side expiry and eligibility | Never trusted from the client |
| Payment before issue | Codes only exist after the provider settles |
| Ownership | A card bound to another customer is rejected |
| Audit | Every purchase, claim, revocation, and admin change is timestamped with actor |
| Atomicity | Claims and debits are single transactions; failure rolls back entirely |

---

## 7. Payment

A `PaymentProvider` interface with two implementations:

- `SandboxProvider` — settles or fails on demand, for development and tests.
- `LiveProvider` — reserved; activated by setting keys for Stripe or Razorpay.

Both satisfy the same contract: `createIntent`, `confirm`, `refund`, and
`parseWebhook`. The rest of the system depends only on that contract, so adding
a real gateway later requires no change to purchase, issue, or claim flows.

Until a live provider is configured the storefront says so plainly. No simulated
gateway is ever presented as a real charge.

---

## 8. Notifications

| Event | Channel | Status |
|---|---|---|
| Purchase confirmation | Email to purchaser | Implemented |
| Gift card delivery | Email | Implemented |
| Delivery failure | Admin-visible record | Implemented |
| Redemption confirmation | Email | Implemented |
| Expiry reminder | Email | Worker function; **needs a scheduler** |
| Revocation notice | Email | Implemented |
| SMS (all of the above) | SMS | **Needs a provider** |

---

## 9. Status lifecycle

```
PENDING_PAYMENT ──payment ok──> UNUSED ──claimed──> REDEEMED
       │                            │                 (terminal)
       └──payment failed──> (void) │──expiry passes──> EXPIRED
                                    │──admin revokes──> REVOKED
                                    └──scheduled send pending──> SCHEDULED ──> UNUSED
```

`EXPIRED` is **derived** from `expires_at` at read time and never written, so a
card cannot be left ACTIVE past its date without a sweeper. Stored statuses are
the six above.

---

## 10. Migration of existing data

New migrations only. Each is idempotent and re-runnable.

1. Create `gift_card_purchases`, `gift_card_codes`, `gift_card_applicability`,
   `gift_card_deliveries`, `gift_card_redemptions`, `customer_wallets`,
   `customer_reward_transactions`.
2. Add template-only columns to `gift_cards` (`name`, `description`,
   `validity_days`, `quantity_cap`, `starts_at`, `ends_at`).
3. **Migrate issued cards.** Each existing row in `gift_cards` becomes a
   `gift_card_codes` row, preserving value, balance, status, recipient, dates,
   `code_hash` and `code_last4`. A synthetic template is created per distinct
   configuration so every migrated code stays linked to a real template.
4. **Migrate ledger history.** `gift_card_transactions` is copied into
   `gift_card_redemptions` for every `REDEEM` row that has an order, with the
   redeeming customer resolved from the order.
5. Migrate `gift_card_scheduled` into `gift_card_deliveries`.
6. `gift_card_transactions` and `gift_card_scheduled` are retained, read-only,
   as historical record. No data is deleted.
7. Verify: sum of `gift_card_codes.balance` equals the pre-migration
   `gift_cards.balance` total, and code count matches.

`gift_cards` keeps working as the template table throughout; no rename is
performed, so no application code breaks mid-migration.

---

## 11. Testing

- **Unit** — code generation format and entropy, hashing, masking, the spend
  allocator, bucket selection, eligibility matching, and all amount arithmetic
  including paise rounding.
- **Concurrency** — the central risk. Two simultaneous claims of one code must
  produce exactly one credit. Two simultaneous checkouts spending the same wallet
  must not overdraw. Both tested against a real database, not mocks.
- **Integration** — purchase → issue → deliver → claim → spend, against a real
  database and the sandbox provider.
- **Migration** — a test that builds the pre-migration state, runs the
  migration, and asserts balances and counts are preserved.
- **Regression** — the existing 111 tests must stay green.

---

## 12. Explicitly out of scope

Stated so nothing is assumed:

- A live payment gateway. It needs credentials only the user can supply.
- SMS delivery. It needs an SMS provider.
- AI image generation. It needs an image API key. Generated SVG art covers the
  appearance until then.
- A cron scheduler for expiry reminders and scheduled deliveries. The worker
  functions will exist and be re-runnable; something must invoke them on a
  schedule, and that is infrastructure outside this codebase.
- Physical gift cards and barcode scanning.

---

## 13. Mapping to the requirements

| § | Requirement | Where |
|---|---|---|
| 1 | Admin CRUD, applicability, validity, usage, min/max, status, window, quantity | §2, §3 |
| 2 | Customer store and purchase flow | §4.1, §4.2, §5.1 |
| 3 | Unique secure code generation and storage | §2.2, §5.1, §6 |
| 4 | Email and SMS delivery | §5.4, §8 |
| 5 | My gift cards | §4.3 |
| 6 | Redeem, validate, credit balance, atomically | §5.2 |
| 7 | Reward balance integration and history | §2.3, §4.5, §5.3 |
| 8 | Status management | §9 |
| 9 | Database structure | §2.2 |
| 10 | Security and validation | §6, §7 |
| 11 | Dashboard and reports | §3.4 |
| 12 | Notifications | §8 |
| 13 | Complete user flows | §5 |
| 14 | Outcome | §11 |
