import test from "node:test";
import assert from "node:assert/strict";
import { createPaymentProvider, registeredProviders } from "../payment/provider.js";
import { SandboxProvider } from "../payment/sandbox.js";

test("sandbox provider settles a successful intent", async () => {
  const p = new SandboxProvider();
  const intent = await p.createIntent({ amount: 500, currency: "INR", reference: "r1" });
  assert.equal(intent.status, "PENDING");
  const done = await p.confirm(intent.intentId, { outcome: "succeed" });
  assert.equal(done.status, "PAID");
  assert.ok(done.reference);
});

test("sandbox provider reports failure with a reason", async () => {
  const p = new SandboxProvider();
  const intent = await p.createIntent({ amount: 500, currency: "INR", reference: "r2" });
  const done = await p.confirm(intent.intentId, { outcome: "fail" });
  assert.equal(done.status, "FAILED");
  assert.equal(done.failureReason, "Card declined");
});

test("confirming an unknown intent fails rather than settling", async () => {
  const p = new SandboxProvider();
  const done = await p.confirm("nope", { outcome: "succeed" });
  assert.equal(done.status, "FAILED");
});

test("registry returns the sandbox by name and throws otherwise", () => {
  assert.equal(createPaymentProvider("sandbox").name, "sandbox");
  assert.throws(() => createPaymentProvider("stripe"), /Unknown payment provider/);
});

test("amounts are echoed exactly, to the paisa", async () => {
  const p = new SandboxProvider();
  const intent = await p.createIntent({ amount: 333.33, currency: "INR", reference: "r3" });
  assert.equal(intent.amount, 333.33);
});

test("registry lists the providers it can build", () => {
  assert.deepEqual(registeredProviders(), ["sandbox"]);
});

test("refund reports the refunded amount and reference", async () => {
  const p = new SandboxProvider();
  const r = await p.refund("sbx_ref_1", 250);
  assert.equal(r.status, "REFUNDED");
  assert.equal(r.reference, "sbx_ref_1");
  assert.equal(r.amount, 250);
});

test("failEvery forces an intermittent decline without stubbing", async () => {
  // Every 2nd call fails, so the forced path is genuinely exercised.
  const p = new SandboxProvider({ failEvery: 2 });
  const a = await p.createIntent({ amount: 100, currency: "INR", reference: "f1" });
  const b = await p.createIntent({ amount: 100, currency: "INR", reference: "f2" });
  const first = await p.confirm(a.intentId, { outcome: "succeed" });
  const second = await p.confirm(b.intentId, { outcome: "succeed" });
  assert.equal(first.status, "PAID");
  assert.equal(second.status, "FAILED");
});

test("confirm echoes the settled amount and currency so callers can reconcile", async () => {
  const p = new SandboxProvider();
  const ok = await p.createIntent({ amount: 499.99, currency: "USD", reference: "m1" });
  const paid = await p.confirm(ok.intentId, { outcome: "succeed" });
  assert.equal(paid.amount, 499.99);
  assert.equal(paid.currency, "USD");

  const bad = await p.createIntent({ amount: 120, currency: "INR", reference: "m2" });
  const declined = await p.confirm(bad.intentId, { outcome: "fail" });
  assert.equal(declined.status, "FAILED");
  assert.equal(declined.failureReason, "Card declined");
  assert.equal(declined.amount, 120);
  assert.equal(declined.currency, "INR");
});

test("metadata round-trips through createIntent and confirm", async () => {
  const p = new SandboxProvider();
  const withMeta = await p.createIntent({
    amount: 700,
    currency: "INR",
    reference: "meta1",
    metadata: { userId: "u1", tier: "gold" },
  });
  assert.deepEqual(withMeta.metadata, { userId: "u1", tier: "gold" });

  const settled = await p.confirm(withMeta.intentId, { outcome: "succeed" });
  assert.deepEqual(settled.metadata, { userId: "u1", tier: "gold" });

  const bare = await p.createIntent({ amount: 10, currency: "INR", reference: "meta2" });
  assert.deepEqual(bare.metadata, {});
  const bareSettled = await p.confirm(bare.intentId, { outcome: "succeed" });
  assert.deepEqual(bareSettled.metadata, {});
});

test("unknown intent failure carries no amount because none was stored", async () => {
  const p = new SandboxProvider();
  const done = await p.confirm("missing", { outcome: "succeed" });
  assert.deepEqual(done, { status: "FAILED", failureReason: "Unknown payment intent" });
});
