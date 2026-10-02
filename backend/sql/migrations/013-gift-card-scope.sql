-- Scope a gift card to particular brands, in line with categories and products.
--
-- The applicable_* columns already exist from 005 and were only ever unused
-- after scope rules were removed. They are being put back into use, so this adds
-- the one that was missing: brand.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS applicable_brands JSONB NOT NULL DEFAULT '[]';

-- Admin-uploaded or supplied art. Blank means use the generated SVG art.
ALTER TABLE gift_cards ADD COLUMN IF NOT EXISTS image_url TEXT;
