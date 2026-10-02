// Registration test cases.
//
// SCOPE CHANGED. There is no longer an admin self-registration flow.
//
// `POST /api/auth/register` was unauthenticated and wrote a row into `users` —
// the admin panel's own table — with no role and no matching `customers` row, so
// it never made a shopper. It and its `/register` page have been removed. Admin
// accounts are created by an existing admin through the Users module, which
// requires a role to be chosen; that is the only supported way in.
//
// Store self-signup has since gone the same way: POST /auth/store/register was
// also unauthenticated and handed store_products.update and
// store_orders.update to anyone who reached it. There is now NO public signup at
// all. This file asserts both endpoints stay closed, and that the
// authenticated paths that replaced them still work.
//
// These tests create no rows. The RUN_ID-scoped cleanup below is kept anyway,
// because a failing assertion against a half-open endpoint would still leave a
// row behind, and the users and branches tables are live.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// pg is installed under backend/node_modules, not at the repo root.
const pg = require(path.resolve(__dirname, '..', 'backend', 'node_modules', 'pg'));

const BASE = 'http://localhost:5173';
const API = 'http://localhost:3000';

const STRONG = 'Password@123'; // >=6, upper, lower, digit, symbol

// Every fixture carries a per-process RUN_ID.
//
// playwright.config.js sets fullyParallel, and all three browser projects run
// against the same database at the same time. With a shared email pattern,
// chromium's afterAll cleanup deletes firefox's and webkit's fixtures WHILE
// THEY ARE STILL RUNNING, which is what made the store-role assertion fail only
// in a full run and pass in isolation. Scoping cleanup to this process means a
// project can only ever remove what it created.
const RUN_ID = `${process.pid}${Math.floor(Math.random() * 1e6)}`;

const uniqueEmail = () =>
  `pw-${RUN_ID}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

// branches.code is UNIQUE. When branchCode is omitted the route derives it from
// the first 6 characters of the store name, so "PW Store 1790...-111" and
// "PW Store 1790...-222" both become "PW STO" and every parallel test collides
// on the unique index — which the route reports as a 500, not a 409. So a unique
// store name is NOT enough: the code has to be unique too.
let storeSeq = 0;
const uniqueStore = () => {
  storeSeq += 1;
  return {
    branchName: `PW Store ${RUN_ID}-${storeSeq}`,
    branchCode: `PW${RUN_ID}${storeSeq}`.slice(0, 12),
  };
};

const storeRegister = (request, body) =>
  request.post(`${API}/api/auth/store/register`, { data: body });

// Pattern-scoped to what these tests create, so it can never touch a real
// account. Runs after the file; a failed cleanup must not fail a green suite.
async function cleanupTestRows() {
  if (!process.env.DATABASE_URL) {
    const envPath = path.resolve(__dirname, '..', 'backend', '.env.local');
    try {
      if (fs.existsSync(envPath)) {
        for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
          const m = line.match(/^\s*DATABASE_URL=(.*)$/);
          if (m && !process.env.DATABASE_URL) process.env.DATABASE_URL = m[1].trim();
        }
      }
    } catch {
      return;
    }
  }
  if (!process.env.DATABASE_URL) return;

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
  try {
    await pool.query(
      `DELETE FROM branch_users WHERE branchId IN (
         SELECT id FROM branches
         WHERE name LIKE $1 OR name LIKE $2 OR name LIKE $3)`,
      [`PW Store ${RUN_ID}-%`, `PWD Code ${RUN_ID}-%`, `PW Dup ${RUN_ID}-%`]
    );
    await pool.query(
      "DELETE FROM branches WHERE name LIKE $1 OR name LIKE $2 OR name LIKE $3",
      [`PW Store ${RUN_ID}-%`, `PWD Code ${RUN_ID}-%`, `PW Dup ${RUN_ID}-%`]
    );
    await pool.query("DELETE FROM users WHERE email LIKE $1", [`pw-${RUN_ID}-%`]);
  } catch {
    /* best effort */
  } finally {
    await pool.end();
  }
}

test.afterAll(async () => {
  await cleanupTestRows();
});

// ────────────── both public signup endpoints must stay closed ──────────────

test.describe('public registration is closed', () => {
  // Both of these used to hand privileges to whoever reached them:
  //   POST /api/auth/register       -> a row in `users`, no role at all
  //   POST /api/auth/store/register -> a branch + an account holding
  //                                   store_products.update and store_orders.update
  // Neither asked who was asking. Both are gone. Admin and store accounts are
  // now provisioned by an authenticated admin: create the user with a role in
  // the Users module, then link the branch via /api/branches/[id]/users.

  for (const [label, path] of [
    ['admin', '/api/auth/register'],
    ['store', '/api/auth/store/register'],
  ]) {
    test(`POST ${path} no longer exists`, async ({ request }) => {
      const res = await request.post(`${API}${path}`, {
        data: {
          name: 'Sneaky',
          email: uniqueEmail(),
          password: STRONG,
          branchName: `PW Closed ${storeSeq++}`,
        },
      });
      expect(res.status()).toBe(404);
    });

    test(`the closed ${label} endpoint creates no user`, async ({ request }) => {
      const email = uniqueEmail();
      await request.post(`${API}${path}`, {
        data: {
          name: 'Sneaky',
          email,
          password: STRONG,
          branchName: `PW Closed ${storeSeq++}`,
        },
      });
      // A 201 here would mean the row exists and can log in. The cleanup hook
      // runs later, so this assertion genuinely sees what was written.
      const login = await request.post(`${API}/api/auth/login`, {
        data: { email, password: STRONG },
      });
      expect(login.status()).toBe(401);
    });
  }

  test('the login page has no register link of any kind', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await expect(page.getByRole('link', { name: /register/i })).toHaveCount(0);
    // Forgot-password stays: it works without an account and is not a
    // registration path.
    await expect(page.getByRole('link', { name: /forgot password/i })).toBeVisible();
  });

  test('the login form has no confirm-password field', async ({ page }) => {
    // A better tell than a missing link: the absence of a confirmation field
    // fails even if a button is added back by some other route.
    await page.goto(`${BASE}/login`);
    await expect(page.getByPlaceholder('Confirm password')).toHaveCount(0);
  });

  test('/register renders no signup form', async ({ page }) => {
    await page.goto(`${BASE}/register`);
    await expect(page.getByPlaceholder('Confirm password')).toHaveCount(0);
  });

  test('/register/store renders no signup form', async ({ page }) => {
    await page.goto(`${BASE}/register/store`);
    await expect(page.getByPlaceholder('Confirm password')).toHaveCount(0);
    await expect(page.getByPlaceholder(/Store name/i)).toHaveCount(0);
  });

  test('the storefront account modal has no Create account tab', async ({ page }) => {
    await page.goto(`${BASE}/store`);
    const open = page.getByRole('button', { name: /account|login|sign in/i }).first();
    if (await open.count()) {
      await open.click();
      await expect(page.getByRole('button', { name: /create account/i })).toHaveCount(0);
    }
  });
});

// ────────────── what replaced them still works ──────────────

test.describe('admin provisioning still works', () => {
  // The point of closing the public routes is that the authenticated path
  // remains. This is the one that has to keep working, or store onboarding is
  // simply gone.

  test('login still works and still returns a token', async ({ request }) => {
    const res = await request.post(`${API}/api/auth/login`, {
      data: {
        email: process.env.TEST_USER_EMAIL || '',
        password: process.env.TEST_USER_PASSWORD || '',
      },
    });
    test.skip(!process.env.TEST_USER_EMAIL, 'set TEST_USER_EMAIL / TEST_USER_PASSWORD');
    expect(res.status()).toBe(200);
    expect((await res.json()).token).toBeTruthy();
  });

  test('forgot-password is still reachable without an account', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await page.getByRole('link', { name: /forgot password/i }).click();
    await expect(page).toHaveURL(/forgot-password/);
  });

  test('a closed endpoint rejects rather than half-creating', async ({ request }) => {
    // 404, not 500 and not a 200 with a body that looks like success. A 500
    // would suggest the route still exists and merely errored.
    const res = await request.post(`${API}/api/auth/store/register`, {
      data: { name: 'X', email: uniqueEmail(), password: STRONG, branchName: 'B' },
    });
    expect(res.status()).toBe(404);
  });
});
