import { test } from "node:test";
import assert from "node:assert";
import { hasPermission } from "../permissionPolicy.js";

test("super_admin passes any permission", () => {
  assert.equal(hasPermission({ roles: ["super_admin"], permissions: [] }, "branches.delete"), true);
});

test("non-super needs the slug", () => {
  assert.equal(hasPermission({ roles: ["store"], permissions: ["store_orders.view"] }, "branches.view"), false);
  assert.equal(hasPermission({ roles: ["store"], permissions: ["store_orders.view"] }, "store_orders.view"), true);
});

// The two tests above are the contract from the plan. The rest pin the edges
// that decide whether the real authorize() is safe to ship:
//
// - super_admin has to win from anywhere in the role list, not just position 0.
// - a slug nobody holds must be denied even when the user holds *some*
//   permissions, otherwise a partially-permissioned user passes everything.
// - the phase-1 branch/dashboard vocabulary has to be checkable, including the
//   underscore spelling the STORE_* constants now use.

test("super_admin wins from any position in the role list", () => {
  const access = { roles: ["store", "manager", "super_admin"], permissions: [] };
  assert.equal(hasPermission(access, "branches.inventory.update"), true);
  assert.equal(hasPermission(access, "dashboard.view"), true);
  assert.equal(hasPermission(access, "a.permission.nobody.has"), true);
});

test("a user with permissions is still denied the ones they do not hold", () => {
  const access = { roles: ["manager"], permissions: ["branches.view", "branches.orders.view"] };
  assert.equal(hasPermission(access, "branches.create"), false);
  assert.equal(hasPermission(access, "branches.delete"), false);
  assert.equal(hasPermission(access, "branches.orders.update"), false);
  assert.equal(hasPermission(access, "branches.price.view"), false);
});

test("a user with no roles and no permissions is denied everything", () => {
  const access = { roles: [], permissions: [] };
  assert.equal(hasPermission(access, "branches.view"), false);
  assert.equal(hasPermission(access, "dashboard.view"), false);
});

test("the phase-1 slug vocabulary is matched exactly", () => {
  const slugs = [
    "branches.view",
    "branches.create",
    "branches.update",
    "branches.delete",
    "branches.inventory.view",
    "branches.inventory.update",
    "branches.orders.view",
    "branches.orders.update",
    "branches.price.view",
    "branches.price.update",
    "dashboard.view",
    "store_dashboard.view",
    "store_products.view",
    "store_products.update",
    "store_orders.view",
    "store_orders.update",
  ];
  const access = { roles: ["manager"], permissions: slugs };
  for (const slug of slugs) {
    assert.equal(hasPermission(access, slug), true, `expected ${slug} to be granted`);
  }

  // The pre-alignment dotted spellings must not match anything: they are the
  // values the old KEY_PERMISSIONS.STORE_* constants held, and a stray grant
  // under one of them would silently look like it worked.
  for (const slug of ["store.dashboard.view", "store.products.view", "store.orders.update"]) {
    assert.equal(hasPermission(access, slug), false, `dotted ${slug} must not be granted`);
  }
});
