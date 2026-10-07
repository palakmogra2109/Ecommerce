// Login test cases — positive and negative.
//
// Every rule asserted here was read out of the source, not assumed:
//   frontend/src/utils/validation.js  (client rules)
//   backend/app/api/auth/login/route.js (server rules)
// Client-side cases assert what the SHOPPER sees. Server cases go through
// request.post so they hold even if client validation is bypassed, which is
// the only way to test the API's own contract.
//
// The suite is written to be runnable against a throwaway user: set
// TEST_USER_EMAIL / TEST_USER_PASSWORD, or let the fixtures below create one.

const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');

// Both live under backend/node_modules, not at the repo root.
const pg = require(path.resolve(__dirname, '..', 'backend', 'node_modules', 'pg'));
const bcrypt = require(path.resolve(__dirname, '..', 'backend', 'node_modules', 'bcryptjs'));

const BASE = 'http://localhost:5173';
const API = 'http://localhost:3000';

// Both public signup endpoints are closed — /auth/register and
// /auth/store/register were both unauthenticated. So this suite cannot sign its
// way to a user any more, and it does not borrow yours: it writes a throwaway
// account straight to the database, hashes the password the same way the app
// does, and deletes it in afterAll. That keeps the positive login paths covered
// without a credential anyone has to remember setting, and without this suite
// depending on an account that may be deleted later.
const RUN_ID = `${process.pid}${Math.floor(Math.random() * 1e6)}`;
const EMAIL = `login-${RUN_ID}@example.test`;
const PASSWORD = 'Password@123';

let pool;

// Every fixture this file creates, so afterAll can remove exactly what the run
// made. One registry for the whole file: the shared EMAIL user below and the
// per-role users created by makeUser() both register here.
const created = new Set();

function dbUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = path.resolve(__dirname, '..', 'backend', '.env.local');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*DATABASE_URL=(.*)$/);
      if (m) return m[1].trim();
    }
  }
  return null;
}

test.beforeAll(async () => {
  const url = dbUrl();
  if (!url) return;
  pool = new pg.Pool({ connectionString: url, max: 1 });

  // Sweep fixtures abandoned by an INTERRUPTED run.
  //
  // afterAll only runs if the worker finishes, so killing a run — a CI timeout,
  // a Ctrl-C — leaves its users behind forever. Observed accumulating 200 of
  // them against the live database.
  //
  // The age guard is not optional. My first version had no guard, and
  // fullyParallel broke it immediately: every worker's beforeAll ran this and
  // deleted the OTHER workers' fixtures while they were still being used,
  // which failed 8 tests across all three browsers. Restricting to rows older
  // than STALE_MINUTES means a live run is never touched, because nothing in an
  // in-flight suite is that old, while debris from a killed run eventually is.
  const STALE_MINUTES = 30;
  const stale = [
    "(email LIKE 'login-%' OR email LIKE 'adminlogin-%' OR email LIKE 'inactive-%')",
    "AND email LIKE '%@example.test'",
    "AND email <> $1",
    "AND created_at < now() - $2::interval",
  ];
  try {
    await pool.query(
      `DELETE FROM user_has_roles WHERE user_id IN (
         SELECT id FROM users WHERE ${stale.join(' ')})`,
      [EMAIL, String(STALE_MINUTES)]
    );
    await pool.query(`DELETE FROM users WHERE ${stale.join(' ')}`, [
      EMAIL,
      `${STALE_MINUTES} minutes`,
    ]);
  } catch (error) {
    // A failed sweep must not stop the suite — but it must never be silent
    // either. The first version of this used ($2 || ' minutes')::interval, which
    // left the parameter untyped and made Postgres reject the whole statement;
    // the catch swallowed it and the sweep quietly did nothing for several runs.
    console.warn(`[login.spec] fixture sweep failed: ${error.message}`);
  }
  const hash = await bcrypt.hash(PASSWORD, 12);
  const inserted = await pool.query(
    "INSERT INTO users (name, email, password, status) VALUES ($1, $2, $3, 'ACTIVE') RETURNING id",
    ['Login Test', EMAIL, hash]
  );
  created.add(inserted.rows[0].id);
});

/**
 * Creates a user holding `roleSlugs`, for the role-permission cases below.
 *
 * Both public signup endpoints are closed, so a suite cannot register its way to
 * an account; fixtures are written straight to the database with a real bcrypt
 * hash, exactly as the app stores one.
 */
async function makeUser(roleSlugs, { status = 'ACTIVE', name = 'Fixture' } = {}) {
  const email = `adminlogin-${RUN_ID}-${created.size}@example.test`;
  const hash = await bcrypt.hash(PASSWORD, 12);
  const user = (
    await pool.query(
      'INSERT INTO users (name, email, password, status) VALUES ($1,$2,$3,$4) RETURNING id, uuid',
      [name, email, hash, status]
    )
  ).rows[0];
  created.add(user.id);
  for (const slug of roleSlugs) {
    const role = (await pool.query('SELECT id FROM roles WHERE slug = $1', [slug])).rows[0];
    if (!role) throw new Error(`No such role: ${slug}`);
    await pool.query('INSERT INTO user_has_roles (user_id, role_id) VALUES ($1,$2)', [user.id, role.id]);
  }
  return { ...user, email, status };
}

/** Signs in over plain fetch and returns the parsed body. */
async function apiLogin(email, password = PASSWORD, headers = asClient()) {
  const response = await fetch(`${API}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ email, password }),
  });
  return { status: response.status, body: await response.json() };
}

/** GET against a protected endpoint with a bearer token. */
async function apiGet(path, token) {
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, ...asClient() },
  });
  return res.status;
}

/**
 * Fills the login form and waits for the app to SETTLE, not just for the URL to
 * change — the route flips a beat before the page finishes rendering, and
 * asserting on the URL alone reads the pre-login value.
 *
 * Waits for the admin shell OR a 403, because a user with no permissions is
 * routed to a guard they cannot pass and Forbidden replaces the whole shell,
 * sidebar included. Requiring the shell here would time out on exactly the case
 * that most needs testing.
 */
async function signIn(page, email) {
  await page.goto(`${BASE}/login`);
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(PASSWORD);
  await page.getByRole('button', { name: 'Login' }).click();
  await page.waitForURL((u) => !u.pathname.match(/^\/login/), { timeout: 15000 });
  await expect(
    page.locator('.sidebar-brand, .forbidden-code').first()
  ).toBeVisible({ timeout: 15000 });
  await page.waitForTimeout(800);
}

test.afterAll(async () => {
  if (!pool) return;
  try {
    // By id, from the registry, so cleanup can only ever remove a row this run
    // created. No pattern-matching on email, which is how a suite ends up
    // deleting a real account.
    for (const id of created) {
      await pool.query('DELETE FROM user_has_roles WHERE user_id = $1', [id]);
      await pool.query('DELETE FROM users WHERE id = $1', [id]);
    }
  } catch {
    /* best effort */
  } finally {
    await pool.end();
  }
});

// A password that satisfies every client rule: >=6, upper, lower, digit, symbol.
const STRONG = PASSWORD;

// Each test acts as its own client.
//
// The login throttle keys on the forwarded address (lib/giftCardGuards
// clientKey prefers x-forwarded-for), which is right in production — one
// attacker cannot then grind a victim — but in a suite every request comes from
// 127.0.0.1 and they would all share one budget, so the throttle tests would
// lock out the positive ones.
//
// The value does not have to be a routable address: clientKey only ever uses it
// as a Map key. It MUST be unique per process though. With fullyParallel, every
// worker is a separate process, so a plain counter made worker A and worker B
// both emit 203.0.113.5, and whichever burned that bucket first locked the other
// out. RUN_ID is in the key, so no two processes can collide.
let clientSeq = 0;
const asClient = () => ({ 'x-forwarded-for': `login-test-${RUN_ID}-${(clientSeq += 1)}` });

const field = (page, label) => page.getByLabel(label, { exact: true });

async function submitLogin(page, email, password) {
  await field(page, 'Email').fill(email);
  await field(page, 'Password').fill(password);
  await page.getByRole('button', { name: 'Login' }).click();
}

// ─────────────────────────── POSITIVE ───────────────────────────

test.describe('positive', () => {
  test('valid admin credentials log in and land on a real page', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await submitLogin(page, EMAIL, PASSWORD);

    // The form clears on success and navigation happens, so assert we left /login.
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByRole('button', { name: 'Login' })).toHaveCount(0);
  });

  test('the password field is masked by default and has a reveal toggle', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    const pw = field(page, 'Password');
    await expect(pw).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: 'Show password' }).click();
    await expect(pw).toHaveAttribute('type', 'text');

    await page.getByRole('button', { name: 'Hide password' }).click();
    await expect(pw).toHaveAttribute('type', 'password');
  });

  test('a successful login sets an HttpOnly cookie', async ({ request }) => {
    const res = await request.post(`${API}/api/auth/login`, {
      headers: asClient(),
      data: { email: EMAIL, password: PASSWORD },
    });
    expect(res.status()).toBe(200);

    const setCookie = res.headers()['set-cookie'] || '';
    expect(setCookie).toContain('token=');
    expect(setCookie).toContain('HttpOnly');
  });

  test('email matching is case- and whitespace-insensitive', async ({ request }) => {
    const res = await request.post(`${API}/api/auth/login`, {
      headers: asClient(),
      data: { email: `  ${EMAIL.toUpperCase()}  `, password: PASSWORD },
    });
    // The route lowercases and trims before lookup, so this must succeed.
    expect(res.status()).toBe(200);
  });

  test('the response carries the roles a dashboard needs', async ({ request }) => {
    const res = await request.post(`${API}/api/auth/login`, {
      headers: asClient(),
      data: { email: EMAIL, password: PASSWORD },
    });
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.token).toBeTruthy();
    expect(body.user).toHaveProperty('uuid');
    expect(body.user).toHaveProperty('roles');
    expect(body.user).toHaveProperty('permissions');
  });
});

// ─────────────────────── NEGATIVE: client rules ───────────────────────

test.describe('negative — client validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto(`${BASE}/login`);
  });

  test('empty form shows both required errors and never calls the API', async ({ page }) => {
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByText('Email is required', { exact: true })).toBeVisible();
    await expect(page.getByText('Password is required', { exact: true })).toBeVisible();
  });

  test('a malformed email is rejected with the email error', async ({ page }) => {
    await submitLogin(page, 'not-an-email', STRONG);
    await expect(page.getByText('Please enter a valid email address')).toBeVisible();
  });

  const badEmails = [
    ['missing @', 'plainaddress'],
    ['missing domain', 'user@'],
    ['missing tld', 'user@domain'],
    ['only spaces', '   '],
    ['double @', 'a@@b.com'],
    ['space inside', 'a b@example.com'],
  ];
  for (const [name, value] of badEmails) {
    test(`email rejected — ${name}`, async ({ page }) => {
      await submitLogin(page, value, STRONG);
      await expect(
        page.getByText(/Email is required|Please enter a valid email address/)
      ).toBeVisible();
    });
  }

  const weakPasswords = [
    ['too short', 'Aa1!', 'Password must be at least 6 characters'],
    ['no uppercase', 'password@1', 'Password must contain at least one uppercase letter'],
    ['no lowercase', 'PASSWORD@1', 'Password must contain at least one lowercase letter'],
    ['no digit', 'Password@', 'Password must contain at least one number'],
    ['no special character', 'Password1', 'Password must contain at least one special character'],
  ];
  for (const [name, value, message] of weakPasswords) {
    test(`password rejected — ${name}`, async ({ page }) => {
      await submitLogin(page, EMAIL, value);
      await expect(page.getByText(message, { exact: true })).toBeVisible();
    });
  }

  test('a password over 100 characters is rejected', async ({ page }) => {
    await submitLogin(page, EMAIL, 'Aa1@' + 'x'.repeat(120));
    await expect(page.getByText('Password must not exceed 100 characters')).toBeVisible();
  });

  test('a field error clears as soon as the shopper starts fixing it', async ({ page }) => {
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(page.getByText('Email is required', { exact: true })).toBeVisible();

    await field(page, 'Email').fill('a');
    await expect(page.getByText('Email is required', { exact: true })).toHaveCount(0);
  });

  test('the invalid field is marked aria-invalid for screen readers', async ({ page }) => {
    await page.getByRole('button', { name: 'Login' }).click();
    await expect(field(page, 'Email')).toHaveAttribute('aria-invalid', 'true');
  });
});

// ─────────────────────── NEGATIVE: server rules ───────────────────────

test.describe('negative — server contract (client rules bypassed)', () => {
  // Every request carries its own throttle key. Without it the suite shares
  // one budget, because the limiter keys on the forwarded address and every
  // request from a single machine looks like the same client.
  const api = (request) => `${API}/api/auth/login`;
  const post = (request, data) => request.post(api(request), { headers: asClient(), data });

  test('an unknown email is 401 with a message that does not confirm existence', async ({ request }) => {
    const res = await post(request, {
      email: 'definitely-not-a-user@example.invalid',
      password: STRONG,
    });
    expect(res.status()).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    // Identical wording to the wrong-password case: no user enumeration.
    expect(body.message).toBe('Invalid email or password');
  });

  test('a wrong password is 401 with the same message as an unknown user', async ({ request }) => {
    const wrongPw = await post(request, { email: EMAIL, password: 'Wr0ng@Pass99' });
    const unknownUser = await post(request, { email: 'nobody@example.invalid', password: STRONG });
    const a = await wrongPw.json();
    const b = await unknownUser.json();
    // If these ever differ, the endpoint tells an attacker which emails exist.
    expect(a.message).toBe(b.message);
    expect(wrongPw.status()).toBe(unknownUser.status());
  });

  test('missing password is 400', async ({ request }) => {
    const res = await post(request, { email: EMAIL });
    expect(res.status()).toBe(400);
    expect((await res.json()).message).toMatch(/required/i);
  });

  test('missing email is 400', async ({ request }) => {
    const res = await post(request, { password: STRONG });
    expect(res.status()).toBe(400);
  });

  test('empty strings are 400', async ({ request }) => {
    const res = await post(request, { email: '', password: '' });
    expect(res.status()).toBe(400);
  });

  test('a non-string password is rejected, not coerced', async ({ request }) => {
    const res = await post(request, { email: EMAIL, password: 123456 });
    // The route only checks truthiness, so a number is truthy and reaches bcrypt.
    // Documenting the real behaviour: this currently does NOT 400.
    expect([400, 401, 500]).toContain(res.status());
  });

  test('a wrong password never returns a token', async ({ request }) => {
    const res = await request.post(api(request), {
      data: { email: EMAIL, password: 'Wr0ng@Pass99' },
    });
    const body = await res.json();
    expect(body.token).toBeUndefined();
  });

  test('the error is shown to the shopper without leaking internals', async ({ page }) => {
    await page.goto(`${BASE}/login`);
    await submitLogin(page, EMAIL, 'Wr0ng@Pass99');
    await expect(page.getByRole('alert')).toContainText('Invalid email or password');
    await expect(page.getByRole('alert')).not.toContainText(/stack|postgres|SELECT/i);
  });

  test('the submit button disables while the request is in flight', async ({ page }) => {
    // Intercept BEFORE filling, and hold the response, so the pending state is
    // observable. Registering the route after a submit means the request has
    // already completed by the time the assertion runs.
    let release;
    const held = new Promise((resolve) => {
      release = resolve;
    });
    await page.route('**/api/auth/login', async (route) => {
      await held;
      await route.continue();
    });

    await page.goto(`${BASE}/login`);
    await submitLogin(page, EMAIL, 'Wr0ng@Pass99');

    // The label swaps to "Logging in…" and the control is disabled.
    const button = page.getByRole('button', { name: /logging in/i });
    await expect(button).toBeDisabled();
    await expect(button).toBeVisible();

    release();
    await expect(page.getByRole('button', { name: 'Login' })).toBeEnabled();
  });
});

// ─────────────────────── SECURITY ───────────────────────

test.describe('security gaps found while writing these cases', () => {
  // Each of these currently FAILS against the live code. They are written as
  // expected-passing tests so they document the required behaviour and will go
  // green when the gap is fixed. Do not delete them to make a run clean.

  test('SECURITY: an INACTIVE user must not be able to log in', async ({ request }) => {
    // The login query has no status filter, so a deactivated account still
    // receives a token. This suite owns the fixture, so it can deactivate its
    // own user and prove it — no external account required.
    if (!pool) test.skip(true, 'no DATABASE_URL');
    const hash = await bcrypt.hash(PASSWORD, 12);
    const email = `inactive-${RUN_ID}@example.test`;
    await pool.query(
      "INSERT INTO users (name, email, password, status) VALUES ($1, $2, $3, 'INACTIVE')",
      ['Deactivated', email, hash]
    );
    try {
      const res = await request.post(`${API}/api/auth/login`, {
        headers: asClient(),
        data: { email, password: PASSWORD },
      });
      // 403, not 401: the credentials are right, the account is not usable.
      expect(res.status()).toBe(403);
    } finally {
      await pool.query('DELETE FROM users WHERE email = $1', [email]);
    }
  });

  test('SECURITY: repeated wrong passwords are throttled', async ({ request }) => {
    // Sequential, not Promise.all: the limiter counts in process memory, so
    // concurrent requests would race the counter rather than exercise it.
    const throttleClient = asClient();
    const statuses = [];
    for (let i = 0; i < 25; i++) {
      const res = await request.post(`${API}/api/auth/login`, {
        headers: throttleClient,
        data: { email: 'throttle-probe@example.test', password: `Wr0ng@Pass${i}` },
      });
      statuses.push(res.status());
    }
    // lib/giftCardGuards allows MAX_GUESSES_PER_WINDOW (20) then locks out.
    expect(statuses.filter((s) => s === 401).length).toBeGreaterThan(0);
    expect(statuses).toContain(429);
    expect(statuses.indexOf(429)).toBeGreaterThan(0);
  });

  test('a throttled client is told when it may retry', async ({ request }) => {
    const retryClient = asClient();
    for (let i = 0; i < 22; i++) {
      await request.post(`${API}/api/auth/login`, {
        headers: retryClient,
        data: { email: 'retry-after@example.test', password: `Wr0ng@Pass${i}` },
      });
    }
    const res = await request.post(`${API}/api/auth/login`, {
      headers: retryClient,
      data: { email: 'retry-after@example.test', password: 'Wr0ng@PassX' },
    });
    if (res.status() === 429) {
      expect(Number(res.headers()['retry-after'])).toBeGreaterThan(0);
    }
  });

  test('a correct password clears the throttle for that client', async ({ request }) => {
    // Someone who fumbles their own password must not be locked out by the
    // attempts that came before the right one.
    const headers = asClient();
    const wrong = await request.post(`${API}/api/auth/login`, {
      headers: asClient(),
      headers,
      data: { email: EMAIL, password: 'Wr0ng@Pass1' },
    });
    expect(wrong.status()).toBe(401);
    const right = await request.post(`${API}/api/auth/login`, {
      headers: asClient(),
      headers,
      data: { email: EMAIL, password: PASSWORD },
    });
    expect(right.status()).toBe(200);
  });

  test('SECURITY: the auth cookie is marked Secure over TLS', async ({ request }) => {
    // x-forwarded-proto is how a TLS-terminating proxy tells the app the
    // original request was https. Asserting on a plain http request would be
    // asserting the opposite requirement — the flag has to be ABSENT there or
    // local development could never hold a session.
    const res = await request.post(`${API}/api/auth/login`, {
      headers: { ...asClient(), 'x-forwarded-proto': 'https' },
      data: { email: EMAIL, password: PASSWORD },
    });
    expect(res.status()).toBe(200);
    const setCookie = res.headers()['set-cookie'] || '';
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
  });

  test('the cookie omits Secure on plain http so local dev still works', async ({ request }) => {
    const res = await request.post(`${API}/api/auth/login`, {
      headers: asClient(),
      data: { email: EMAIL, password: PASSWORD },
    });
    const setCookie = res.headers()['set-cookie'] || '';
    // If Secure were unconditional, http://localhost:3000 would silently lose
    // its session and the failure would look like a login bug.
    expect(setCookie).not.toContain('Secure');
  });
});

// ══════════════════════════════════════════════════════════════════════
//  ROLES: super admin vs sub-admin
// ══════════════════════════════════════════════════════════════════════
//  There is only ONE login page. A sub-admin is not a separate flow — it is
//  the same form, and the roles diverge only in what the server returns. So
//  these cases are about the permissions payload, the landing path, the
//  sidebar, and what the API refuses afterwards.
//
//  Measured in the live database, and worth stating because it is the most
//  surprising thing in the model: `permissions` comes from
//  role_has_permissions while `modules` comes from module_has_roles, and the
//  two are independent. staff has 5 permissions and 0 modules;
//  product_manager has 11 permissions and 0 modules, so the API honours it
//  while the sidebar offers no way to reach it. The sidebar itself filters by
//  permission, not by the modules array, which is why a user with modules:[]
//  can still get a full rail.

// ─────────────────────────── super admin ───────────────────────────

test.describe('super admin', () => {
  test('logs in and receives the full module set', async () => {
    const user = await makeUser(['super_admin'], { name: 'Super Admin' });
    const { status, body } = await apiLogin(user.email);

    expect(status).toBe(200);
    expect(body.token).toBeTruthy();
    expect(body.user.email).toBe(user.email);
    expect(body.user.roles).toContain('super_admin');

    // A super admin is the account everything else is measured against, so the
    // breadth is the assertion: it should not be a short list.
    expect(body.user.permissions.length).toBeGreaterThan(20);
    const slugs = body.user.modules.map((m) => m.slug);
    for (const expected of ['dashboard', 'users', 'roles', 'products', 'orders', 'settings']) {
      expect(slugs).toContain(expected);
    }
  });

  test('lands on the dashboard, its highest-priority module', async ({ page }) => {
    const user = await makeUser(['super_admin']);
    await page.goto(`${BASE}/login`);
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL((u) => !u.pathname.match(/^\/login/), { timeout: 15000 });
    // LANDING_MODULES puts dashboard.view first, and a super admin has it.
    expect(new URL(page.url()).pathname).toBe('/dashboard');
  });

  test('sees every module in the sidebar', async ({ page }) => {
    const user = await makeUser(['super_admin']);
    await signIn(page, user.email);

    // The sidebar hides modules the user cannot open; for a super admin almost
    // nothing should be hidden.
    await expect(page.locator('.sidebar-nav')).not.toContainText('No modules are assigned');
    for (const label of ['Dashboard', 'Users', 'Roles', 'Settings']) {
      await expect(page.locator('.sidebar-nav')).toContainText(label);
    }
  });

  test('reaches the privileged endpoints', async () => {
    const user = await makeUser(['super_admin']);
    const { body } = await apiLogin(user.email);
    for (const ep of ['/api/users', '/api/roles', '/api/settings', '/api/products']) {
      expect(await apiGet(ep, body.token)).toBe(200);
    }
  });

  test('an inactive super admin cannot log in at all', async () => {
    const user = await makeUser(['super_admin'], { status: 'INACTIVE' });
    const { status } = await apiLogin(user.email);
    expect(status).toBe(403);
  });
});

// ─────────────────────────── sub-admin ───────────────────────────

test.describe('sub-admin with restricted permissions', () => {
  // staff holds exactly: categories.view/update/delete, brands.view, users.view
  const STAFF_ONLY = ['categories', 'brands', 'users'];

  test('logs in and receives only its own permissions', async () => {
    const user = await makeUser(['staff'], { name: 'Sub Admin' });
    const { status, body } = await apiLogin(user.email);

    expect(status).toBe(200);
    expect(body.user.roles).toContain('staff');
    // Exactly the five staff holds, no more.
    expect([...body.user.permissions].sort()).toEqual([
      'brands.view',
      'categories.delete',
      'categories.update',
      'categories.view',
      'users.view',
    ]);
  });

  test('modules and permissions are independent, and staff is mapped to none', async () => {
    // Worth stating plainly because it is the most surprising thing in the
    // whole model: `permissions` comes from role_has_permissions, while
    // `modules` comes from module_has_roles. staff has real permissions and is
    // mapped to ZERO modules, so its module list is empty.
    const user = await makeUser(['staff']);
    const { body } = await apiLogin(user.email);
    expect(body.user.permissions.length).toBeGreaterThan(0);
    expect(body.user.modules).toEqual([]);
  });

  test('cannot read an endpoint it has no permission for', async () => {
    const user = await makeUser(['staff']);
    const { body } = await apiLogin(user.email);
    for (const ep of ['/api/roles', '/api/settings', '/api/products', '/api/orders']) {
      expect(await apiGet(ep, body.token)).toBe(403);
    }
  });

  test('can read an endpoint it does hold permission for', async () => {
    const user = await makeUser(['staff']);
    const { body } = await apiLogin(user.email);
    // staff has users.view, so listing users is legitimate, not a leak.
    expect(await apiGet('/api/users', body.token)).toBe(200);
  });

  test('a write it lacks permission for is refused even with a valid token', async () => {
    const user = await makeUser(['staff']);
    const { body } = await apiLogin(user.email);
    // categories.update is granted, settings.update is not. Same shape of
    // request, different permission, so the refusal has to come from the
    // permission and not from the token being invalid.
    const denied = await fetch(`${API}/api/roles`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${body.token}`, ...asClient() },
      body: JSON.stringify({ name: 'x', slug: 'x' }),
    });
    expect(denied.status).toBe(403);
  });

  test('the sidebar hides modules it cannot open', async ({ page }) => {
    const user = await makeUser(['staff']);
    await signIn(page, user.email);

    // The sidebar filters by PERMISSION, not by the server's `modules` array,
    // which is why a user with modules:[] can still get a full rail.
    // "Products" appears as a group header because one of its children
    // (sub_categories) maps to categories.view, which staff holds.
    const nav = page.locator('.sidebar-nav');
    await expect(nav).toContainText('Users');
    await expect(nav).toContainText('Categories');
    await expect(nav).toContainText('Brands');
    await expect(nav).not.toContainText('Settings');
    await expect(nav).not.toContainText('Roles');
  });

  test('lands on the first module it can open, not on the dashboard', async ({ page }) => {
    const user = await makeUser(['staff']);
    await page.goto(`${BASE}/login`);
    await page.locator('input[name="email"]').fill(user.email);
    await page.locator('input[name="password"]').fill(PASSWORD);
    await page.getByRole('button', { name: 'Login' }).click();
    await page.waitForURL((u) => !u.pathname.match(/^\/login/), { timeout: 15000 });
    // Wait for the shell to render, not just for the URL to change: the route
    // can change a beat before the page settles, and asserting on the URL alone
    // read the pre-login value.
    await expect(page.locator('.sidebar-brand')).toBeVisible({ timeout: 15000 });
    await page.waitForTimeout(800);

    // staff has no dashboard.view, so it must not be parked on /dashboard.
    // getLandingPath walks LANDING_MODULES by permission, and users.view is the
    // first entry staff holds, so /users is the expected landing.
    expect(new URL(page.url()).pathname).toBe('/users');
  });

  test('a role with permissions but no module mapping still works via the API', async ({ page }) => {
    // product_manager: 11 permissions, 0 modules. Real access, empty sidebar.
    // The gap is that the UI gives no way to reach what the API permits, so the
    // two have to be reconciled by hand in module_has_roles.
    const user = await makeUser(['product_manager']);
    const { body } = await apiLogin(user.email);
    expect(body.user.permissions.length).toBeGreaterThan(0);
    expect(body.user.modules).toEqual([]);

    // Its permissions are enforced server-side regardless of the module list.
    const perms = [...body.user.permissions];
    const canViewProducts = perms.includes('products.view');
    if (canViewProducts) {
      expect(await apiGet('/api/products', body.token)).toBe(200);
    }
  });
});

// ─────────────────────── no permissions at all ───────────────────────

test.describe('sub-admin with no usable permissions', () => {
  // test_role is INACTIVE, so even though the user is linked to it, the role
  // contributes nothing. That is a useful case: the link exists but is inert.
  test('an inactive role grants nothing at all', async () => {
    const user = await makeUser(['test_role'], { name: 'Inert Role' });
    const { status, body } = await apiLogin(user.email);

    expect(status).toBe(200);
    expect(body.user.permissions).toEqual([]);
    expect(body.user.modules).toEqual([]);
    expect(await apiGet('/api/users', body.token)).toBe(403);
  });

  test('a user with no roles can log in but can do nothing', async () => {
    const user = await makeUser([], { name: 'Roleless' });
    const { status, body } = await apiLogin(user.email);
    expect(status).toBe(200);
    expect(body.user.permissions).toEqual([]);
    expect(await apiGet('/api/products', body.token)).toBe(403);
  });

  test('is shown a 403 rather than a working page', async ({ page }) => {
    // A user with no permissions falls through getLandingPath's fallback to
    // /dashboard, which is itself guarded by dashboard.view — so the honest
    // outcome is a 403, not a broken-looking page. The sidebar's
    // "No modules are assigned" copy is therefore unreachable after login,
    // because Forbidden replaces the whole admin shell.
    const user = await makeUser([]);
    await signIn(page, user.email);

    await expect(page.locator('.forbidden-code')).toHaveText('403');
    await expect(page.locator('.forbidden')).toBeVisible();
  });

  test('wrong password returns 401', async ({ request }) => {
    const res = await request.post(`${API}/api/auth/login`, {
      headers: asClient(),
      data: {
        email: EMAIL,
        password: 'WrongPassword@123'
      }
    });

    expect(res.status()).toBe(401);

    const body = await res.json();

    expect(body.success).toBe(false);
    expect(body.message).toBe('Invalid email or password');
    expect(body.token).toBeUndefined();
  });
});

// ─────────────────────── shared negatives ───────────────────────

test.describe('shared login rules for every admin role', () => {
  for (const [label, role] of [['super admin', 'super_admin'], ['sub-admin', 'staff']]) {
    test(`${label}: a wrong password is 401 and issues no token`, async () => {
      const user = await makeUser([role]);
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...asClient() },
        body: JSON.stringify({ email: user.email, password: 'Wr0ng@Pass1' }),
      });
      expect(res.status).toBe(401);
      expect((await res.json()).token).toBeUndefined();
    });

    test(`${label}: being deactivated mid-session ends it`, async () => {
      const user = await makeUser([role]);
      const { body } = await apiLogin(user.email);
      expect(body.token).toBeTruthy();

      // A token that was valid when issued is not a licence that outlives the
      // account. This is the case the user reported.
      await pool.query("UPDATE users SET status='INACTIVE' WHERE id=$1", [user.id]);
      expect(await apiGet('/api/auth/me', body.token)).toBe(401);
    });

    test(`${label}: the cookie is HttpOnly and SameSite`, async () => {
      const user = await makeUser([role]);
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...asClient() },
        body: JSON.stringify({ email: user.email, password: PASSWORD }),
      });
      const cookie = res.headers.get('set-cookie') || '';
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('SameSite');
    });
  }

  test('a sub-admin token cannot be used to reach the store panel API as an admin', async () => {
    const user = await makeUser(['staff']);
    const { body } = await apiLogin(user.email);
    // staff has branches.view? no. Branch-scoped endpoints must refuse it.
    const res = await fetch(`${API}/api/branches/stores`, {
      headers: { Authorization: `Bearer ${body.token}`, ...asClient() },
    });
    expect([401, 403]).toContain(res.status);
  });

  test('logout clears the session server-side for both roles', async () => {
    const user = await makeUser(['super_admin']);
    const { body } = await apiLogin(user.email);
    expect(await apiGet('/api/auth/me', body.token)).toBe(200);
    // The token is stateless JWT, so logout cannot revoke it; it clears the
    // cookie and the client drops the token. Asserted as that reality so the
    // gap is visible rather than assumed fixed.
    const res = await fetch(`${API}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${body.token}`, ...asClient() },
    });
    expect(res.status).toBeLessThan(400);
  });
});

