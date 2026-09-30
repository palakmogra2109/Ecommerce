// Scope predicates for the public storefront catalog
// (app/api/store/products/route.js). Extracted so the SQL that decides *which
// products a shopper at a given pincode/coordinate can see* is testable on its
// own: the route builds it, and the verifier runs the very same strings against
// the live schema, so the two can never drift apart.

// branch_products is a folded table (sql/inventory.md) and branches is folded
// too, so every column here is the lowercase spelling the database actually has.
// `params` is the caller's shared bind array: the returned conditions reference
// it by the position each value was pushed to, so a caller that appends more
// parameters afterwards must re-render the conditions.
export function buildLocationPredicates({ pincode = "", lat = 0, lng = 0, params, branchIdColumn }) {
  if (!Array.isArray(params)) throw new Error("params must be an array");
  if (!branchIdColumn || typeof branchIdColumn !== "string") throw new Error("branchIdColumn is required");
  const conditions = [];

  // Normalised rather than compared against 0 directly: `undefined !== 0` is
  // true, so a caller that simply omits lat/lng would otherwise get a radius
  // condition built from NaN. The route always passes parseFloat() results, but
  // this builder is exported and must not depend on the caller's discipline.
  const latNum = Number(lat) || 0;
  const lngNum = Number(lng) || 0;

  if (pincode) {
    params.push(`${pincode}%`);
    params.push(`${pincode}`);
    // Scoped with EXISTS rather than `INNER JOIN branches`: the join multiplied
    // one product into one row per matching branch, and it collided with the
    // `brands b` alias already in the select list (42712 "table name b specified
    // more than once"), which is what 500'd the route.
    conditions.push(
      `EXISTS (SELECT 1 FROM branches nb WHERE (nb.postalcode LIKE $${params.length - 1} OR nb.postalcode = $${params.length}) AND nb.status = 'ACTIVE' AND nb.deliveryenabled = TRUE AND nb.id = ${branchIdColumn})`,
    );
  }

  if (latNum !== 0 && lngNum !== 0) {
    const maxLat = 50 / 111.32;
    const maxLng = 50 / (111.32 * Math.cos((latNum * Math.PI) / 180));
    // The bind positions are captured explicitly. Deriving them from
    // `params.length - n` reads correctly but is wrong: with [lat, lng, maxLat,
    // maxLng] pushed, `length - 3` and `length - 2` are $1 and $2, which binds
    // the latitude box to lat ± lng - a ~161°-tall box that never filtered
    // anything - and shifts the longitude box onto maxLat ± maxLng.
    const latIdx = params.push(latNum);
    const lngIdx = params.push(lngNum);
    const maxLatIdx = params.push(maxLat);
    const maxLngIdx = params.push(maxLng);
    // The ::numeric casts are load-bearing: node-postgres sends a JS number as
    // an untyped parameter, so `$1 - $3` on its own is "unknown - unknown" and
    // Postgres rejects it with 42725 (operator is not unique).
    conditions.push(
      `EXISTS (SELECT 1 FROM branches nb WHERE nb.latitude BETWEEN $${latIdx}::numeric - $${maxLatIdx}::numeric AND $${latIdx}::numeric + $${maxLatIdx}::numeric AND nb.longitude BETWEEN $${lngIdx}::numeric - $${maxLngIdx}::numeric AND $${lngIdx}::numeric + $${maxLngIdx}::numeric AND nb.status = 'ACTIVE' AND nb.deliveryenabled = TRUE AND nb.id = ${branchIdColumn})`,
    );
  }

  return conditions;
}

export function buildBranchScope({ branchId, pincode, lat, lng, params }) {
  const conditions = [];

  if (branchId) {
    params.push(branchId);
    conditions.push(`bp.branchid = (SELECT id FROM branches WHERE uuid = $${params.length})`);
  }

  conditions.push(...buildLocationPredicates({ pincode, lat, lng, params, branchIdColumn: "bp.branchid" }));

  return { conditions, scoped: conditions.length > 0 };
}
