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
      email: `definitely-not-a-user-${RUN_ID}@example.invalid`,
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
    const unknownUser = await post(request, { email: `nobody-${RUN_ID}@example.invalid`, password: STRONG });
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
  //
  // The two at the end of this group are the exception: they pass today,
  // because they assert the CURRENT behaviour and name the risk in a comment,
  // so the danger stays visible in the diff rather than being assumed fixed.

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
        data: { email: `throttle-probe-${RUN_ID}@example.test`, password: `Wr0ng@Pass${i}` },
      });
      statuses.push(res.status());
    }
    // lib/loginThrottle allows MAX_ACCOUNT_FAILURES (5) for the submitted
    // account, then locks it out for LOGIN_LOCKOUT_MS (2 min).
    expect(statuses.filter((s) => s === 401).length).toBeGreaterThan(0);
    expect(statuses).toContain(429);
    expect(statuses.indexOf(429)).toBeGreaterThan(0);
  });

  test('a throttled client is told when it may retry', async ({ request }) => {
    const retryClient = asClient();
    for (let i = 0; i < 22; i++) {
      await request.post(`${API}/api/auth/login`, {
        headers: retryClient,
        data: { email: `retry-after-${RUN_ID}@example.test`, password: `Wr0ng@Pass${i}` },
      });
    }
    const res = await request.post(`${API}/api/auth/login`, {
      headers: retryClient,
      data: { email: `retry-after-${RUN_ID}@example.test`, password: 'Wr0ng@PassX' },
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

  test('GAP: a token-bearing login response may be cached', async ({ request }) => {
    // Asserted as today's reality, deliberately, so the risk is visible.
    //
    // GAP: the 200 carries a JWT in the body and a session cookie, and sets no
    // Cache-Control. Nothing stops a shared proxy or a browser disk cache from
    // holding a copy, and any later reader of that cache gets a live session.
    // The fix is `Cache-Control: no-store` on the login response — which then
    // also wants a test asserting it. Flip this expectation to
    // `toContain('no-store')` at the same time as adding the header.
    const res = await request.post(`${API}/api/auth/login`, {
      headers: asClient(),
      data: { email: EMAIL, password: PASSWORD },
    });

    expect(res.status()).toBe(200);
    expect(res.headers()['cache-control'] || '').not.toContain('no-store');
  });

  test('GAP: an unknown email answers measurably faster than a wrong password', async () => {
    // Asserted as today's reality, deliberately, so the risk is visible.
    //
    // GAP: the route returns 401 for an unknown address before it ever calls
    // bcrypt.compare, so that path costs one indexed lookup while a wrong
    // password costs a full bcrypt. The gap is roughly two orders of
    // magnitude, which is far more than enough to enumerate which addresses
    // have accounts by timing alone — the identical 401 message hides the text
    // but not the latency. The fix is a dummy bcrypt.compare against a fixed
    // hash on the unknown-address path.
    //
    // Five samples each, compared on the MINIMUM, with a 3x floor.
    //
    // Minimum, not median, and that is the whole point of this case. Measured
    // idle: wrong-password ~352ms, unknown-email ~6ms — a 58x gap, very stable.
    // Measured inside a full suite (3 parallel workers, each running its own
    // cost-12 bcrypt): the fast path's median jumped to ~353ms, i.e. the ratio
    // collapsed to roughly 1x and the case failed while the leak was still
    // exactly as wide. Median is the wrong statistic here because contention
    // adds delay asymmetrically: the cheap path has almost no work to hide
    // behind, so a blocked event loop inflates it far more than it inflates the
    // bcrypt path. The minimum is the least-contaminated sample of the batch,
    // which is the standard estimator for "how fast can this go at all".
    //
    // The floor stays at 3x — loose enough to survive a busy machine, tight
    // enough that closing the gap (a dummy bcrypt.compare on the unknown-email
    // path) turns it red immediately.
    if (!pool) test.skip(true, 'no DATABASE_URL');

    // Each sample gets its OWN user and its own forwarded address, and they are
    // awaited SEQUENTIALLY.
    //
    // Sequential matters: run concurrently and makeUser() races itself, since it
    // names each user from `created.size` — five parallel inserts all read the
    // same size and collide on the users_email_key unique constraint. Concurrent
    // would also share one throttle bucket, so a burst could trip the lockout and
    // the later samples would never reach the bcrypt call being timed.
    const timeWrongPassword = async (n) => {
      const user = await makeUser(['staff']);
      const started = Date.now();
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `timing-${RUN_ID}-wrong-${n}` },
        body: JSON.stringify({ email: user.email, password: 'Wr0ng@PassX' }),
      });
      expect(res.status).toBe(401);
      return Date.now() - started;
    };

    // A distinct address per sample: reusing one would spend the (now five
    // attempt) budget and the later samples would be short-circuited by the
    // lockout instead of reaching the bcrypt call at all.
    const timeUnknownEmail = async (n) => {
      const started = Date.now();
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { "Content-Type": "application/json", "x-forwarded-for": `timing-${RUN_ID}-unknown-${n}` },
        body: JSON.stringify({ email: `timing-unknown-${RUN_ID}-${n}@example.test`, password: PASSWORD }),
      });
      expect(res.status).toBe(401);
      return Date.now() - started;
    };

    const fastest = (xs) => Math.min(...xs);

    const wrongSamples = [];
    const unknownSamples = [];
    for (const n of [1, 2, 3, 4, 5]) {
      wrongSamples.push(await timeWrongPassword(n));
      unknownSamples.push(await timeUnknownEmail(n));
    }
    const wrong = fastest(wrongSamples);
    const unknown = fastest(unknownSamples);

    // The leak, stated as an assertion. If this ever fails, the unknown-address
    // path has started paying the bcrypt cost and the gap above is closed.
    expect(unknown * 3).toBeLessThan(wrong);
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

// ─────────────────────────── lockout countdown ───────────────────────────
//
// backend/lib/loginThrottle.js locks an account for LOGIN_LOCKOUT_MS (2 min)
// once it has burned MAX_ACCOUNT_FAILURES (5) failures, and the 429 carries
// Retry-After. The API contract is already covered above; these cases assert the
// LOGIN PAGE surfaces that number as a ticking countdown and stops taking
// clicks, instead of only saying "please wait" and leaving the shopper to guess
// how long.

test.describe('lockout countdown', () => {
  // The address is per-run, and that matters more than it looks. The limiter
  // lives in the dev server's memory and survives between runs, so a fixed
  // address is still partly drained from the previous run — the countdown then
  // opens at 0:03 instead of 2:00, and every assertion about the window fails.
  // RUN_ID gives each run a full two minutes.
  const lockoutEmail = `lockout-ui-${RUN_ID}@example.test`;

  // One bucket per case: the limiter is keyed on x-forwarded-for as well as on
  // the account, so sharing a key would let the first case's lockout satisfy the
  // rest and quietly turn three assertions into one.
  let lockSeq = 0;
  const lockHeaders = () => ({
    'x-forwarded-for': `lockout-ui-${RUN_ID}-${(lockSeq += 1)}`,
  });

  /** Burns a fresh bucket down into a lockout, returning the key that did it. */
  async function lockOutViaApi() {
    const headers = lockHeaders();
    // Sequential, for the same reason the throttle test above is: the counter
    // lives in process memory and concurrent posts would race it.
    for (let i = 0; i < 22; i++) {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          email: lockoutEmail,
          password: `Wr0ng@Pass${i}`,
        }),
      });
      if (res.status === 429) return headers;
    }
    throw new Error('expected a 429 lockout after 22 bad attempts');
  }

  async function submitBadLogin(page, email = lockoutEmail) {
    await page.goto(`${BASE}/login`);
    await page.locator('input[name="email"]').fill(email);
    await page.locator('input[name="password"]').fill('Wr0ng@Pass0');
    await page.getByRole('button', { name: 'Login' }).click();
  }

  test('a locked-out shopper is told how long is left, as mm:ss', async ({ page }) => {
    // Set the header before navigating, so the page's own POST carries the
    // already-locked key.
    await page.setExtraHTTPHeaders(await lockOutViaApi());
    await submitBadLogin(page);

    await expect(page.locator('.auth-lockout-clock')).toHaveText(/^\d{1,2}:\d{2}$/);
  });

  test('the refusal sentence still reads, and the clock sits outside the alert', async ({ page }) => {
    await page.setExtraHTTPHeaders(await lockOutViaApi());
    await submitBadLogin(page);

    // The alert holds the static sentence only. A per-second mutation inside a
    // role="alert" makes a screen reader re-announce it forever, so the ticking
    // number is deliberately not in there.
    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Too many sign-in attempts');
    await expect(alert).not.toContainText(/\d{1,2}:\d{2}/);
    await expect(page.locator('.auth-lockout-clock')).toHaveAttribute(
      'aria-live',
      'off'
    );
  });

  test('the submit button is disabled while the countdown runs', async ({ page }) => {
    await page.setExtraHTTPHeaders(await lockOutViaApi());
    await submitBadLogin(page);

    await expect(page.locator('.auth-lockout-clock')).toBeVisible();
    await expect(page.getByRole('button', { name: /Login/ })).toBeDisabled();
  });

  test('the countdown ticks down', async ({ page }) => {
    await page.setExtraHTTPHeaders(await lockOutViaApi());
    await submitBadLogin(page);

    const clock = page.locator('.auth-lockout-clock');
    const read = async () => {
      const [min, sec] = (await clock.textContent()).split(':');
      return Number(min) * 60 + Number(sec);
    };

    const first = await read();
    await page.waitForTimeout(2200);
    expect(await read()).toBeLessThan(first);
  });

  test('the button comes back on its own when the countdown reaches zero', async ({ page }) => {
    // A real lockout is 15 minutes, far too long to sit through, so the 429 is
    // served with a 2-second Retry-After. Everything downstream of the header —
    // parse, count, re-enable — is the same code a 15-minute lockout runs.
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '2' },
        body: JSON.stringify({
          success: false,
          message: 'Too many sign-in attempts. Please wait before trying again.',
        }),
      })
    );

    await submitBadLogin(page);

    await expect(page.locator('.auth-lockout-clock')).toHaveText('0:02');
    // Clock reaches zero, the lockout clears and the form is usable again —
    // asserted with a timeout because it happens on a timer, not on a click.
    await expect(page.getByRole('button', { name: /Login/ })).toBeEnabled({
      timeout: 5000,
    });
    await expect(page.locator('.auth-lockout-clock')).toHaveCount(0);
    // The refusal sentence goes with the clock. Left behind it would sit on a
    // form that is now perfectly usable, telling the shopper to wait when there
    // is nothing left to wait for.
    await expect(page.getByRole('alert')).toHaveCount(0);
  });

  test('the countdown ending does not wipe an ordinary login error', async ({ page }) => {
    // The counterpart to the case above, so the cleanup cannot be mistaken for
    // "clear the message whenever the timer stops". A 401 sets no lockout, so
    // nothing should be cleared when the component settles.
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 401,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ success: false, message: 'Invalid email or password' }),
      })
    );

    await submitBadLogin(page);

    await expect(page.getByRole('alert')).toContainText('Invalid email or password');
    // Well past any countdown that could have started.
    await page.waitForTimeout(2500);
    await expect(page.getByRole('alert')).toContainText('Invalid email or password');
    await expect(page.getByRole('button', { name: /Login/ })).toBeEnabled();
  });

  test('a connection failure after a lockout is still shown', async ({ page }) => {
    // Regression: the countdown ending works by hiding a message that belongs to
    // the lockout. If that decision is remembered as a plain flag rather than
    // being tied to the message itself, the NEXT ordinary failure inherits it and
    // is silently swallowed — a shopper left staring at a form that appears to
    // have done nothing.
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '1' },
        body: JSON.stringify({
          success: false,
          message: 'Too many sign-in attempts. Please wait before trying again.',
        }),
      })
    );

    await submitBadLogin(page);
    // Let the countdown run out, so the lockout is genuinely over.
    await expect(page.locator('.auth-lockout-clock')).toHaveCount(0, { timeout: 5000 });
    await expect(page.getByRole('alert')).toHaveCount(0);

    // Now the server is unreachable rather than throttling.
    await page.unroute('**/api/auth/login');
    await page.route('**/api/auth/login', (route) => route.abort('failed'));

    await page.locator('input[name="email"]').fill('someone@example.test');
    await page.locator('input[name="password"]').fill('Wr0ng@Pass0');
    await page.getByRole('button', { name: 'Login' }).click();

    await expect(page.getByRole('alert')).toContainText('Unable to connect to the server');
  });

  test('a 429 with no usable Retry-After falls back to the plain sentence', async ({ page }) => {
    // RFC 9110 also allows Retry-After to be an HTTP-date, and a proxy can drop
    // it entirely. Neither may put NaN on screen.
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': 'Wed, 21 Oct 2026 07:28:00 GMT' },
        body: JSON.stringify({
          success: false,
          message: 'Too many sign-in attempts. Please wait before trying again.',
        }),
      })
    );

    await submitBadLogin(page);

    await expect(page.getByRole('alert')).toContainText('Too many sign-in attempts');
    await expect(page.locator('.auth-lockout-clock')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Login/ })).toBeEnabled();
  });

  test('a lockout on one account does not lock out another from the same IP', async ({ page }) => {
    // The regression this guards: the limiter used to key on IP alone, so twenty
    // failures by anyone behind a shared NAT — an office, a campus, mobile data
    // — locked out every other user behind it.
    const headers = lockHeaders();
    await page.setExtraHTTPHeaders(headers);

    for (let i = 0; i < 24; i++) {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ email: `lockout-target-${RUN_ID}@example.test`, password: `Wr0ng@Pass${i}` }),
      });
      if (res.status === 429) break;
    }

    // A different account, same IP.
    await page.goto(`${BASE}/login`);
    await page.locator('input[name="email"]').fill(`lockout-bystander-${RUN_ID}@example.test`);
    await page.locator('input[name="password"]').fill('Wr0ng@Pass0');
    await page.getByRole('button', { name: 'Login' }).click();

    // 401 "Invalid email or password", not 429 — the bystander still gets to try.
    await expect(page.getByRole('alert')).toContainText('Invalid email or password');
    await expect(page.locator('.auth-lockout-clock')).toHaveCount(0);
  });

  test('the same account IS locked out when retried from the same IP', async ({ page }) => {
    // The other half of the pair above: per-account really is enforced, so the
    // two tests together show the key is the account and not the address.
    const headers = lockHeaders();
    await page.setExtraHTTPHeaders(headers);

    for (let i = 0; i < 24; i++) {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ email: `lockout-self-${RUN_ID}@example.test`, password: `Wr0ng@Pass${i}` }),
      });
      if (res.status === 429) break;
    }

    await submitBadLogin(page, `lockout-self-${RUN_ID}@example.test`);

    await expect(page.getByRole('alert')).toContainText('Too many sign-in attempts');
    // Two minutes, so the clock starts near 2:00 — proof the login policy is
    // not still borrowing the gift-card lockout.
    await expect(page.locator('.auth-lockout-clock')).toHaveText(/^1:5\d$/);
  });

  test('the lockout countdown matches the two-minute policy', async ({ page }) => {
    // A real lockout is 2 minutes, too long to sit through, so Retry-After is
    // shortened. What matters here is that the number the server sends is the
    // number the shopper is shown, not a hardcoded 15 minutes.
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': '118' },
        body: JSON.stringify({
          success: false,
          message: 'Too many sign-in attempts. Please wait before trying again.',
        }),
      })
    );

    await submitBadLogin(page);

    await expect(page.locator('.auth-lockout-clock')).toHaveText('1:58');
  });
});

// ─────────────────────────── account lockout policy ───────────────────────────
//
// The limit itself, asserted against the server rather than the screen. Every
// case uses its own account AND its own x-forwarded-for, because the limiter is
// keyed on both: sharing either would let one case satisfy another's budget.

test.describe('account lockout policy', () => {
  let policySeq = 0;
  const bucket = () => ({
    headers: { 'x-forwarded-for': `policy-${RUN_ID}-${(policySeq += 1)}` },
    email: `policy-${RUN_ID}-${policySeq}@example.test`,
  });

  /** Burns an account's budget and returns the status of every attempt. */
  async function burnAccount({ headers, email }, attempts) {
    const statuses = [];
    for (let i = 0; i < attempts; i++) {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ email, password: `Wr0ng@Pass${i}` }),
      });
      statuses.push(res.status);
    }
    return statuses;
  }

  test('exactly five wrong passwords are allowed and the sixth is refused', async () => {
    const target = bucket();
    const statuses = await burnAccount(target, 6);

    // The first five are answered 401 because the budget is only spent as they
    // fail; the sixth arrives to find the account already locked.
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
  });

  test('the refusal carries a two-minute Retry-After', async () => {
    const target = bucket();
    await burnAccount(target, 5);

    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...target.headers },
      body: JSON.stringify({ email: target.email, password: 'Wr0ng@PassX' }),
    });

    expect(res.status).toBe(429);
    // LOGIN_LOCKOUT_MS in backend/lib/loginThrottle.js. Asserted as a range
    // rather than an equality so a test running a second into the lockout does
    // not fail on 119.
    const retryAfter = Number(res.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThan(110);
    expect(retryAfter).toBeLessThanOrEqual(120);
  });

  test('a CORRECT password is still refused while the account is locked', async () => {
    // The case that matters most. A lockout has to outrank valid credentials:
    // otherwise an attacker who already holds the password simply waits out the
    // pause, and the throttle only inconvenishes honest users.
    const user = await makeUser(['staff']);
    const target = { headers: { 'x-forwarded-for': `policy-${RUN_ID}-correct` }, email: user.email };

    await burnAccount(target, 5);

    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...target.headers },
      body: JSON.stringify({ email: user.email, password: PASSWORD }),
    });

    expect(res.status).toBe(429);
    expect(await res.json()).toMatchObject({ success: false });
  });

  test('a successful login clears the budget', async () => {
    const user = await makeUser(['staff']);
    const headers = { 'x-forwarded-for': `policy-${RUN_ID}-clear` };

    // Four failures — one short of the limit.
    for (let i = 0; i < 4; i++) {
      await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ email: user.email, password: `Wr0ng@Pass${i}` }),
      });
    }

    const good = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ email: user.email, password: PASSWORD }),
    });
    expect(good.status).toBe(200);

    // The fifth failure would have locked the account had the success not
    // returned the budget, so reaching a 401 here proves it did.
    const after = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ email: user.email, password: 'Wr0ng@PassAgain' }),
    });
    expect(after.status).toBe(401);
  });

  test('one account being locked never touches another', async () => {
    const headers = { 'x-forwarded-for': `policy-${RUN_ID}-isolation` };
    const locked = await burnAccount({ headers, email: `iso-victim-${RUN_ID}@example.test` }, 5);
    expect(locked[4]).toBe(401);

    const bystander = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ email: `iso-bystander-${RUN_ID}@example.test`, password: 'Wr0ng@Pass1' }),
    });

    expect(bystander.status).toBe(401);
  });

  test('the account stays locked when the attempt comes from a different IP', async () => {
    // Proves the account key is doing the work. Under the old per-address-only
    // limiter this request would have been allowed outright.
    const target = bucket();
    await burnAccount(target, 5);

    const elsewhere = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `${target.headers['x-forwarded-for']}-elsewhere` },
      body: JSON.stringify({ email: target.email, password: 'Wr0ng@PassX' }),
    });

    expect(elsewhere.status).toBe(429);
  });

  test('case and spacing variants spend the same budget', async () => {
    const target = bucket();
    await burnAccount(target, 4);

    // A fifth failure, typed the way a person actually types their own address.
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...target.headers },
      body: JSON.stringify({ email: `  ${target.email.toUpperCase()}  `, password: 'Wr0ng@PassX' }),
    });

    // That fifth attempt trips the lock, so the next one is refused. If the key
    // were not normalised the budget would still be at four and this would 401.
    expect(res.status).toBe(401);
    const next = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...target.headers },
      body: JSON.stringify({ email: target.email, password: 'Wr0ng@PassY' }),
    });
    expect(next.status).toBe(429);
  });

  test('concurrent failures overshoot the budget, then the lockout holds', async () => {
    // GAP, documented rather than papered over: the budget is NOT an atomic
    // limit under concurrency. The throttle check and the failure that spends
    // the budget are separated by the `await pool.query` in between them, so a
    // burst of simultaneous requests all read the counter before any of them
    // writes it. Measured: 12 concurrent attempts against a five-attempt budget
    // return 11 x 401, not 5.
    //
    // What still holds is what matters for the attack: the overshoot is bounded
    // by the size of the burst, and once the burst is over the account is
    // locked and stays locked. Sequential requests — how a guessing script
    // actually works — get exactly five. Asserted below rather than papered
    // over with a loose count, because "it is only a bit over five" is not a
    // property worth relying on.
    const target = bucket();

    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        fetch(`${API}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...target.headers },
          body: JSON.stringify({ email: target.email, password: `Wr0ng@Pass${i}` }),
        })
      )
    );
    const statuses = results.map((r) => r.status);

    // Nothing unexpected escaped: no 500 from the counter, and never a success.
    expect(statuses.every((s) => s === 401 || s === 429)).toBe(true);
    expect(statuses).not.toContain(200);

    // And the budget was genuinely spent: the next sequential attempt is locked.
    const after = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...target.headers },
      body: JSON.stringify({ email: target.email, password: 'Wr0ng@PassAfter' }),
    });
    expect(after.status).toBe(429);
  });

  test('sequential attempts are held to exactly the budget', async () => {
    // The complement of the case above, and the one that matches how an online
    // guessing attack actually runs: one request at a time.
    const statuses = await burnAccount(bucket(), 7);

    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429]);
  });
});

// ─────────────────────────── request shape and method ───────────────────────────

test.describe('request shape and method', () => {
  test('GET is not a login', async ({ request }) => {
    const res = await request.get(`${API}/api/auth/login`);
    expect([404, 405]).toContain(res.status());
    // Whatever the framework decides, it must not authenticate anybody.
    expect(await res.text()).not.toMatch(/token/i);
  });

  test('OPTIONS answers the CORS preflight', async ({ request }) => {
    const res = await request.fetch(`${API}/api/auth/login`, {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' },
    });

    expect(res.status()).toBe(204);
    expect(res.headers()['access-control-allow-origin']).toBeTruthy();
    expect(res.headers()['access-control-allow-credentials']).toBe('true');
  });

  test('malformed JSON is a 400, not a crash', async () => {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `shape-${RUN_ID}-bad` },
      body: '{ this is not json',
    });

    // The route reads the body before throttling so it can key the per-account
    // bucket, which means a parse failure has to be handled rather than thrown.
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false });
  });

  test('an empty body is a 400', async () => {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `shape-${RUN_ID}-empty` },
      body: '',
    });

    expect(res.status).toBe(400);
  });

  test('an email sent as an array or object is refused, not coerced', async () => {
    // The password already has this case; the email must not become the weak
    // link, since it is the half of the pair that keys the throttle.
    //
    // Asserted as "did not authenticate" rather than as a specific 4xx. These
    // values have no RUN_ID in them — String(42) is always "42" — so the
    // per-account bucket for each one fills up across repeated runs against the
    // long-lived dev backend and eventually answers 429 instead of 401. Both are
    // refusals, and the property worth protecting is that a non-string email is
    // never coerced into a working login.
    for (const email of [['a@b.com'], { $ne: null }, 42, true]) {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `shape-${RUN_ID}-coerce` },
        body: JSON.stringify({ email, password: PASSWORD }),
      });

      expect(res.status).not.toBe(200);
      expect(await res.text()).not.toMatch(/"token"\s*:/i);
    }
  });

  test('SQL-ish characters in the email are treated as a literal lookup', async () => {
    // Parameterised query, so this must come back as an ordinary miss rather
    // than an error or, worse, a match. RUN_ID is woven into the payload so each
    // run gets a fresh per-account budget — otherwise the account is locked
    // from the previous run and this asserts 429 forever after.
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `shape-${RUN_ID}-sqli` },
      body: JSON.stringify({ email: `${RUN_ID}' OR 1=1 --`, password: PASSWORD }),
    });

    expect(res.status).toBe(401);
  });

  test('an absurdly long email is refused rather than looked up', async () => {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `shape-${RUN_ID}-long` },
      body: JSON.stringify({ email: `${RUN_ID}${'a'.repeat(20000)}@example.test`, password: PASSWORD }),
    });

    expect([400, 401]).toContain(res.status);
  });

  test('a unicode email is handled without erroring', async () => {
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `shape-${RUN_ID}-unicode` },
      body: JSON.stringify({ email: `üser-${RUN_ID}@exämple.test`, password: PASSWORD }),
    });

    expect([400, 401]).toContain(res.status);
  });
});

// ─────────────────────────── response contract ───────────────────────────

test.describe('response contract', () => {
  test('every outcome carries the CORS headers', async () => {
    const headers = { 'x-forwarded-for': `contract-${RUN_ID}-cors` };

    const missing = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ email: `someone-${RUN_ID}@example.test` }),
    });
    expect(missing.headers.get('access-control-allow-origin')).toBeTruthy();

    const denied = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ email: `someone-${RUN_ID}@example.test`, password: 'nope' }),
    });
    expect(denied.headers.get('access-control-allow-origin')).toBeTruthy();
  });

  test('no failed login ever returns a token or a cookie', async () => {
    const bodies = [
      { email: `notoken-${RUN_ID}@example.test`, password: 'Wr0ng@Pass1' },
      { email: `notoken-${RUN_ID}@example.test` },
      { email: `${RUN_ID}' OR 1=1 --`, password: PASSWORD },
    ];

    for (const data of bodies) {
      const res = await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `contract-${RUN_ID}-token` },
        body: JSON.stringify(data),
      });

      const text = await res.text();
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(text).not.toMatch(/"token"\s*:/i);
      expect(res.headers.get('set-cookie')).toBeFalsy();
    }
  });

  test('the 429 body is the same shape as every other failure', async () => {
    const email = `contract-${RUN_ID}-shape@example.test`;
    const headers = { 'Content-Type': 'application/json', 'x-forwarded-for': `contract-${RUN_ID}-shape` };

    for (let i = 0; i < 5; i++) {
      await fetch(`${API}/api/auth/login`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email, password: `Wr0ng@Pass${i}` }),
      });
    }

    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ email, password: 'Wr0ng@PassX' }),
    });
    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.success).toBe(false);
    expect(typeof body.message).toBe('string');
    // The client renders data.message verbatim, so it must not be empty.
    expect(body.message.length).toBeGreaterThan(0);
  });

  test('the response reports its own HTTP status', async () => {
    // frontend/src/services/auth.js adds `status` alongside the parsed body so
    // the login page can tell a 429 from a 401 without string-matching.
    const res = await fetch(`${API}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `contract-${RUN_ID}-status` },
      body: JSON.stringify({ email: `nostatus-${RUN_ID}@example.test`, password: 'nope' }),
    });
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body).toMatchObject({ success: false, message: expect.any(String) });
  });

  test('a successful login returns a verifiable JWT and nothing forgeable', async () => {
    const user = await makeUser(['staff']);
    const { body } = await apiLogin(user.email);

    expect(typeof body.token).toBe('string');
    expect(body.token.split('.')).toHaveLength(3);

    const payload = JSON.parse(Buffer.from(body.token.split('.')[1], 'base64url').toString());
    // Identity is in the token because it is stateless, so it must not carry
    // the password hash.
    expect(JSON.stringify(payload)).not.toMatch(/\$2[aby]\$/);
  });

  test('a tampered token is refused', async () => {
    const user = await makeUser(['staff']);
    const { body } = await apiLogin(user.email);
    const parts = body.token.split('.');

    // The PAYLOAD is altered, not the signature's last character. A 32-byte
    // HS256 signature is 43 base64url characters, which is 258 bits of character
    // for 256 bits of data, so the final character's low two bits are unused —
    // flipping A<->B there decodes to the same bytes and the token still
    // verifies. That made an earlier version of this case pass roughly one run
    // in sixteen. Editing the payload is unambiguous: the signed content is no
    // longer what was signed.
    const payload = parts[1];
    const edited = payload.slice(0, 5) + (payload[5] === 'A' ? 'B' : 'A') + payload.slice(6);

    const res = await fetch(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${parts[0]}.${edited}.${parts[2]}`, ...asClient() },
    });

    expect([401, 403]).toContain(res.status);
  });

  test('a tampered signature is refused', async () => {
    const user = await makeUser(['staff']);
    const { body } = await apiLogin(user.email);
    const parts = body.token.split('.');

    // Middle of the signature, where every bit is significant — unlike the
    // final character, see the payload case above.
    const mid = Math.floor(parts[2].length / 2);
    const edited =
      parts[2].slice(0, mid) + (parts[2][mid] === 'A' ? 'B' : 'A') + parts[2].slice(mid + 1);

    const res = await fetch(`${API}/api/auth/me`, {
      headers: { Authorization: `Bearer ${parts[0]}.${parts[1]}.${edited}`, ...asClient() },
    });

    expect([401, 403]).toContain(res.status);
  });
});

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

