import test from "node:test";
import assert from "node:assert/strict";
import { __resetGeocodeCacheForTests, reverseGeocode, searchLocations } from "../geocode.js";

function response(payload, ok = true, status = 200) {
  return { ok, status, json: async () => payload };
}

test("short queries do not call Nominatim", async () => {
  let calls = 0;
  const results = await searchLocations("Pu", {
    fetchImpl: async () => {
      calls += 1;
      return response([]);
    },
  });
  assert.deepEqual(results, []);
  assert.equal(calls, 0);
});

test("forward search maps the Indian address parts used by the form", async () => {
  __resetGeocodeCacheForTests();
  const results = await searchLocations("Kothrud, Pune", {
    fetchImpl: async () => response([
      {
        place_id: 1,
        display_name: "Kothrud, Pune, Maharashtra, 411038, India",
        lat: "18.5074",
        lon: "73.8077",
        address: {
          road: "Paud Road",
          suburb: "Kothrud",
          city: "Pune",
          state: "Maharashtra",
          postcode: "411038",
          country: "India",
        },
      },
    ]),
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].city, "Pune");
  assert.equal(results[0].state, "Maharashtra");
  assert.equal(results[0].postalCode, "411038");
  assert.equal(results[0].latitude, 18.5074);
  assert.equal(results[0].longitude, 73.8077);
});

test("repeated searches use the cache and do not call Nominatim again", async () => {
  __resetGeocodeCacheForTests();
  let calls = 0;
  const dependencies = {
    fetchImpl: async () => {
      calls += 1;
      return response([]);
    },
    now: () => 1_000,
  };
  await searchLocations("Kothrud Pune", dependencies);
  await searchLocations("Kothrud Pune", dependencies);
  assert.equal(calls, 1);
});

test("distinct upstream searches observe the minimum request interval", async () => {
  __resetGeocodeCacheForTests();
  let calls = 0;
  let nowValue = 1000;
  const slept = [];
  const dependencies = {
    fetchImpl: async () => {
      calls += 1;
      return response([]);
    },
    now: () => nowValue,
    sleep: async (ms) => {
      slept.push(ms);
      nowValue += ms;
    },
  };
  await searchLocations("Kothrud Pune", dependencies);
  await searchLocations("Baner Pune", dependencies);
  assert.equal(calls, 2);
  assert.deepEqual(slept, [1000]);
});

test("an expired search-cache entry triggers another upstream call", async () => {
  __resetGeocodeCacheForTests();
  let calls = 0;
  let nowValue = 1000;
  const dependencies = {
    fetchImpl: async () => {
      calls += 1;
      return response([]);
    },
    now: () => nowValue,
  };
  await searchLocations("Kothrud Pune", dependencies);
  nowValue = 601001;
  await searchLocations("Kothrud Pune", dependencies);
  assert.equal(calls, 2);
});

test("an upstream Nominatim failure is classified as temporary", async () => {
  __resetGeocodeCacheForTests();
  await assert.rejects(
    () => searchLocations("Kothrud Pune", { fetchImpl: async () => response({ message: "busy" }, false, 503) }),
    /temporarily unavailable/
  );
});

test("reverse geocoding validates coordinates before calling Nominatim", async () => {
  let calls = 0;
  const result = await reverseGeocode(
    { lat: Number.NaN, lng: 73.85 },
    { fetchImpl: async () => {
      calls += 1;
      return response({});
    } }
  );
  assert.equal(result, null);
  assert.equal(calls, 0);
});
