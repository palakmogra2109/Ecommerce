-- Who revoked a code, recorded properly.
--
-- 015 gave gift_card_codes revoked_at and revoked_reason but no actor column, so
-- revokeInTx() had nowhere to put the admin who voided a code and was folding
-- the admin's name into the free-text reason. That loses the distinction between
-- "CS revoked this" and "the reason recorded was CS revoked this", which is
-- exactly the question asked when a disputed code has to be traced.
--
-- Nullable on purpose: a code can also lapse on its own with no actor at all,
-- and a migration may revoke in bulk. NULL means "nobody, or nobody recorded".
ALTER TABLE gift_card_codes
  ADD COLUMN IF NOT EXISTS revoked_by BIGINT REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS gift_card_codes_revoked_by_idx
  ON gift_card_codes(revoked_by)
  WHERE revoked_by IS NOT NULL;
