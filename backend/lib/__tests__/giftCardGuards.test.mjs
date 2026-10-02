import test from "node:test";
import assert from "node:assert/strict";
import {
  checkGuessAllowed,
  clearFailedGuesses,
  clientKey,
  recordFailedGuess,
  GUESS_WINDOW_MS,
  LOCKOUT_MS,
  MAX_GUESSES_PER_WINDOW,
} from "../giftCardGuards.js";

test("client key prefers the forwarded client address", () => {
  const request = {
    headers: {
      get: (name) =>
        ({
          "x-forwarded-for": "203.0.113.9, 10.0.0.1",
          "x-real-ip": "10.0.0.1",
        })[name],
    },
  };
  assert.equal(clientKey(request), "203.0.113.9");
  assert.equal(clientKey({ headers: { get: () => null } }), "unknown");
});

test("a clean client is always allowed", () => {
  assert.deepEqual(checkGuessAllowed(new Map(), "1.2.3.4"), { ok: true });
});

test("failures lock the client out after the threshold", () => {
  const log = new Map();
  const now = 1_000_000;
  for (let i = 0; i < MAX_GUESSES_PER_WINDOW - 1; i++) {
    recordFailedGuess(log, "1.2.3.4", now);
  }
  assert.equal(checkGuessAllowed(log, "1.2.3.4", now).ok, true, "still allowed below the limit");

  recordFailedGuess(log, "1.2.3.4", now);
  const blocked = checkGuessAllowed(log, "1.2.3.4", now);
  assert.equal(blocked.ok, false);
  assert.ok(blocked.retryAfterSec > 0);
});

test("a successful guess clears the budget", () => {
  const log = new Map();
  const now = 1_000_000;
  recordFailedGuess(log, "1.2.3.4", now);
  recordFailedGuess(log, "1.2.3.4", now);
  assert.equal(log.get("1.2.3.4").count, 2);

  clearFailedGuesses(log, "1.2.3.4");
  assert.equal(log.get("1.2.3.4"), undefined);
  assert.equal(checkGuessAllowed(log, "1.2.3.4", now).ok, true);
});

test("the lockout expires and the window resets on its own", () => {
  const log = new Map();
  const now = 1_000_000;
  for (let i = 0; i < MAX_GUESSES_PER_WINDOW; i++) {
    recordFailedGuess(log, "1.2.3.4", now);
  }
  assert.equal(checkGuessAllowed(log, "1.2.3.4", now).ok, false);

  const afterLockout = now + LOCKOUT_MS + 1;
  assert.equal(checkGuessAllowed(log, "1.2.3.4", afterLockout).ok, true, "lockout lifted");

  // And a long-idle client starts from a clean count.
  recordFailedGuess(log, "1.2.3.4", now + GUESS_WINDOW_MS + 1);
  assert.equal(log.get("1.2.3.4").count, 1);
});

test("one noisy client does not affect another", () => {
  const log = new Map();
  const now = 1_000_000;
  for (let i = 0; i < MAX_GUESSES_PER_WINDOW; i++) {
    recordFailedGuess(log, "1.1.1.1", now);
  }
  assert.equal(checkGuessAllowed(log, "1.1.1.1", now).ok, false);
  assert.equal(checkGuessAllowed(log, "2.2.2.2", now).ok, true);
});
