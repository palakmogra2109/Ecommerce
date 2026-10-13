-- ============================================================================
-- Attribute values become attribute rows
-- ----------------------------------------------------------------------------
-- Attribute values did not need their own table. A value IS an attribute that
-- belongs to another attribute, so this folds attribute_values into attributes
-- with a self-referencing parent_id:
--
--   parent_id IS NULL      -> a real attribute ("Colour", "Weight")
--   parent_id IS NOT NULL  -> a value of that attribute ("Black", "5kg")
--
-- One table, one code path, and the Attributes module and the Attribute Values
-- module are just two filters over the same rows — the same split categories and
-- sub-categories already use via parent_id.
--
-- UNIQUE CONSTRAINT CHANGED — READ THIS BEFORE ADDING VALUES.
--
-- slug was globally UNIQUE, which is fine when every row is a top-level
-- attribute but wrong once values live here: "Black" must be legal under BOTH
-- Colour and Size. Replaced with two partial unique indexes:
--
--   root attributes  -> unique on slug
--   values            -> unique on (parent_id, slug)
--
-- So "Black" can exist under Colour and under Size, but not twice under Colour.
-- ON DELETE CASCADE: deleting an attribute removes its values. A value with no
-- parent is meaningless.
-- ============================================================================

-- ── 1. Move existing values in, before the table goes ──────────────────────
-- Idempotent: only runs while the old table still exists.
DO $$
BEGIN
  IF to_regclass('public.attribute_values') IS NOT NULL THEN
    ALTER TABLE attributes
      ADD COLUMN IF NOT EXISTS parent_id BIGINT REFERENCES attributes(id) ON DELETE CASCADE;

    INSERT INTO attributes (name, slug, status, parent_id)
    SELECT v.name, v.slug, v.status, a.id
      FROM attribute_values v
      JOIN attributes a ON a.id = v.parent_id
     WHERE NOT EXISTS (
       SELECT 1 FROM attributes e
        WHERE e.parent_id = a.id AND e.slug = v.slug
     );
  END IF;
END
$$;

ALTER TABLE attributes
  ADD COLUMN IF NOT EXISTS parent_id BIGINT REFERENCES attributes(id) ON DELETE CASCADE;

-- ── 2. Swap the global slug uniqueness for per-parent uniqueness ───────────
ALTER TABLE attributes DROP CONSTRAINT IF EXISTS attributes_slug_key;
DROP INDEX IF EXISTS attributes_slug_key;

-- Top-level attributes keep a unique slug among themselves.
CREATE UNIQUE INDEX IF NOT EXISTS attributes_root_slug_key
  ON attributes (slug)
  WHERE parent_id IS NULL;

-- Values are unique only within their own parent attribute.
CREATE UNIQUE INDEX IF NOT EXISTS attributes_value_slug_key
  ON attributes (parent_id, slug)
  WHERE parent_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS attributes_parent_id_idx
  ON attributes (parent_id);

-- ── 3. value_count -> child_count (it now counts child attribute rows) ─────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'attributes' AND column_name = 'value_count'
  ) THEN
    ALTER TABLE attributes RENAME COLUMN value_count TO child_count;
  END IF;
END
$$;

ALTER TABLE attributes
  ADD COLUMN IF NOT EXISTS child_count INTEGER NOT NULL DEFAULT 0;

-- ── 4. Keep child_count honest ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION sync_attribute_child_count()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE attributes SET child_count = child_count + 1 WHERE id = NEW.parent_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE attributes SET child_count = GREATEST(child_count - 1, 0) WHERE id = OLD.parent_id;
  ELSIF TG_OP = 'UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
    UPDATE attributes SET child_count = GREATEST(child_count - 1, 0) WHERE id = OLD.parent_id;
    UPDATE attributes SET child_count = child_count + 1 WHERE id = NEW.parent_id;
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS attribute_values_sync_count ON attributes;

-- No WHEN clause: on DELETE, NEW is not available, so the guard has to live
-- inside the function (which already checks parent_id before counting).
CREATE TRIGGER attributes_sync_child_count
AFTER INSERT OR DELETE OR UPDATE OF parent_id ON attributes
FOR EACH ROW
EXECUTE FUNCTION sync_attribute_child_count();

-- Backfill / correct any drift. Idempotent.
UPDATE attributes a
   SET child_count = (
         SELECT COUNT(*)::int FROM attributes c WHERE c.parent_id = a.id
       )
 WHERE a.child_count <> (
         SELECT COUNT(*)::int FROM attributes c WHERE c.parent_id = a.id
       );

-- ── 5. Retire the separate table ───────────────────────────────────────────
DROP TRIGGER IF EXISTS attribute_values_sync_count ON attribute_values;
DROP FUNCTION IF EXISTS sync_attribute_value_count();
DROP TABLE IF EXISTS attribute_values;
