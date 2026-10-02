-- 017: move the legacy issued cards out of gift_cards and into gift_card_codes.
--
-- gift_cards has been doing two jobs at once — an issued card *and* the product
-- listing it was sold from — and 015/016 built the v2 shape around that: the row
-- is now the template, the thing a shopper buys, and an actual gift is a row in
-- gift_card_codes. This file performs the move, and it is the step 016 deferred:
-- the issued cards have to be out of gift_cards before that table's status
-- column can mean "template".
--
-- THE INVARIANT THIS FILE EXISTS TO PROTECT
--
--   Nothing here destroys value. Balances are not moved, re-stated or
--   recalculated: gift_cards.balance keeps every value it already had, and
--   gift_card_transactions is not read, written or touched in any way. The
--   legacy ledger already accounts for every rupee that was ever issued, spent,
--   voided or refunded, so the only thing that may be *added* here is the
--   identity of the code that corresponds to each legacy row. A migration that
--   double-counts is far worse than one that under-counts, which is why
--   claimed_value is 0 on every row below and why the wallet credit path is
--   gated on the legacy row actually naming an owner.
--
-- WHERE THE OLD ROW GOES
--
--   Nowhere. Each legacy row stays, byte for byte apart from its status and
--   updated_at, and becomes its own template: gift_card_codes.template_id
--   points back at the card it came from, so the issued card, its balances and
--   its history keep a parent to hang off. That is also what makes this
--   reversible. The alternative — blanking the legacy row, or pointing codes at
--   a synthetic "migrated cards" template the way an earlier draft of the plan
--   did — would collapse five distinct cards into one unidentifiable bucket and
--   leave a spent card still listed as a sellable product.
--
--   Once a card has been issued it is retired to ARCHIVED. A cancelled or
--   redeemed card must not appear in the storefront's template list, and
--   keeping it ACTIVE would mean the admin could sell a card that is already
--   dead. Only DRAFT rows keep a template status, because a draft was never
--   issued and is still something to sell.
--
-- EVERY STATEMENT HERE IS RE-RUNNABLE. Applying this file twice is a no-op, not
-- an error. The status vocabulary only ever grows (step 1), inserts are guarded
-- by the uniqueness that already exists rather than by a "has this run" flag,
-- and the plan is computed into a temp table that is dropped on commit so a
-- second run re-derives it from the new state instead of trusting a stale one.

-- ---------------------------------------------------------------------------
-- Step 0: sha256, only if a row turns out to need it.
-- ---------------------------------------------------------------------------
-- The one thing this file cannot do is invent a code_hash. A fabricated hash is
-- worse than a missing one: it looks like a real issued code, it is unique, so
-- nothing ever collides with it, and yet nobody can ever present the plaintext
-- that hashes to it. The holder of a legacy card whose code was hashed away
-- would be told their card does not exist, and there would be no way to tell
-- that apart from a card that was never issued.
--
-- So the rule is: copy the hash if the row has one, derive it from the
-- plaintext code if the row still has one, and skip the row loudly if it has
-- neither. lib/giftCardCodeGen.hashCode() is sha256 over the normalised code,
-- so deriving it in SQL needs sha256, which on a stock PostgreSQL means
-- pgcrypto. It is installed here only because the derivation may be needed, and
-- only if it is not already present.
--
-- The helper below is created and dropped inside this migration and is never
-- part of the schema: it exists exactly long enough to make the derivation
-- deterministic, and it returns NULL when sha256 is unavailable rather than
-- raising, so an environment that forbids CREATE EXTENSION degrades into a
-- counted skip instead of a failed migration.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      RAISE NOTICE '017: installed pgcrypto (needed only to derive a hash for a legacy row that kept its plaintext code).';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE '017: could not install pgcrypto (%). Any legacy row that must have its code hashed will be skipped and reported.', SQLERRM;
    END;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION gc_migrate_code_hash(p_code TEXT) RETURNS TEXT
LANGUAGE plpgsql STABLE AS $$
BEGIN
  -- to_regprocedure is resolved before digest is ever called, so a database
  -- without pgcrypto plans this branch and skips the digest statement instead
  -- of failing to resolve the function name.
  IF to_regprocedure('digest(bytea,text)') IS NULL THEN
    RETURN NULL;
  END IF;
  -- normalizeGiftCode() in lib/giftCardRules.js and normalizeCode() in
  -- lib/giftCardCodeGen.js: trim, every run of whitespace to a single dash,
  -- upper-case. hashCode() is then a plain sha256 hex digest of that string,
  -- so the two implementations agree byte for byte and a code migrated this way
  -- verifies through the ordinary claim path.
  RETURN encode(
    digest(
      convert_to(
        upper(regexp_replace(btrim(p_code, E' \t\n\r\f'), '\s+', '-', 'g')),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );
END $$;

-- ---------------------------------------------------------------------------
-- Step 1: widen the gift_cards status vocabulary to include ARCHIVED.
-- ---------------------------------------------------------------------------
-- Widening, never narrowing. The live table holds rows in CANCELLED and
-- REDEEMED, and this migration retires those very rows to ARCHIVED, so a
-- constraint that only admitted the three template states would reject the
-- rows it was introduced to clean up. Every value accepted before this file
-- runs is still accepted after it: that is the only safe direction for a CHECK
-- on a column holding historical data, and it is why the vocabulary is a
-- growing set rather than a replaced one. DRAFT and ACTIVE stay because a
-- template that is not yet sold, and one that is, are both legitimate. The
-- issued-only states stay because the rows that hold them are still here.
--
-- The vocabulary can only ever grow from here on: retiring a state means
-- deleting or rewriting the rows that carry it, which is a separate, later and
-- separately reversible decision — and until it happens, a constraint that
-- rejected them would make this table un-updatable rather than cleaner.
--
-- Two things this block deliberately refuses to do. It does not add the check
-- when it is missing: you cannot widen what does not exist, and inventing a
-- constraint on a table nobody has constrained yet could reject a row that was
-- perfectly legal a moment ago. And it refuses to proceed if some *other*
-- check on the table also constrains status, because replacing the one named
-- check it understands with a vocabulary it cannot see is how a "widen" turns
-- into a "narrow" by accident.
DO $$
DECLARE
  v_def    TEXT;
  v_others INTEGER;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO v_def
    FROM pg_constraint
   WHERE conrelid = 'gift_cards'::regclass
     AND conname = 'gift_cards_status_check';

  IF v_def IS NULL THEN
    RAISE NOTICE '017: no gift_cards_status_check on this table, so there is nothing to widen. Left alone.';
    RETURN;
  END IF;

  IF v_def LIKE '%ARCHIVED%' THEN
    RAISE NOTICE '017: gift_cards_status_check already admits ARCHIVED, left as it is.';
    RETURN;
  END IF;

  SELECT count(*) INTO v_others
    FROM pg_constraint
   WHERE conrelid = 'gift_cards'::regclass
     AND contype = 'c'
     AND conname <> 'gift_cards_status_check'
     AND pg_get_constraintdef(oid) ~ '(^|[^A-Za-z_])status([^A-Za-z_]|$)';

  IF v_others > 0 THEN
    RAISE EXCEPTION
      '017: gift_cards carries % other CHECK constraint(s) that mention the status column. This migration will not guess at a status vocabulary it cannot see: widen gift_cards_status_check by hand, or reconcile the other constraint, and re-run. Nothing has been changed.',
      v_others;
  END IF;

  ALTER TABLE gift_cards DROP CONSTRAINT gift_cards_status_check;
  ALTER TABLE gift_cards ADD CONSTRAINT gift_cards_status_check
    CHECK (status IN ('DRAFT', 'ACTIVE', 'SUSPENDED', 'CANCELLED', 'REDEEMED', 'ARCHIVED'));
  RAISE NOTICE '017: gift_cards_status_check widened to admit ARCHIVED alongside every previously accepted value.';
END $$;

-- ---------------------------------------------------------------------------
-- The plan: one row per legacy card, decided before anything is written.
-- ---------------------------------------------------------------------------
-- The mapping is computed once, up front, into a temp table, so that the same
-- decision drives the insert, the retirement of the template and the report.
-- Deriving it twice — once for the INSERT and once for the counting — would
-- mean two copies of the mapping rules that could drift apart, and a migration
-- whose own report disagrees with what it actually wrote is not auditable.
--
-- A previous run's temp tables are dropped through a guard rather than
-- DROP TABLE IF EXISTS, so a re-run does not bury the report under two
-- "table does not exist" notices.
DO $$
BEGIN
  IF to_regclass('pg_temp.gc017_plan') IS NOT NULL THEN
    DROP TABLE gc017_plan;
  END IF;
  IF to_regclass('pg_temp.gc017_link') IS NOT NULL THEN
    DROP TABLE gc017_link;
  END IF;
END $$;

CREATE TEMP TABLE gc017_plan ON COMMIT DROP AS
SELECT
  g.id                AS legacy_id,
  g.uuid              AS legacy_uuid,
  g.status            AS legacy_status,
  g.customer_id       AS legacy_customer_id,
  g.balance           AS legacy_balance,
  g.initial_amount    AS legacy_initial_amount,
  g.currency          AS currency,
  g.recipient_email   AS recipient_email,
  g.expires_at        AS expires_at,
  g.created_at        AS legacy_created_at,
  g.updated_at        AS legacy_updated_at,
  -- Kept only to tell "this row has no identity at all" apart from "this row
  -- has a plaintext code but no sha256 to hash it with". The reason reported to
  -- the operator differs, and the first one is expected on a healthy database
  -- while the second means the database is missing an extension.
  NULLIF(btrim(g.code), '') AS legacy_plain_code,
  -- The identity the new code is matched on. The legacy hash wins outright: it
  -- is what the legacy application was already verifying against, so copying it
  -- guarantees a holder of that card is recognised. The derivation is only ever
  -- a fallback for a row that kept its plaintext.
  COALESCE(NULLIF(btrim(g.code_hash), ''), gc_migrate_code_hash(g.code)) AS eff_hash,
  -- code_last4 is NOT NULL on the new table, so it is derived from the same
  -- normalised code when the legacy row did not store it, using the identical
  -- rule as codeLast4() in lib/giftCardCodeGen.js.
  COALESCE(
    NULLIF(btrim(g.code_last4), ''),
    CASE WHEN NULLIF(btrim(g.code), '') IS NOT NULL
         THEN right(
                regexp_replace(
                  upper(regexp_replace(btrim(g.code, E' \t\n\r\f'), '\s+', '-', 'g')),
                  '[^A-Z0-9]', '', 'g'
                ),
                4
              )
    END
  ) AS eff_last4,
  -- The status mapping, decided once. DRAFT is NULL because a draft was never
  -- issued and stays a template; so is an unrecognised status, which must not
  -- be guessed into a new vocabulary.
  CASE
    WHEN g.status = 'DRAFT'  THEN NULL
    WHEN g.status = 'ACTIVE' AND g.balance > 0 THEN 'UNUSED'
    WHEN g.status = 'ACTIVE'                  THEN 'REDEEMED'
    WHEN g.status = 'REDEEMED'                THEN 'REDEEMED'
    WHEN g.status IN ('CANCELLED', 'SUSPENDED') THEN 'REVOKED'
    -- Already retired by a previous run of this file. The code, if it exists,
    -- is found below by hash; a status is never guessed backwards.
    WHEN g.status = 'ARCHIVED'                THEN NULL
    ELSE NULL
  END AS code_status,
  NULL::TEXT    AS skip_reason,
  NULL::BIGINT  AS code_id,
  -- Whether a code for this card already existed when this run started. Kept
  -- so the report can say "created" and "was already there" as different facts:
  -- a second run that reported its five rows as newly created would be a lie
  -- told to the operator deciding whether the migration is safe to re-run.
  NULL::BIGINT  AS pre_existing_code_id
  FROM gift_cards g;

-- Snapshot of what was already there, taken before the insert so that "created"
-- and "already present" can be reported as the two different facts they are.
UPDATE gc017_plan p
   SET pre_existing_code_id = c.id
  FROM gift_card_codes c
 WHERE c.template_id = p.legacy_id
   AND c.code_hash = p.eff_hash;


-- Why a planned row will not be migrated, or NULL when it will be. The order
-- matters: a reason that makes the row pointless is reported before a reason
-- that makes it impossible, so a DRAFT row is never also reported as having no
-- code identity.
UPDATE gc017_plan p SET skip_reason = CASE
  WHEN p.legacy_status = 'DRAFT'
    THEN 'DRAFT_TEMPLATE_NEVER_ISSUED'
  WHEN p.legacy_status = 'ARCHIVED'
       AND EXISTS (SELECT 1 FROM gift_card_codes c WHERE c.template_id = p.legacy_id)
    THEN 'ALREADY_MIGRATED'
  WHEN p.legacy_status = 'ARCHIVED'
    THEN 'ARCHIVED_WITH_NO_CODE_NEEDS_REVIEW'
  WHEN p.code_status IS NULL
    THEN 'UNRECOGNISED_STATUS'
  WHEN p.eff_hash IS NULL
       AND NULLIF(btrim(p.legacy_plain_code), '') IS NULL
    THEN 'NO_HASH_AND_NO_PLAINTEXT_CODE'
  WHEN p.eff_hash IS NULL
    THEN 'HASH_COULD_NOT_BE_DERIVED_NO_SHA256'
  WHEN NULLIF(p.eff_last4, '') IS NULL
    THEN 'NO_LAST4_AND_NO_PLAINTEXT_CODE'
  WHEN p.legacy_initial_amount IS NULL OR p.legacy_initial_amount <= 0
    THEN 'NON_POSITIVE_FACE_VALUE'
  ELSE NULL
END;

-- ---------------------------------------------------------------------------
-- Step 2: one gift_card_codes row per legacy card.
-- ---------------------------------------------------------------------------
-- The code_hash UNIQUE index is the idempotency guard: a second run of this
-- file collides on the hash it would write and the row is left alone, rather
-- than the migration failing on a duplicate. Nothing is checked in a "has this
-- already run" table, because that would let a re-run of this file quietly skip
-- a card whose code was deleted or revoked out from under it.
INSERT INTO gift_card_codes (
  template_id, code_hash, code_last4, status, currency, face_value,
  claimed_value, claimed_by, claimed_at, expires_at,
  revoked_at, revoked_reason, created_at, updated_at
)
SELECT
  p.legacy_id,
  p.eff_hash,
  p.eff_last4,
  p.code_status,
  p.currency,
  -- What the holder was entitled to, which is not the residual. Card 57 has
  -- 250 issued and 0 left; writing its face value as the leftover would record
  -- a redeemed card as worthless and make any later refund unable to restore
  -- the right amount.
  p.legacy_initial_amount,
  -- 0, always. See below.
  0,
  NULL,
  NULL,
  -- Copied, not recomputed. A card already past this timestamp is therefore
  -- already-derivable as EXPIRED the moment it lands, because expiry is derived
  -- from the timestamp at read time and never stored as a status. Recomputing
  -- from validity_days instead would silently move the expiry of a gift someone
  -- is already holding.
  p.expires_at,
  -- Only a revoked code carries a revocation. The legacy table never recorded
  -- when a card was voided, so now() is used and the reason says where the
  -- status came from: an invented cancellation timestamp would be a fact
  -- nobody can check, whereas "this was voided before the migration and we
  -- learned of it now" is true and auditable.
  CASE WHEN p.code_status = 'REVOKED' THEN now() ELSE NULL END,
  CASE WHEN p.code_status = 'REVOKED'
       THEN 'Migrated from legacy gift_cards.status = ' || p.legacy_status END,
  -- The legacy creation time is kept so codes list in the order they were
  -- issued, and so a wallet ledger written below orders consistently with the
  -- balance_after it computed.
  p.legacy_created_at,
  p.legacy_updated_at
  FROM gc017_plan p
 WHERE p.skip_reason IS NULL
ON CONFLICT (code_hash) DO NOTHING;

-- Point each planned row at the code it now owns. A row left NULL here is one
-- whose hash was already taken by a different card, which the report counts.
UPDATE gc017_plan p
   SET code_id = c.id
  FROM gift_card_codes c
 WHERE c.template_id = p.legacy_id
   AND c.code_hash = p.eff_hash;

-- claimed_value is 0 on every row above, and that is the single most important
-- number in this file.
--
-- claimed_value is what has actually been credited to a wallet, and every
-- rupee a legacy card ever carried is already accounted for in the legacy
-- tables. A CANCELLED card's value was returned to whoever paid for it and is
-- recorded as such in gift_card_transactions; a REDEEMED card's value was
-- spent against an order and is recorded there. Crediting either of them again
-- would mint money that was never sold, and the ₹17,244 currently held across
-- the five live cards would become ₹34,488 in the ledger while the bank balance
-- stayed where it was.
--
-- The UNUSED cards are the subtle case. They look like they should carry their
-- full value, and they do not, for the same reason: nobody has claimed them. A
-- code's value becomes real when someone presents the code, and a code nobody
-- has presented is a liability, not an asset. credited_value is credited at
-- claim time, which is also where the bucket from step 3 is created, because
-- the bucket and the credit have to be written in the same transaction or the
-- restricted value has no owner.
--
-- claimed_by and claimed_at stay NULL to match, as gift_card_codes_claim_pair_check
-- requires, and because a claim is a statement about a person presenting a
-- code. The legacy rows have an owner in customer_id but no evidence that the
-- owner ever held the code, and claiming on their behalf would assert something
-- untrue. The migration credits the owner a wallet below and leaves the claim
-- itself to be made, or never made, by the person who has the code.

-- ---------------------------------------------------------------------------
-- Step 3: wallet buckets for cards that actually had an owner.
-- ---------------------------------------------------------------------------
-- On the live data this creates nothing, and that is the correct answer rather
-- than a disappointing one: all five live cards have customer_id IS NULL, so
-- there is no customer to credit and the two ACTIVE cards are unclaimed codes,
-- not money in a wallet. The path is written out properly anyway, because a
-- migration that quietly produces nothing on the dataset in front of it will
-- also quietly produce nothing on the dataset that actually has owned cards.
INSERT INTO customer_wallets (customer_id, currency)
SELECT DISTINCT p.legacy_customer_id, p.currency
  FROM gc017_plan p
 WHERE p.skip_reason IS NULL
   AND p.code_status = 'UNUSED'
   AND p.legacy_customer_id IS NOT NULL
   AND p.legacy_balance > 0
   AND NOT EXISTS (
     SELECT 1 FROM customer_wallets w WHERE w.customer_id = p.legacy_customer_id
   )
ON CONFLICT (customer_id) DO NOTHING;

-- The credit. Two guards, because the second run of this file must not pay the
-- same card twice:
--   * the reference is the machine key, 'MIGRATION:<legacy id>', and a card can
--     only ever mint one of them, so NOT EXISTS on it is exact rather than
--     approximate;
--   * balance_after is a windowed running sum rather than a repeated scalar
--     lookup, because two legacy cards owned by the same customer would
--     otherwise both read the same opening balance and both write the same
--     closing one, leaving the ledger's own audit chain discontinuous even
--     though no constraint would object.
-- The >= 0 test is repeated here only so the skip is counted rather than
-- aborting the whole migration on the DB's overdraft CHECK.
WITH creditable AS (
  SELECT
    w.id        AS wallet_id,
    p.legacy_id,
    p.legacy_balance,
    p.code_id,
    p.legacy_created_at,
    p.legacy_uuid,
    COALESCE((
      SELECT r.balance_after
        FROM customer_reward_transactions r
       WHERE r.wallet_id = w.id
       ORDER BY r.created_at DESC, r.id DESC
       LIMIT 1
    ), 0) AS opening_balance
    FROM gc017_plan p
    JOIN customer_wallets w ON w.customer_id = p.legacy_customer_id
   WHERE p.skip_reason IS NULL
     AND p.code_status = 'UNUSED'
     AND p.legacy_customer_id IS NOT NULL
     AND p.legacy_balance > 0
     AND NOT EXISTS (
       SELECT 1 FROM customer_reward_transactions r
        WHERE r.reference = 'MIGRATION:' || p.legacy_id
     )
), running AS (
  SELECT
    creditable.*,
    opening_balance + SUM(legacy_balance) OVER (
      PARTITION BY wallet_id
      ORDER BY legacy_created_at, legacy_id
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS balance_after
    FROM creditable
)
INSERT INTO customer_reward_transactions (
  wallet_id, type, amount, balance_after, bucket_id, code_id,
  reference, description, metadata, created_at
)
SELECT
  wallet_id,
  'CREDIT',
  legacy_balance,
  balance_after,
  -- No bucket. gift_card_codes has no bucket column and no bucket table exists
  -- yet, and a restricted card's value cannot be spent without one. The bucket
  -- is created by the claim service in the same transaction that writes the
  -- live credit, which is why this migration deliberately does not add a column
  -- to gift_card_codes to hold it: a column nothing writes is a column every
  -- reader has to guess about. See the follow-up in the batch D report.
  NULL,
  code_id,
  'MIGRATION:' || legacy_id,
  'Credit of the balance held on legacy gift_cards.id = ' || legacy_id,
  jsonb_build_object(
    'source', 'migration-017',
    'legacy_gift_card_id', legacy_id,
    'legacy_gift_card_uuid', legacy_uuid
  ),
  legacy_created_at
  FROM running
 WHERE balance_after >= 0;

-- ---------------------------------------------------------------------------
-- Step 4: history and scheduled deliveries.
-- ---------------------------------------------------------------------------
-- gift_card_transactions is NOT touched by this file. It is not read, not
-- written and not referenced by any statement above; it is the legacy audit
-- trail, seven rows on the live database, and it has to stay byte for byte
-- identical so that a support question about a 2026-09-30 issuance can still be
-- answered from the same numbers after the migration as before it. Everything
-- this file does is additive alongside it. The same goes for
-- gift_card_reservations and gift_denominations.
--
-- gift_card_scheduled is a different matter, and it is empty on the live
-- database. It is still handled, because a scheduled row that matches nothing
-- is a hole in the audit trail and a hole should be reported rather than
-- discovered later.
--
-- There is no code key on a scheduled row. It records an intent — who, how
-- much, when — and by design the card itself did not exist until the send
-- time, so there is nothing to join on except a guess. The correlation below is
-- therefore recipient_email plus amount against the migrated codes, and
-- card_uuid is used only as a veto: when a scheduled row names the card it
-- produced, a candidate that is not that card is rejected rather than accepted.
-- A veto can only ever prevent a wrong link, never create a right one.
--
-- A row that matches nothing, or matches more than one, is left unattached and
-- reported by uuid. A wrong link is worse than a missing one: a delivery
-- attached to the wrong code tells support that person A was mailed person B's
-- gift card, and that error is far harder to find later than a row that
-- visibly has no delivery.
DO $$
BEGIN
  IF to_regclass('pg_temp.gc017_link') IS NOT NULL THEN
    DROP TABLE gc017_link;
  END IF;
END $$;

CREATE TEMP TABLE gc017_link ON COMMIT DROP AS
SELECT
  s.id              AS scheduled_id,
  s.uuid            AS scheduled_uuid,
  s.card_uuid       AS card_uuid,
  s.recipient_email AS recipient_email,
  s.amount          AS amount,
  s.recipient_name  AS recipient_name,
  s.scheduled_for   AS scheduled_for,
  s.created_at      AS created_at,
  s.sent_at         AS sent_at,
  -- More than one candidate is a failure, not a choice.
  count(m.id) OVER (PARTITION BY s.id) AS candidates,
  min(m.id)    OVER (PARTITION BY s.id) AS code_id
  FROM gift_card_scheduled s
  JOIN LATERAL (
    SELECT c.id
      FROM gift_card_codes c
      JOIN gift_cards t ON t.id = c.template_id
     WHERE t.recipient_email = s.recipient_email
       AND c.face_value = s.amount
       AND (s.card_uuid IS NULL OR t.uuid = s.card_uuid)
  ) m ON true
 WHERE s.status = 'SENT'
   AND s.card_uuid IS NOT NULL;

INSERT INTO gift_card_deliveries (
  code_id, purchase_id, channel, recipient_email, recipient_name,
  scheduled_for, status, attempt_count, sent_at, created_at, updated_at
)
SELECT
  l.code_id,
  NULL,
  -- EMAIL is the only channel these rows can be: gift_card_deliveries requires
  -- a recipient_email and SMS has no provider configured.
  'EMAIL',
  l.recipient_email,
  l.recipient_name,
  l.scheduled_for,
  'SENT',
  -- The legacy table kept no attempt count. A row that says SENT demonstrably
  -- went out at least once, so 1 is a lower bound read off the row's own
  -- status rather than a number invented for it.
  1,
  COALESCE(l.sent_at, l.created_at),
  l.created_at,
  now()
  FROM gc017_link l
 WHERE l.candidates = 1
   AND NOT EXISTS (
     SELECT 1 FROM gift_card_deliveries d
      WHERE d.code_id = l.code_id
        AND d.channel = 'EMAIL'
        AND d.status = 'SENT'
        AND d.scheduled_for = l.scheduled_for
        AND d.recipient_email = l.recipient_email
   );

-- ---------------------------------------------------------------------------
-- Step 5: retire the issued cards, then report.
-- ---------------------------------------------------------------------------
-- Only after the codes exist. Doing this first would leave the legacy row
-- indistinguishable from a template that was never issued, and there would be
-- nothing left to migrate it from.
--
-- is_active is deliberately left alone. status is the archive marker here, and
-- is_active is the sell gate that the template queries are meant to filter on
-- once they exist; setting it false as well would be a second, unrequested
-- change to five rows. Recorded as a follow-up in the report instead.
UPDATE gift_cards g
   SET status = 'ARCHIVED',
       updated_at = now()
  FROM gc017_plan p
 WHERE p.legacy_id = g.id
   AND p.skip_reason IS NULL
   AND p.code_id IS NOT NULL
   AND g.status <> 'ARCHIVED';

-- The report. Everything an operator needs to know is here, because a migration
-- that has to be interrogated with queries afterwards has already lost the
-- argument for being run in a hurry.
DO $$
DECLARE
  v_legacy_total     INTEGER;
  v_created          INTEGER;
  v_existing         INTEGER;
  v_hash_collision   INTEGER;
  v_no_identity      INTEGER;
  v_no_sha256        INTEGER;
  v_no_last4         INTEGER;
  v_bad_status       INTEGER;
  v_draft            INTEGER;
  v_already          INTEGER;
  v_orphan_archived  INTEGER;
  v_bad_face         INTEGER;
  v_retired          INTEGER;
  v_wallets          INTEGER;
  v_credits          INTEGER;
  v_credit_value     NUMERIC(12,2);
  v_scheduled_seen   INTEGER;
  v_scheduled_no_key INTEGER;
  v_scheduled_linked INTEGER;
  v_scheduled_lost   INTEGER;
  v_scheduled_other  INTEGER;
  v_legacy_value     NUMERIC(12,2);
  v_ledger_rows      INTEGER;
  v_lost_uuids       TEXT;
BEGIN
  SELECT count(*) INTO v_legacy_total FROM gc017_plan;
  SELECT count(*) INTO v_created FROM gc017_plan
   WHERE skip_reason IS NULL AND code_id IS NOT NULL AND pre_existing_code_id IS NULL;
  SELECT count(*) INTO v_existing FROM gc017_plan
   WHERE skip_reason IS NULL AND code_id IS NOT NULL AND pre_existing_code_id IS NOT NULL;
  SELECT count(*) INTO v_hash_collision FROM gc017_plan
   WHERE skip_reason IS NULL AND code_id IS NULL;
  SELECT count(*) INTO v_no_identity FROM gc017_plan
   WHERE skip_reason = 'NO_HASH_AND_NO_PLAINTEXT_CODE';
  SELECT count(*) INTO v_no_sha256 FROM gc017_plan
   WHERE skip_reason = 'HASH_COULD_NOT_BE_DERIVED_NO_SHA256';
  SELECT count(*) INTO v_no_last4 FROM gc017_plan
   WHERE skip_reason = 'NO_LAST4_AND_NO_PLAINTEXT_CODE';
  SELECT count(*) INTO v_bad_status FROM gc017_plan
   WHERE skip_reason = 'UNRECOGNISED_STATUS';
  SELECT count(*) INTO v_draft FROM gc017_plan
   WHERE skip_reason = 'DRAFT_TEMPLATE_NEVER_ISSUED';
  SELECT count(*) INTO v_already FROM gc017_plan
   WHERE skip_reason = 'ALREADY_MIGRATED';
  SELECT count(*) INTO v_orphan_archived FROM gc017_plan
   WHERE skip_reason = 'ARCHIVED_WITH_NO_CODE_NEEDS_REVIEW';
  SELECT count(*) INTO v_bad_face FROM gc017_plan
   WHERE skip_reason = 'NON_POSITIVE_FACE_VALUE';

  -- Cumulative, not per-run: an issued card that a previous run already
  -- retired still counts, which is what makes the second run's report read the
  -- same as the first.
  SELECT count(*) INTO v_retired
    FROM gift_cards g
   WHERE g.status = 'ARCHIVED'
     AND EXISTS (SELECT 1 FROM gift_card_codes c WHERE c.template_id = g.id);

  -- Wallets this run is responsible for. The reference is the exact answer, and
  -- counting it separately from the plan keeps the two from disagreeing.
  SELECT count(DISTINCT r.wallet_id),
         count(*),
         COALESCE(sum(r.amount), 0)
    INTO v_wallets, v_credits, v_credit_value
    FROM customer_reward_transactions r
   WHERE r.reference LIKE 'MIGRATION:%';

  -- The scheduled rows, split by why.
  SELECT count(*) INTO v_scheduled_seen
    FROM gift_card_scheduled
   WHERE status = 'SENT' AND card_uuid IS NOT NULL;
  SELECT count(*) INTO v_scheduled_linked
    FROM gc017_link l
   WHERE l.candidates = 1
     AND EXISTS (
       SELECT 1 FROM gift_card_deliveries d
        WHERE d.code_id = l.code_id
          AND d.channel = 'EMAIL'
          AND d.status = 'SENT'
          AND d.scheduled_for = l.scheduled_for
          AND d.recipient_email = l.recipient_email
     );
  SELECT count(*) INTO v_scheduled_lost
    FROM gift_card_scheduled s
   WHERE s.status = 'SENT'
     AND s.card_uuid IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM gc017_link l
        WHERE l.scheduled_id = s.id AND l.candidates = 1
     );
  SELECT COALESCE(string_agg(s.card_uuid::TEXT, ', '), '(none)')
    INTO v_lost_uuids
    FROM gift_card_scheduled s
   WHERE s.status = 'SENT'
     AND s.card_uuid IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM gc017_link l
        WHERE l.scheduled_id = s.id AND l.candidates = 1
     );
  SELECT count(*) INTO v_scheduled_no_key
    FROM gift_card_scheduled WHERE status = 'SENT' AND card_uuid IS NULL;
  SELECT count(*) INTO v_scheduled_other
    FROM gift_card_scheduled WHERE status <> 'SENT';

  -- Read-only, and only so the report can state that the money did not move.
  SELECT COALESCE(sum(balance), 0) INTO v_legacy_value FROM gift_cards;
  SELECT count(*) INTO v_ledger_rows FROM gift_card_transactions;

  RAISE NOTICE '==============================================================';
  RAISE NOTICE '017 gift-card data migration — summary';
  RAISE NOTICE '--------------------------------------------------------------';
  RAISE NOTICE 'legacy gift_cards rows seen:                               %', v_legacy_total;
  RAISE NOTICE 'gift_card_codes rows created by this run:                 %', v_created;
  RAISE NOTICE '  code already existed, nothing written (re-run):         %', v_existing;
  RAISE NOTICE '  already retired by an earlier run, nothing written:     %', v_already;
  RAISE NOTICE '  draft templates left unsold, not migrated:             %', v_draft;
  RAISE NOTICE '  SKIPPED, no hash and no plaintext code:                 %', v_no_identity;
  RAISE NOTICE '  SKIPPED, hash could not be derived (no sha256):        %', v_no_sha256;
  RAISE NOTICE '  SKIPPED, no last4 and no plaintext code:                %', v_no_last4;
  RAISE NOTICE '  SKIPPED, unrecognised legacy status:                    %', v_bad_status;
  RAISE NOTICE '  SKIPPED, non-positive face value:                       %', v_bad_face;
  RAISE NOTICE '  SKIPPED, hash already used by another code:            %', v_hash_collision;
  RAISE NOTICE '  NEEDS REVIEW, ARCHIVED with no code row:                %', v_orphan_archived;
  RAISE NOTICE 'wallets created (from MIGRATION: credits):               %', v_wallets;
  RAISE NOTICE 'wallet credits issued (from MIGRATION: credits):          %', v_credits;
  RAISE NOTICE '  value credited:                                        INR %', v_credit_value;
  RAISE NOTICE 'scheduled deliveries SENT with a card_uuid:               %', v_scheduled_seen;
  RAISE NOTICE '  attached to a migrated code:                           %', v_scheduled_linked;
  RAISE NOTICE '  NOT attached, no single matching code:                 %', v_scheduled_lost;
  RAISE NOTICE '  NOT attached, SENT row has no card_uuid:                %', v_scheduled_no_key;
  RAISE NOTICE '  not applicable, never sent (PENDING/FAILED/CANCELLED):  %', v_scheduled_other;
  IF v_scheduled_lost > 0 OR v_scheduled_no_key > 0 THEN
    RAISE NOTICE '  unattached card_uuids needing manual review: %', v_lost_uuids;
  END IF;
  RAISE NOTICE '--------------------------------------------------------------';
  RAISE NOTICE 'unchanged on purpose — gift_cards row count: %, balance total: INR %', v_legacy_total, v_legacy_value;
  RAISE NOTICE 'unchanged on purpose — gift_card_transactions rows: %', v_ledger_rows;
  RAISE NOTICE 'retired to ARCHIVED, issued cards (cumulative):  %', v_retired;
  RAISE NOTICE '==============================================================';
END $$;

-- The helper has done its job and is not part of the schema, so it does not
-- stay in the database. Nothing below this line refers to it.
DROP FUNCTION IF EXISTS gc_migrate_code_hash(TEXT);
