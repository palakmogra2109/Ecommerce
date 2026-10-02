import { randomUUID } from "node:crypto";

// Deterministic stand-in for a real gateway. It exists so purchase, issue,
// refund and failure paths are exercisable in development and tests. It never
// claims to be a real charge.
export class SandboxProvider {
  constructor({ failEvery = 0 } = {}) {
    this.name = "sandbox";
    this.intents = new Map();
    this.calls = 0;
    this.failEvery = failEvery;
  }

  async createIntent({ amount, currency = "INR", reference, metadata = {} }) {
    const intentId = `sbx_${randomUUID()}`;
    this.intents.set(intentId, { amount, currency, reference, metadata });
    return { intentId, status: "PENDING", amount, currency, reference, metadata };
  }

  async confirm(intentId, { outcome = "succeed" } = {}) {
    const intent = this.intents.get(intentId);
    if (!intent) {
      return { status: "FAILED", failureReason: "Unknown payment intent" };
    }
    const { amount, currency, metadata } = intent;
    // Lets a test force intermittent failure without stubbing the method.
    this.calls += 1;
    const forced = this.failEvery > 0 && this.calls % this.failEvery === 0;
    if (outcome === "fail" || forced) {
      intent.status = "FAILED";
      return { status: "FAILED", failureReason: "Card declined", amount, currency, metadata };
    }
    intent.status = "PAID";
    return {
      status: "PAID",
      reference: `sbx_ref_${intentId}`,
      amount,
      currency,
      metadata,
    };
  }

  async refund(reference, amount) {
    return { status: "REFUNDED", reference, amount };
  }
}
