import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import pg from "pg";
import { loadEnv } from "../../scripts/lib/env.mjs";
import "./helpers/aliasHooks.mjs";

await loadEnv();

const base = process.env.DATABASE_URL.replace(/\/[^/]*$/, "/");
const SCRATCH = "gc_geo";
const admin = new pg.Pool({ connectionString: base + "postgres" });
await admin.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
await admin.query(`CREATE DATABASE ${SCRATCH}`);
await admin.end();
process.env.DATABASE_URL = base + SCRATCH;

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
await pool.query(fs.readFileSync("sql/schema.sql", "utf8"));

const { Geo } = await import("../models/geo.js");
const geoCountries = await import("../../app/api/geo/countries/route.js");
const geoStates = await import("../../app/api/geo/states/route.js");
const geoCities = await import("../../app/api/geo/cities/route.js");
const servicePool = (await import("../db.js")).default;

// A real session, so the routes are exercised through authorize() rather than
// around it.
const user = (await pool.query(
  "INSERT INTO users (name,email,password,status) VALUES ('Geo','geo@example.test','x','ACTIVE') RETURNING id"
)).rows[0];
const role = (await pool.query(
  "INSERT INTO roles (name,slug,description,status) VALUES ('Super','super_admin','d','ACTIVE') RETURNING id"
)).rows[0];
await pool.query("INSERT INTO user_has_roles (user_id,role_id) VALUES ($1,$2)", [user.id, role.id]);
const { createToken } = await import("../auth.js");
globalThis.__requestAuth = { token: await createToken({ id: user.id, email: "geo@example.test" }), headers: new Headers() };
const H = { headers: new Headers() };
const url = (q) => ({ headers: new Headers(), url: `http://x${q}` });

// schema.sql creates the geography tables but ships no rows -- the reference
// dataset is loaded separately -- so the fixture is seeded here.
const india = (await pool.query(
  `INSERT INTO countries (name,iso2,iso3,dialcode,status) VALUES ('India','IN','IND','+91','ACTIVE') RETURNING uuid`
)).rows[0].uuid;
const peru = (await pool.query(
  `INSERT INTO countries (name,iso2,iso3,dialcode,status) VALUES ('Peru','PE','PER','+51','ACTIVE') RETURNING uuid`
)).rows[0].uuid;
await pool.query(
  `INSERT INTO countries (name,iso2,iso3,status) VALUES ('Retired Country','ZZ','ZZZ','INACTIVE')`
);
const mh = (await pool.query(
  "INSERT INTO states (name,statecode,countryid,status) VALUES ('Maharashtra','MH',$1,'ACTIVE') RETURNING uuid",
  [india]
)).rows[0].uuid;
const lima = (await pool.query(
  "INSERT INTO states (name,statecode,countryid,status) VALUES ('Lima','LIM',$1,'ACTIVE') RETURNING uuid",
  [peru]
)).rows[0].uuid;
for (const name of ["Pune", "Pimpri", "Pune Division"]) {
  await pool.query("INSERT INTO cities (name,countryid,stateid,status) VALUES ($1,$2,$3,'ACTIVE')", [name, india, mh]);
}
await pool.query(
  "INSERT INTO cities (name,countryid,stateid,status) VALUES ('Lima City',$1,$2,'ACTIVE')", [peru, lima]
);

test.after(async () => {
  await pool.end();
  await servicePool.end().catch(() => {});
  const a = new pg.Pool({ connectionString: base + "postgres" });
  await a.query(`DROP DATABASE IF EXISTS ${SCRATCH} WITH (FORCE)`);
  await a.end();
});

test("only active countries are listed, alphabetically", async () => {
  const rows = await Geo.listCountries();
  assert.deepEqual(rows.map((r) => r.name), ["India", "Peru"]);
});

test("states are scoped to their country", async () => {
  assert.deepEqual((await Geo.listStates({ countryUuid: india })).map((s) => s.name), ["Maharashtra"]);
  assert.deepEqual((await Geo.listStates({ countryUuid: peru })).map((s) => s.name), ["Lima"]);
  assert.equal((await Geo.listStates({ countryUuid: null })).length, 2, "no country means every state");
});

test("cities are scoped to a state", async () => {
  const rows = await Geo.listCities({ stateUuid: mh });
  assert.deepEqual(rows.map((r) => r.name).sort(), ["Pimpri", "Pune", "Pune Division"]);
});

test("a city search filters within the scope", async () => {
  const rows = await Geo.listCities({ stateUuid: mh, search: "Pune" });
  assert.deepEqual(rows.map((r) => r.name), ["Pune", "Pune Division"]);
});

test("an unscoped, unfiltered city query is refused rather than dumping 150k rows", async () => {
  assert.deepEqual(await Geo.listCities({}), []);
});

// cities.stateid is NOT NULL, so a city always hangs off a state; filtering by
// country is therefore the only way to span states.
test("a country can be filtered across all of its states", async () => {
  const rows = await Geo.listCities({ countryUuid: peru });
  assert.deepEqual(rows.map((r) => r.name), ["Lima City"]);
});

test("a bad uuid is treated as no scope, not as a database error", async () => {
  assert.deepEqual(await Geo.listCities({ stateUuid: "not-a-uuid" }), []);
  assert.deepEqual(await Geo.listStates({ countryUuid: "not-a-uuid", search: "" }).then((r) => r.length), 2);
});

test("the city limit is clamped, so a crafted limit cannot dump the table", async () => {
  const rows = await Geo.listCities({ countryUuid: india, limit: 999999 });
  assert.ok(rows.length <= 500, `expected at most 500, got ${rows.length}`);
});

test("a stored country resolves by name, ISO2, ISO3 or uuid", async () => {
  assert.equal((await Geo.findCountry("India")).name, "India");
  assert.equal((await Geo.findCountry("IN")).name, "India", "legacy ISO2 value");
  assert.equal((await Geo.findCountry("ind")).name, "India", "ISO2 is case-insensitive here");
  assert.equal((await Geo.findCountry("IND")).name, "India");
  assert.equal((await Geo.findCountry(india)).name, "India");
  assert.equal(await Geo.findCountry("Nowhereland"), null);
  assert.equal(await Geo.findCountry(""), null);
});

test("GET /api/geo/countries returns the list", async () => {
  const res = await geoCountries.GET();
  assert.equal(res.status, 200);
  const { countries } = await res.json();
  assert.equal(countries.length, 2);
});

test("GET /api/geo/states requires a country to be scoped in practice", async () => {
  const scoped = await geoStates.GET(url(`?country=${india}`));
  assert.equal(scoped.status, 200);
  assert.equal((await scoped.json()).states.length, 1);

  const unscoped = await geoStates.GET(url(""));
  assert.equal(unscoped.status, 200);
  assert.equal((await unscoped.json()).states.length, 2);
});

test("GET /api/geo/cities flags a truncated list so the UI can offer search", async () => {
  const many = await pool.query(
    `INSERT INTO cities (name,countryid,stateid,status)
     SELECT 'Bulk'||g, $1, $2, 'ACTIVE' FROM generate_series(1,60) g`, [india, mh]
  );
  assert.equal(many.rowCount, 60);

  const res = await geoCities.GET(url(`?state=${mh}&limit=50`));
  assert.equal(res.status, 200);
  const payload = await res.json();
  assert.equal(payload.cities.length, 50, "capped at the requested limit");
  assert.equal(payload.truncated, true, "and the caller is told it is partial");

  const few = await geoCities.GET(url(`?state=${mh}&limit=1000`));
  const fewPayload = await few.json();
  assert.equal(fewPayload.cities.length, 63, "all 63 rows fit under the limit");
  assert.equal(fewPayload.truncated, false, "and it is honestly reported as complete");

  // Exactly-full must not be reported as truncated.
  const exact = await pool.query(
    `INSERT INTO cities (name,countryid,stateid,status)
     SELECT 'Edge'||g, $1, $2, 'ACTIVE' FROM generate_series(1,36) g`, [peru, lima]
  );
  assert.equal(exact.rowCount, 36, "36 more, on top of Lima City = 37 in total");
  const edge = await geoCities.GET(url(`?state=${lima}&limit=37`));
  assert.equal((await edge.json()).truncated, false, "exactly 37 of 37 is not truncated");
  const edgePlus = await geoCities.GET(url(`?state=${lima}&limit=36`));
  assert.equal((await edgePlus.json()).truncated, true, "36 of 37 is");
});

test("an unauthenticated geo request is rejected", async () => {
  const saved = globalThis.__requestAuth.token;
  globalThis.__requestAuth.token = null;
  const res = await geoCountries.GET();
  assert.equal(res.status, 401);
  globalThis.__requestAuth.token = saved;
});
