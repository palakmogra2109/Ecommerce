import { SandboxProvider } from "./sandbox.js";

const REGISTRY = { sandbox: SandboxProvider };

// The rest of the system depends only on this contract, so adding a live
// gateway is a new class plus one registry entry — no call site changes.
export function createPaymentProvider(name = "sandbox") {
  const Ctor = REGISTRY[name];
  if (!Ctor) {
    throw new Error(`Unknown payment provider: ${name}`);
  }
  return new Ctor();
}

export function registeredProviders() {
  return Object.keys(REGISTRY);
}
