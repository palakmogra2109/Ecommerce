-- Retire the legacy gift_cards rows that are not products.
--
-- THE SITUATION. gift_cards is now the TEMPLATE table — the thing a shopper
-- actually buys, as lib/services/purchaseGiftCard.js's loadTemplate and
-- assertSellable read it — but the seven rows it still holds are ISSUED cards
-- from the old direct-spend system. Five of them (ids 3, 22, 50, 51, 57) were
-- moved into gift_card_codes by 017-migrate-cards-to-codes.sql, which also
-- retired them to ARCHIVED; something re-activated them afterwards, so all seven
-- read ACTIVE today. Ids 58 and 59 were issued from the admin panel AFTER that
-- migration and have no v2 code at all.
--
-- All seven carry is_active = TRUE and face_value IS NULL, and that NULL is the
-- only thing stopping the storefront from selling card 22 as a ₹44 product,
-- because assertSellable refuses a template with no face value. One accidental
-- guard standing in for a real one. This migration replaces it with the actual
-- marker: ARCHIVED, which is the first thing the sell path checks.
--
-- WHAT IT DOES. status = 'ARCHIVED', and nothing else. No row is deleted. No
-- balance and no initial_amount is touched. No existing ledger row is rewritten
-- or removed. Two rows (58, 59) each gain exactly ONE new gift_card_transactions
-- row recording the retirement; the five already-migrated rows gain none,
-- because their audit trail already exists — 017 wrote their codes, stamped a
-- revocation reason on each, and deliberately left gift_card_transactions alone.
--
-- WHY IT IS SAFE TO RUN AGAIN. Everything happens in one transaction, and every
-- write is guarded on the value it is changing: both UPDATEs require
-- status <> 'ARCHIVED', and the ledger INSERT carries a NOT EXISTS on its own
-- migration marker. A second run therefore matches nothing, and the notices at
-- the bottom print 0 and 0. 017 made the same promise about its own step.
--
-- WHY is_active IS LEFT ALONE. status is what the sell path checks, and ARCHIVED
-- is enough on its own; 017 chose the same, recording the is_active question as
-- a follow-up rather than making a second unrequested change to the same seven
-- rows. The second guard against a re-activation accident is that these rows
-- still carry no face_value, so a flipped-back status would still fail
-- assertSellable — the same accidental guard as before, now deliberate.

DO $$
DECLARE
  -- Opened before anything is written, so the report can prove the money did not
  -- move rather than merely assert it.
  v_before_rows          INTEGER;
  v_before_balance       NUMERIC(12,2);
  v_before_initial       NUMERIC(12,2);
  v_before_ledger        INTEGER;

  -- The rows this run is retiring, decided ONCE. Both statements below work from
  -- this list, which is what keeps the archive and its ledger row from describing
  -- different sets of rows.
  v_unmigrated_ids       BIGINT[] := '{}';
  v_migrated_count       INTEGER  := 0;
  v_unmigrated_count     INTEGER  := 0;
  v_ledger_written       INTEGER  := 0;

  v_after_rows           INTEGER;
  v_after_balance        NUMERIC(12,2);
  v_after_initial        NUMERIC(12,2);
  v_after_ledger         INTEGER;
  v_archived_with_code   INTEGER;
  v_archived_no_code     INTEGER;
  v_retirement_ledger    INTEGER;
  v_skipped_guard        INTEGER;
  v_still_accidentally_on_sellable INTEGER;
BEGIN
  SELECT count(*)::INTEGER,
         COALESCE(SUM(balance), 0),
         COALESCE(SUM(initial_amount), 0),
         (SELECT count(*)::INTEGER FROM gift_card_transactions)
    INTO v_before_rows, v_before_balance, v_before_initial, v_before_ledger
    FROM gift_cards;

  ---------------------------------------------------------------------------
  -- THE DISCRIMINATOR, stated once so both steps below are read the same way:
  --
  --   face_value IS NULL  <=>  this row was never a sellable template.
  --
  -- POST /api/store/gift-cards/templates refuses a create without a positive
  -- faceValue and writes face_value and initial_amount from that one number, so a
  -- genuine template can never have a NULL face value. The guard can therefore
  -- only ever PREVENT this migration from archiving a real product; it cannot
  -- exclude one of the seven rows this migration is for, all seven of which are
  -- NULL there today.
  --
  -- It is not here to be clever about the present. It is here because this file is
  -- a migration: "archive every row with no code row" would quietly archive the
  -- first real template somebody sells, and 017's own SKIP table already shows
  -- what a code row does and does not prove about a row.
  ---------------------------------------------------------------------------

  -- -------------------------------- 1. already-migrated rows: status, nothing else
  --
  -- A row in gift_card_codes IS 017's own definition of "already migrated" — that
  -- migration's plan table keyed ALREADY_MIGRATED off exactly this test. So these
  -- rows are retired and otherwise untouched: no ledger row (their history is the
  -- code rows themselves, and 017 wrote none here on purpose), no balance change,
  -- is_active untouched.
  UPDATE gift_cards g
     SET status = 'ARCHIVED',
         updated_at = now()
   WHERE g.face_value IS NULL
     AND g.status <> 'ARCHIVED'
     AND EXISTS (SELECT 1 FROM gift_card_codes c WHERE c.template_id = g.id);
  -- 017 used the same idiom for its own retirement step.
  GET DIAGNOSTICS v_migrated_count = ROW_COUNT;

  -- ---------------------------------- 2. un-migrated rows: the ids, chosen once
  --
  -- A genuine admin-issued card that nobody has redeemed. It is still real money
  -- owed to its recipient, so it is retired AS A TEMPLATE and nothing else:
  -- balance and initial_amount stay exactly as they are, because the retirement is
  -- about the sellable side of the row and has no business touching the stored
  -- value side.
  SELECT COALESCE(array_agg(g.id), '{}'::BIGINT[])
    INTO v_unmigrated_ids
    FROM gift_cards g
   WHERE g.face_value IS NULL
     AND g.status <> 'ARCHIVED'
     AND NOT EXISTS (SELECT 1 FROM gift_card_codes c WHERE c.template_id = g.id);

  UPDATE gift_cards
     SET status = 'ARCHIVED',
         updated_at = now()
   WHERE id = ANY(v_unmigrated_ids)
     -- Belt and braces against a concurrent writer inside this transaction: only
     -- a row still in a retirable state is retired.
     AND status <> 'ARCHIVED';
  GET DIAGNOSTICS v_unmigrated_count = ROW_COUNT;

  -- ---------------------------------------------------- 3. one ledger row each
  --
  -- WHY 'CANCELLED' AND NOT SOMETHING ELSE. The CHECK on
  -- gift_card_transactions.type admits ISSUE, PURCHASED, ACTIVATED, REDEEM,
  -- REFUND, REVERSAL, ADJUSTMENT, EXPIRED and CANCELLED, and only CANCELLED means
  -- what this is. Every alternative would be a lie about the money:
  --
  --   ISSUE / PURCHASED  these rows already carry one of those, and this is a new
  --                      event, not their issuance.
  --   ACTIVATED          a state transition with no money — describing activating
  --                      a card, not retiring one.
  --   REDEEM             money left the card. None did.
  --   REFUND / REVERSAL  money came back. None did.
  --   ADJUSTMENT         means the balance moved. This is the one that would be
  --                      actively dangerous: GiftCard.adjust() uses it for real
  --                      corrections, so a reader reconciling the ledger would
  --                      count a zero-amount retirement as a correction.
  --   EXPIRED            the card has not expired. Card 50's expires_at is in
  --                      1972 because it was REVOKED, and filing that under
  --                      EXPIRED would replace the true reason with a plausible
  --                      one.
  --
  -- So: amount 0, and balance_before = balance_after = the unchanged balance. The
  -- row says "this card was retired, and no money moved", which is exactly what
  -- happened and is the whole point of the audit trail here.
  --
  -- THE NOT EXISTS is the idempotency guard, and it is independent of the status
  -- guard above. Flip a row back to ACTIVE by hand and re-run this migration: the
  -- row is archived again, and no second ledger row is written for it.
  INSERT INTO gift_card_transactions
    (gift_card_id, type, amount, balance_before, balance_after, performed_by, reason, metadata)
  SELECT g.id,
         'CANCELLED',
         0,
         g.balance,
         g.balance,
         'migration:020',
         'Retired as a sellable gift card: legacy issued card, not a template. Balance unchanged.',
         '{"migration":"020-retire-legacy-gift-cards"}'::jsonb
    FROM gift_cards g
   WHERE g.id = ANY(v_unmigrated_ids)
     AND NOT EXISTS (
           SELECT 1
             FROM gift_card_transactions t
            WHERE t.gift_card_id = g.id
              AND t.metadata @> '{"migration":"020-retire-legacy-gift-cards"}'::jsonb
          );
  GET DIAGNOSTICS v_ledger_written = ROW_COUNT;

  ---------------------------------------------------------------------- report
  --
  -- Everything an operator needs is here, because a migration that has to be
  -- interrogated with queries afterwards has already lost the argument for being
  -- run in a hurry. Cumulative where 017 used cumulative, because that is what
  -- makes a second run's report read the same as the first.
  SELECT count(*)::INTEGER,
         COALESCE(SUM(balance), 0),
         COALESCE(SUM(initial_amount), 0),
         (SELECT count(*)::INTEGER FROM gift_card_transactions)
    INTO v_after_rows, v_after_balance, v_after_initial, v_after_ledger
    FROM gift_cards;

  SELECT count(*)::INTEGER INTO v_archived_with_code
    FROM gift_cards g
   WHERE g.status = 'ARCHIVED'
     AND EXISTS (SELECT 1 FROM gift_card_codes c WHERE c.template_id = g.id);

  SELECT count(*)::INTEGER INTO v_archived_no_code
    FROM gift_cards g
   WHERE g.status = 'ARCHIVED'
     AND NOT EXISTS (SELECT 1 FROM gift_card_codes c WHERE c.template_id = g.id);

  SELECT count(*)::INTEGER INTO v_retirement_ledger
    FROM gift_card_transactions
   WHERE metadata @> '{"migration":"020-retire-legacy-gift-cards"}'::jsonb;

  -- A row this migration declined to touch: a face value set, so the create route
  -- could have written it and it is a real product. Reported rather than left
  -- silent, so an operator learns about it here instead of at the storefront.
  SELECT count(*)::INTEGER INTO v_skipped_guard
    FROM gift_cards g
   WHERE g.face_value IS NOT NULL
     AND g.status <> 'ARCHIVED'
     AND NOT EXISTS (SELECT 1 FROM gift_card_codes c WHERE c.template_id = g.id);

  -- Anything still ACTIVE, enabled and without a face value is still sellable by
  -- accident. This is the count that should be zero, and it is printed even when
  -- it is not.
  SELECT count(*)::INTEGER INTO v_still_accidentally_on_sellable
    FROM gift_cards g
   WHERE g.status = 'ACTIVE'
     AND g.is_active
     AND g.face_value IS NULL;

  RAISE NOTICE '==============================================================';
  RAISE NOTICE '020 legacy gift-card retirement — summary';
  RAISE NOTICE '--------------------------------------------------------------';
  RAISE NOTICE 'this run, retired because already migrated (has a code):   %', v_migrated_count;
  RAISE NOTICE 'this run, retired as un-migrated (no code):                 %', v_unmigrated_count;
  RAISE NOTICE 'retirement ledger rows written this run:                   %', v_ledger_written;
  RAISE NOTICE '--------------------------------------------------------------';
  RAISE NOTICE 'now ARCHIVED with a code row (cumulative):                 %', v_archived_with_code;
  RAISE NOTICE 'now ARCHIVED with no code row (cumulative):                %', v_archived_no_code;
  RAISE NOTICE 'retirement ledger rows, cumulative:                        %', v_retirement_ledger;
  RAISE NOTICE '--------------------------------------------------------------';
  RAISE NOTICE 'gift_cards rows, before and after:                        % / %', v_before_rows, v_after_rows;
  RAISE NOTICE '  nothing was deleted, so these must be equal';
  RAISE NOTICE 'balance total, before and after:              INR % / %', v_before_balance, v_after_balance;
  RAISE NOTICE 'initial_amount total, before and after:       INR % / %', v_before_initial, v_after_initial;
  RAISE NOTICE '  both deliberately untouched, so these must be equal';
  RAISE NOTICE 'gift_card_transactions rows, before and after:            % / %', v_before_ledger, v_after_ledger;
  RAISE NOTICE '--------------------------------------------------------------';
  RAISE NOTICE 'rows skipped by the face_value guard (real templates):     %', v_skipped_guard;
  RAISE NOTICE 'still ACTIVE + enabled with no face value:                 %', v_still_accidentally_on_sellable;
  RAISE NOTICE '==============================================================';

  -- The three things this migration promises, checked rather than claimed. Any of
  -- them failing means the file did something other than retire a status, and a
  -- migration that cannot tell the difference should not be trusted to run
  -- unattended against a table holding real balances.
  IF v_before_rows <> v_after_rows THEN
    RAISE EXCEPTION '020: gift_cards row count changed (% -> %); nothing should have been deleted',
      v_before_rows, v_after_rows;
  END IF;
  IF v_before_balance <> v_after_balance OR v_before_initial <> v_after_initial THEN
    RAISE EXCEPTION '020: a balance moved while retiring templates (balance % -> %, initial_amount % -> %)',
      v_before_balance, v_after_balance, v_before_initial, v_after_initial;
  END IF;
  IF (v_after_ledger - v_before_ledger) <> v_ledger_written THEN
    RAISE EXCEPTION '020: gift_card_transactions grew by % but % retirement rows were written',
      v_after_ledger - v_before_ledger, v_ledger_written;
  END IF;
END $$;
