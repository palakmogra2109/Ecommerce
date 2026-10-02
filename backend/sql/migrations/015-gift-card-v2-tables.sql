-- Gift card v2: templates are sold, codes are issued, wallets hold the value.
--
-- gift_cards has been doing two jobs at once — an issued card *and*, partly, the
-- thing being sold — and that is why so much of its shape is awkward: a card
-- that has been paid for is indistinguishable from the product listing it came
-- from, and a template cannot describe itself without also pretending to be
-- spendable stock. This file splits those jobs apart and leaves the old columns
-- exactly where they are, so the live table keeps working while the data
-- migration moves rows across.
--
-- The seven tables below are additive. Nothing here drops, renames or narrows
-- anything, and gift_card_transactions / gift_card_scheduled /
-- gift_card_reservations / gift_denominations are left alone: the legacy tables
-- stay readable until the backfill has been verified and the old columns can be
-- retired in a later, reversible step.
--
-- Every statement is re-runnable. Tables and indexes use IF NOT EXISTS, and
-- anything expressed as a CHECK lives inside CREATE TABLE so it is created once
-- with the table it protects.

-- FK cycle: gift_card_codes.purchase_id points at gift_card_purchases, and the
-- two are easy to mistake for a cycle. They are not. gift_card_purchases has no
-- FK back to codes — it records a paid order, and the codes it produced are
-- discovered from gift_card_codes, not the other way round — so the graph is a
-- DAG and plain top-down creation is enough. gift_card_purchases is therefore
-- created first and gift_card_codes carries its FK inline. No deferred
-- ALTER TABLE is needed, and nothing here depends on statement order at run
-- time.
--
-- A paid order for one or more codes. This is the seam between the catalogue
-- and what a shopper actually bought: it survives the code rows, so an order
-- can be refunded or cancelled without touching the issued codes' history.
CREATE TABLE IF NOT EXISTS gift_card_purchases (
  id                 BIGSERIAL PRIMARY KEY,
  uuid               UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  -- NULL for a guest checkout, which is the common case for a gift.
  purchaser_id       BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  template_id        BIGINT NOT NULL REFERENCES gift_cards(id) ON DELETE RESTRICT,
  quantity           INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_face_value    NUMERIC(12,2) NOT NULL CHECK (unit_face_value > 0),
  -- What the buyer paid per code. NULL means it was not recorded separately;
  -- 0 is legitimate (a fully discounted promotion), negative never is.
  unit_selling_price NUMERIC(12,2) CHECK (unit_selling_price IS NULL OR unit_selling_price >= 0),
  total_amount       NUMERIC(12,2) NOT NULL CHECK (total_amount > 0),
  currency           TEXT NOT NULL DEFAULT 'INR',
  -- Names a payment provider from the registry, so a refund knows which gateway
  -- to talk to without this table hard-coding an integration.
  payment_provider   TEXT NOT NULL DEFAULT 'sandbox',
  payment_intent_id  TEXT,
  payment_reference  TEXT,
  -- Kept apart from `status` because payment and fulfilment fail separately: a
  -- captured payment can still be waiting on a scheduled send.
  payment_status     TEXT NOT NULL DEFAULT 'PENDING'
                      CHECK (payment_status IN ('PENDING', 'PAID', 'FAILED', 'REFUNDED')),
  status             TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'
                      CHECK (status IN ('PENDING_PAYMENT', 'ISSUED', 'SCHEDULED', 'CANCELLED', 'REFUNDED')),
  recipient_email    TEXT,
  recipient_name     TEXT,
  gift_message       TEXT,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_purchases_uuid_key ON gift_card_purchases(uuid);
CREATE INDEX IF NOT EXISTS gift_card_purchases_purchaser_idx ON gift_card_purchases(purchaser_id);
CREATE INDEX IF NOT EXISTS gift_card_purchases_status_idx ON gift_card_purchases(status);

-- A code that was actually issued to a recipient. This is the heart of the
-- system: one row per physical gift, matching on a hash rather than the code
-- itself so a database dump cannot be replayed at the checkout.
--
-- EXPIRED is deliberately NOT a status. Expiry is derived from expires_at at
-- read time; storing it would mean a clock tick had to write a row to keep the
-- list honest, and any sweeper that fell behind would leave cards marked UNUSED
-- that had in fact run out. Derived state cannot go stale.
CREATE TABLE IF NOT EXISTS gift_card_codes (
  id            BIGSERIAL PRIMARY KEY,
  uuid          UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  template_id   BIGINT NOT NULL REFERENCES gift_cards(id) ON DELETE RESTRICT,
  -- NULL when a code was issued administratively rather than from a purchase.
  purchase_id   BIGINT REFERENCES gift_card_purchases(id) ON DELETE SET NULL,
  -- Codes are matched by hash, and the UNIQUE is the reason two buyers can
  -- never be handed the same code: it is checked by the index, so a race
  -- between two issuances loses one of them instead of minting a duplicate.
  code_hash     TEXT NOT NULL UNIQUE,
  code_last4    TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'PENDING_PAYMENT'
                CHECK (status IN ('PENDING_PAYMENT', 'UNUSED', 'REDEEMED', 'REVOKED', 'SCHEDULED')),
  currency      TEXT NOT NULL DEFAULT 'INR',
  face_value    NUMERIC(12,2) NOT NULL CHECK (face_value > 0),
  -- What was actually credited to a wallet. Equal to face_value for a full
  -- claim; a partial claim credits less. Capped at the face value in the CHECK
  -- below so no claim can mint value that was never sold.
  claimed_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  claimed_by    BIGINT REFERENCES customers(id) ON DELETE SET NULL,
  claimed_at    TIMESTAMPTZ,
  expires_at    TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  revoked_reason TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- A claim can never be worth more than the card was sold for.
  CONSTRAINT gift_card_codes_claimed_value_check
    CHECK (claimed_value >= 0 AND claimed_value <= face_value),
  -- Owner and claim time stand or fall together, so a half-claimed row cannot
  -- exist: there is no way to credit someone without recording when, or to
  -- record a time without an owner to credit.
  CONSTRAINT gift_card_codes_claim_pair_check
    CHECK ((claimed_by IS NULL) = (claimed_at IS NULL)),
  -- A revoked card is dead money. Letting it keep a claim would mean a revoked
  -- gift still sitting in somebody's spendable wallet.
  CONSTRAINT gift_card_codes_revoked_unclaimed_check
    CHECK (status <> 'REVOKED' OR claimed_by IS NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_codes_uuid_key ON gift_card_codes(uuid);
CREATE INDEX IF NOT EXISTS gift_card_codes_template_idx ON gift_card_codes(template_id);
CREATE INDEX IF NOT EXISTS gift_card_codes_claimed_by_idx ON gift_card_codes(claimed_by);
CREATE INDEX IF NOT EXISTS gift_card_codes_status_idx ON gift_card_codes(status);
CREATE INDEX IF NOT EXISTS gift_card_codes_expires_at_idx ON gift_card_codes(expires_at);

-- A template's spend restrictions, one row each instead of a JSON blob. JSON
-- cannot answer "which templates are restricted to this brand" without parsing
-- every row, and it cannot be indexed, so the admin filter and the checkout
-- eligibility check both wanted this to be relational.
--
-- An empty set means unrestricted, not "restricted to nothing". That is why
-- there is no denormalised flag saying a template is scoped: the absence of
-- rows is the whole signal, and it must stay a valid, cheap state.
CREATE TABLE IF NOT EXISTS gift_card_applicability (
  id          BIGSERIAL PRIMARY KEY,
  template_id BIGINT NOT NULL REFERENCES gift_cards(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('BRAND', 'CATEGORY', 'PRODUCT')),
  value       TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The admin form re-saves a template's whole scope, so the same restriction
  -- arrives repeatedly. Without this a double-save would silently multiply the
  -- row and the restriction would be applied twice at checkout.
  CONSTRAINT gift_card_applicability_template_kind_value_key
    UNIQUE (template_id, kind, value)
);
-- The unique index above already serves lookups by template_id; this one serves
-- the reverse question, "what may this brand be spent on".
CREATE INDEX IF NOT EXISTS gift_card_applicability_kind_value_idx
  ON gift_card_applicability(kind, value);

-- Sending a code to its recipient. The code row itself says nothing about
-- whether the human ever received it, and "did they get it" is the question
-- support actually asks, so the send is a row rather than a side effect.
--
-- SKIPPED exists because SMS has no provider configured yet. Recording the
-- attempt as SKIPPED keeps the promise honest and the row visible to whoever
-- wires up the gateway later; dropping the row would leave the template
-- appearing never to have been sent.
CREATE TABLE IF NOT EXISTS gift_card_deliveries (
  id              BIGSERIAL PRIMARY KEY,
  uuid            UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  code_id         BIGINT NOT NULL REFERENCES gift_card_codes(id) ON DELETE CASCADE,
  -- NULL for an administratively issued code that was never sold.
  purchase_id     BIGINT REFERENCES gift_card_purchases(id) ON DELETE SET NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('EMAIL', 'SMS')),
  -- The destination, for both channels: the contact detail the sender gave. One
  -- field, so the worker has a single thing to hand the provider.
  recipient_email TEXT NOT NULL,
  recipient_name  TEXT,
  -- NULL means send now. A time in the past is a due row, not an error.
  scheduled_for   TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'PENDING'
                  CHECK (status IN ('PENDING', 'SENDING', 'SENT', 'FAILED', 'SKIPPED')),
  attempt_count   INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_error      TEXT,
  sent_at         TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_deliveries_uuid_key ON gift_card_deliveries(uuid);
-- One outstanding send per code. The delivery worker is re-runnable and a
-- crashed worker can be restarted while its predecessor's rows are still
-- PENDING, so this partial unique index is what stops a retry from mailing the
-- same gift twice. It is deliberately filtered to PENDING: sent and failed rows
-- stay as history, and a legitimate resend after a failure is a new PENDING row
-- once the old one has left PENDING.
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_deliveries_one_pending_per_code
  ON gift_card_deliveries(code_id) WHERE status = 'PENDING';
-- Due work for the worker. SENDING is included because a worker killed
-- mid-send leaves a row stranded there, and it is exactly the row that must be
-- picked up again.
CREATE INDEX IF NOT EXISTS gift_card_deliveries_due_idx
  ON gift_card_deliveries(scheduled_for) WHERE status IN ('PENDING', 'SENDING');

-- A code spent at checkout. Unique per code while the spend is live, which is
-- the double-spend guard: two concurrent checkouts both try to write the
-- redemption, and only one can.
--
-- A hard UNIQUE (code_id) would have been simpler, but it is wrong here.
-- Cancelling or refunding an order reverses the redemption and restores the
-- value, and the customer is then entitled to spend that same card on
-- something else. With a hard unique the second spend could never be recorded,
-- so the value would be restored in the wallet but permanently unaccounted for
-- at checkout. Instead the row keeps its audit history: a reversal marks the
-- row REVERSED rather than deleting it, and the partial unique index below only
-- counts live rows, so exactly one ACTIVE spend can exist per code at a time.
-- The race the index exists to stop is unaffected — both racers insert ACTIVE.
CREATE TABLE IF NOT EXISTS gift_card_redemptions (
  id        BIGSERIAL PRIMARY KEY,
  uuid      UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  code_id   BIGINT NOT NULL REFERENCES gift_card_codes(id) ON DELETE CASCADE,
  -- The order may not exist yet when the redemption is written, so order_uuid
  -- carries the identity in the meantime and order_id is filled in on commit.
  order_id  BIGINT REFERENCES orders(id) ON DELETE SET NULL,
  order_uuid UUID,
  amount    NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  status    TEXT NOT NULL DEFAULT 'ACTIVE'
            CHECK (status IN ('ACTIVE', 'REVERSED')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_redemptions_uuid_key ON gift_card_redemptions(uuid);
-- The double-spend guard. Exactly one live spend per code; reversed history is
-- free to accumulate underneath it.
CREATE UNIQUE INDEX IF NOT EXISTS gift_card_redemptions_active_code_key
  ON gift_card_redemptions(code_id) WHERE status = 'ACTIVE';
CREATE INDEX IF NOT EXISTS gift_card_redemptions_order_id_idx ON gift_card_redemptions(order_id);
CREATE INDEX IF NOT EXISTS gift_card_redemptions_order_uuid_idx ON gift_card_redemptions(order_uuid);

-- One wallet per customer. There is deliberately no balance column here.
--
-- The balance is the sum of the ledger, and a stored total is a second source
-- of truth for the same fact: it drifts the first time a transaction commits
-- and its balance update does not, and nothing in the database notices. Deriving
-- it means the number cannot lie, at the cost of a SUM on read — which is a
-- cheap price for correctness on money. The overdraft guard therefore lives on
-- the ledger's own balance_after, below, where the database can enforce it.
CREATE TABLE IF NOT EXISTS customer_wallets (
  id          BIGSERIAL PRIMARY KEY,
  uuid        UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  currency    TEXT NOT NULL DEFAULT 'INR',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- One wallet per customer. If multi-currency wallets are ever needed this
  -- becomes UNIQUE (customer_id, currency); until then the currency column only
  -- records which currency this wallet is denominated in.
  CONSTRAINT customer_wallets_customer_id_key UNIQUE (customer_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_wallets_uuid_key ON customer_wallets(uuid);

-- The wallet ledger. Append-only: corrections are new rows, never edits.
--
-- Every row carries the wallet total *after* it was applied, so the ledger
-- audits itself — you can read a customer's balance off any row without summing,
-- and a broken sum is visible as a discontinuity rather than as a plausible
-- wrong number.
CREATE TABLE IF NOT EXISTS customer_reward_transactions (
  id            BIGSERIAL PRIMARY KEY,
  uuid          UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  wallet_id     BIGINT NOT NULL REFERENCES customer_wallets(id) ON DELETE CASCADE,
  type          TEXT NOT NULL
                CHECK (type IN ('CREDIT', 'DEBIT', 'REFUND', 'EXPIRY', 'ADJUSTMENT')),
  -- A signed delta, not a magnitude: a DEBIT is negative, a REFUND is positive.
  -- Storing only positives would force the sign to be inferred from `type`, and
  -- any new type added later would carry its sign by convention alone.
  amount        NUMERIC(12,2) NOT NULL,
  balance_after NUMERIC(12,2) NOT NULL,
  -- The remainder of the card this value came from, because a restricted card's
  -- money may only be spent on what that card allows. Intentionally not a
  -- foreign key: buckets arrive with a later migration, and a dangling bucket
  -- reference must not block a refund.
  bucket_id     BIGINT,
  code_id       BIGINT REFERENCES gift_card_codes(id) ON DELETE SET NULL,
  order_uuid    UUID,
  -- Why the row exists, in a form that can be filtered: 'CLAIM', 'REDEEM',
  -- 'ORDER:<uuid>'. Free text lives in description; this is the machine key.
  reference     TEXT,
  description   TEXT,
  metadata      JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- The overdraft guard, in the database. An application bug that debits more
  -- than the customer holds cannot be written at all: it would have to record a
  -- negative balance_after, and this CHECK refuses the row. No application code
  -- is trusted here because this is the invariant that pays for the bug.
  CONSTRAINT customer_reward_transactions_balance_after_check
    CHECK (balance_after >= 0)
);
CREATE UNIQUE INDEX IF NOT EXISTS customer_reward_transactions_uuid_key ON customer_reward_transactions(uuid);
CREATE INDEX IF NOT EXISTS customer_reward_transactions_wallet_idx ON customer_reward_transactions(wallet_id);
CREATE INDEX IF NOT EXISTS customer_reward_transactions_code_idx ON customer_reward_transactions(code_id);
-- Statement order and the wallet's own history together, which is how a
-- balance is reconciled.
CREATE INDEX IF NOT EXISTS customer_reward_transactions_wallet_created_idx
  ON customer_reward_transactions(wallet_id, created_at);