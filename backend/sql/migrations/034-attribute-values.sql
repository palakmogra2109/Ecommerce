-- ============================================================================
-- Attribute values
-- ----------------------------------------------------------------------------
-- Attribute VALUES (the "Black", the "5kg", the "XL") were previously free text
-- typed per product and stored inside the product's JSONB. There was no central
-- list: an attribute record held only a name and a slug, so nothing could be
-- reused, misspelled consistently, or reported on. This table is that list.
--
-- A value belongs to exactly one attribute, named by parent_id, so "Black" under
-- Colour is a different row from "Black" under Size and the two never collide.
--
-- UNIQUE (parent_id, slug) rather than a global UNIQUE(slug) like categories:
-- a value slug is only unique WITHIN its attribute. "Black" must be legal under
-- both Colour and Size, but not twice under Colour.
--
-- ON DELETE CASCADE: a value with no parent attribute is meaningless, so
-- removing an attribute removes its values. (categories uses ON DELETE SET NULL
-- only because a sub-category can be promoted to a top-level category; there is
-- no equivalent promotion here.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS attribute_values (
  id         BIGSERIAL PRIMARY KEY,
  uuid       UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  parent_id  BIGINT NOT NULL REFERENCES attributes(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  slug       TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'ACTIVE'
             CHECK (status IN ('ACTIVE', 'INACTIVE')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (parent_id, slug)
);

-- The listing is always "one attribute's values" or "everything", so parent_id
-- is on the hot path for both.
CREATE INDEX IF NOT EXISTS attribute_values_parent_id_idx
  ON attribute_values (parent_id);

CREATE INDEX IF NOT EXISTS attribute_values_status_idx
  ON attribute_values (status);

-- How many values each attribute owns, for the attributes listing. Kept as a
-- column rather than computed on every row so the count is available to the
-- attributes module without a second round trip.
ALTER TABLE attributes
  ADD COLUMN IF NOT EXISTS value_count INTEGER NOT NULL DEFAULT 0;

-- Kept honest by the model on every write, so a drift can always be corrected
-- with the statement at the bottom of this file rather than a hand edit.
CREATE OR REPLACE FUNCTION sync_attribute_value_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE attributes
       SET value_count = value_count + 1
     WHERE id = NEW.parent_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE attributes
       SET value_count = GREATEST(value_count - 1, 0)
     WHERE id = OLD.parent_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    UPDATE attributes
       SET value_count = GREATEST(value_count - 1, 0)
     WHERE id = OLD.parent_id;
    UPDATE attributes
       SET value_count = value_count + 1
     WHERE id = NEW.parent_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS attribute_values_sync_count ON attribute_values;

CREATE TRIGGER attribute_values_sync_count
AFTER INSERT OR DELETE OR UPDATE OF parent_id ON attribute_values
FOR EACH ROW EXECUTE FUNCTION sync_attribute_value_count();

-- Backfill for rows that already exist, and for any table created by an older
-- run of this migration. Idempotent.
UPDATE attributes a
   SET value_count = (
         SELECT COUNT(*)::int FROM attribute_values v WHERE v.parent_id = a.id
       )
 WHERE a.value_count <> (
         SELECT COUNT(*)::int FROM attribute_values v WHERE v.parent_id = a.id
       );
