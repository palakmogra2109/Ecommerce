import test from "node:test";
import assert from "node:assert/strict";

// Pure string builder - no pool, no env, no database.
const { buildBranchScope } = await import("../storeCatalogScope.js");

function build(input) {
  const params = [];
  const result = buildBranchScope({ ...input, params });
  return { ...result, params };
}

test("no location input produces no conditions, so the route can tell it apart from a match", () => {
  const { conditions, scoped, params } = build({});
  assert.equal(scoped, false);
  assert.deepEqual(conditions, []);
  assert.deepEqual(params, []);
});

test("omitting lat/lng is treated as no location, not as a NaN radius", () => {
  // `undefined !== 0` is true, so a naive `lat !== 0 && lng !== 0` check would
  // build a radius condition out of NaN and scope every request.
  for (const input of [{ pincode: "400001" }, { branchId: "b-1" }, {}]) {
    const { conditions, params } = build(input);
    assert.equal(
      conditions.some((c) => c.includes("latitude BETWEEN")),
      false,
      `lat/lng was inferred for ${JSON.stringify(input)}`,
    );
    assert.equal(params.some((p) => Number.isNaN(p)), false, `NaN was bound for ${JSON.stringify(input)}`);
  }
});

test("a partial coordinate pair does not scope the catalog", () => {
  // lat without lng (or the reverse) is not a location.
  assert.equal(build({ lat: 19.076 }).scoped, false);
  assert.equal(build({ lng: 72.8777 }).scoped, false);
});

test("the pincode predicate binds the prefix and the exact value, in that order", () => {
  const { conditions, params, scoped } = build({ pincode: "400001" });
  assert.equal(scoped, true);
  assert.equal(conditions.length, 1);
  assert.match(conditions[0], /nb\.postalcode LIKE \$1 OR nb\.postalcode = \$2/);
  assert.deepEqual(params, ["400001%", "400001"]);
  // A branch must serve the pincode, be ACTIVE, have delivery on, and own the
  // listing being tested.
  assert.match(conditions[0], /nb\.status = 'ACTIVE'/);
  assert.match(conditions[0], /nb\.deliveryenabled = TRUE/);
  assert.match(conditions[0], /nb\.id = bp\.branchid/);
});

test("the radius predicate pairs each axis with its own delta", () => {
  // The bug this pins: deriving the placeholders from `params.length - n` binds
  // the latitude box to lat ± lng and the longitude box to maxLat ± maxLng.
  const { conditions, params, scoped } = build({ lat: 19.076, lng: 72.8777 });
  assert.equal(scoped, true);
  assert.equal(conditions.length, 1);

  const [lat, lng, maxLat, maxLng] = params;
  assert.equal(params.length, 4);
  // $1 ± $3 and $2 ± $4 - latitude with the latitude delta, longitude with the
  // longitude delta.
  assert.match(
    conditions[0],
    new RegExp(`latitude BETWEEN \\$1::numeric - \\$3::numeric AND \\$1::numeric \\+ \\$3::numeric`),
    `latitude box is not lat ± maxLat: ${conditions[0]}`,
  );
  assert.match(
    conditions[0],
    new RegExp(`longitude BETWEEN \\$2::numeric - \\$4::numeric AND \\$2::numeric \\+ \\$4::numeric`),
    `longitude box is not lng ± maxLng: ${conditions[0]}`,
  );
  // Guard against the original defect explicitly.
  assert.doesNotMatch(conditions[0], /latitude BETWEEN \$1::numeric - \$2::numeric/);
  assert.doesNotMatch(conditions[0], /longitude BETWEEN \$3::numeric - \$4::numeric/);
  // The deltas must actually be deltas, not coordinates.
  assert.ok(maxLat > 0 && maxLat < 1, `maxLat should be a small degree delta, got ${maxLat}`);
  assert.ok(maxLng > 0 && maxLng < 1, `maxLng should be a small degree delta, got ${maxLng}`);
  assert.ok(Math.abs(lat) > 1 && Math.abs(lng) > 1, "coordinates are not degree values");
  // node-postgres sends an untyped number, so the casts are load-bearing.
  assert.match(conditions[0], /::numeric - \$/);
});

test("the branchId predicate resolves the uuid through the branches subselect", () => {
  const { conditions, params, scoped } = build({ branchId: "b-uuid-1" });
  assert.equal(scoped, true);
  assert.match(conditions[0], /bp\.branchid = \(SELECT id FROM branches WHERE uuid = \$1\)/);
  assert.deepEqual(params, ["b-uuid-1"]);
});

test("combined inputs each get their own bind position and all must hold", () => {
  const { conditions, params, scoped } = build({
    branchId: "b-uuid-1",
    pincode: "400001",
    lat: 19.076,
    lng: 72.8777,
  });
  assert.equal(scoped, true);
  assert.equal(conditions.length, 3);
  // $1 branchId, $2/$3 pincode, $4..$7 radius - the positions must not collide.
  assert.match(conditions[0], /uuid = \$1/);
  assert.match(conditions[1], /postalcode LIKE \$2 OR nb\.postalcode = \$3/);
  assert.match(conditions[2], /latitude BETWEEN \$4::numeric - \$6::numeric/);
  assert.match(conditions[2], /longitude BETWEEN \$5::numeric - \$7::numeric/);
  assert.deepEqual(params, ["b-uuid-1", "400001%", "400001", 19.076, 72.8777,
    50 / 111.32, 50 / (111.32 * Math.cos((19.076 * Math.PI) / 180))]);
});

test("the builder never emits a bare SELECT * and uses folded column spellings", () => {
  // branches and branch_products are folded tables (sql/inventory.md).
  const { conditions } = build({ branchId: "b", pincode: "400001", lat: 1, lng: 1 });
  const all = conditions.join(" ");
  assert.doesNotMatch(all, /\bpostalCode\b|\bdeliveryEnabled\b|\bbranchId =|branch_id/);
  assert.match(all, /postalcode/);
  assert.match(all, /deliveryenabled/);
});
