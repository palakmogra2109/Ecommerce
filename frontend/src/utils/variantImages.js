// Reading a variant's images, whatever shape they arrive in.
//
// A variant's images are stored as `images: string[]`. The first version of
// this feature stored a single `image: string`, and those rows are still in the
// database — `variants` is a JSONB column on `products`, so there is no schema
// to migrate and no column to backfill. Normalising on read means every existing
// product picks up the array shape for free, and the old key simply stops being
// written the next time that product is saved.
//
// Everything that touches variant images goes through here rather than reaching
// for `variant.images` directly, so the legacy shape has exactly one home.

/**
 * A variant's images as an array, never null.
 * Accepts the legacy single `image` string.
 */
export function variantImages(variant) {
  if (!variant) {
    return [];
  }

  if (Array.isArray(variant.images)) {
    return variant.images.filter(Boolean);
  }

  if (typeof variant.image === "string" && variant.image) {
    return [variant.image];
  }

  return [];
}

/** True when every variant carries exactly the same list of images. */
export function allVariantsShareImages(variants) {
  const list = Array.isArray(variants) ? variants : [];

  if (list.length === 0) {
    return false;
  }

  const first = variantImages(list[0]);

  return list.every((variant) => {
    const images = variantImages(variant);

    return (
      images.length === first.length &&
      images.every((path, i) => path === first[i])
    );
  });
}

/** Distinct values of one attribute across the variants, in first-seen order. */
export function attributeValues(variants, attributeName) {
  const seen = [];
  const known = new Set();

  for (const variant of Array.isArray(variants) ? variants : []) {
    const value = variant?.attributes?.[attributeName];

    if (value == null || value === "") {
      continue;
    }

    const key = String(value).toLowerCase();

    if (!known.has(key)) {
      known.add(key);
      seen.push(value);
    }
  }

  return seen;
}

/** Attribute names present on the variants, in first-seen order. */
export function variantAttributeNames(variants) {
  const seen = [];
  const known = new Set();

  for (const variant of Array.isArray(variants) ? variants : []) {
    for (const name of Object.keys(variant?.attributes || {})) {
      if (!known.has(name)) {
        known.add(name);
        seen.push(name);
      }
    }
  }

  return seen;
}

/**
 * The image list to show for one attribute value: whatever the first variant
 * carrying that value has. By-attribute mode writes to every matching variant at
 * once, so in normal use they all agree — but a product hand-edited before this
 * existed may not, and showing the first is a better guess than showing nothing.
 */
export function imagesForAttributeValue(variants, attributeName, value) {
  const match = (Array.isArray(variants) ? variants : []).find(
    (variant) => variant?.attributes?.[attributeName] === value
  );

  return variantImages(match);
}
