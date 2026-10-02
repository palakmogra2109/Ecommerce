-- Remove the columns added by 008. Scheduling is handled by the
-- gift_card_scheduled table instead, so nothing reads these any more.
--
-- Safe to leave in place, but dead columns invite someone to write to them
-- expecting them to work.
ALTER TABLE gift_cards DROP COLUMN IF EXISTS scheduled_for;
ALTER TABLE gift_cards DROP COLUMN IF EXISTS recipient_name;
ALTER TABLE gift_cards DROP COLUMN IF EXISTS gift_message;

DROP INDEX IF EXISTS gift_cards_due_idx;
