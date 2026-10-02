// Pure wallet-bucket allocation: which gift cards pay for a cart, and how much
// each one contributes. No DB access, so the same decision can be previewed in
// a quote, taken under FOR UPDATE in the order transaction, and unit tested.
//
// A bucket is the remainder of one card and carries that card's scope, because
// money from a brand-restricted card may only be spent on that brand. The cart
// is therefore modelled as a list of line items with a *remaining* value, and
// every bucket spends only value that is both still unallocated and permitted
// by its own scope. That is what keeps a Nike card from paying for the Adidas
// line in the same basket, and what stops a second Nike card from re-spending
// the paise the first one already took.
import { eligibleTotal, isEligible, isUnrestricted, linePaise, round2, toPaise } from "./giftCardApplicability.js";

// Unlimited unless a finite, non-negative count was given. A fractional limit
// is floored (an allocation is a whole bucket), a negative one becomes 0.
function bucketLimit(value) {
  if (value == null || value === "") return Infinity;
  const n = Number(value);
  if (!Number.isFinite(n)) return Infinity;
  return Math.max(0, Math.floor(n));
}

/**
 * Draws `amount` out of `buckets`, in the order given.
 *
 * Returns { allocations, covered, shortfall, fullyCovered, truncatedByMaxBuckets }
 * where allocations is [{ bucketId, amount }] for contributing buckets only.
 *
 * `lineItems` is what bounds a bucket: absent means the cart was not supplied,
 * so capacity is treated as unbounded and only the requested amount limits the
 * draw; an array (including an empty one) is treated as the real cart, so a
 * cart worth nothing can be covered by nothing.
 */
export function allocate({ buckets = [], amount = 0, lineItems = null, maxBuckets = null } = {}) {
  const list = Array.isArray(buckets) ? buckets : [];
  const targetPaise = Math.max(0, toPaise(amount));
  const limit = bucketLimit(maxBuckets);

  const cartKnown = Array.isArray(lineItems);
  const lines = cartKnown ? lineItems.map((item) => ({ item, paise: linePaise(item) })) : [];

  // The same lines, with each one priced at what is left of it. Feeding these
  // to eligibleTotal() is what applies a scope to the *remaining* cart.
  const remainingLines = () =>
    lines.map((line) => ({ ...(line.item || {}), unitPrice: line.paise / 100, quantity: 1 }));

  const cartRemainingPaise = () => lines.reduce((sum, line) => sum + line.paise, 0);

  // Spends up to `want` paise from lines this scope permits, in cart order,
  // returning how much was actually available. Buckets with nothing to give
  // return 0 and leave the cart untouched.
  const consume = (want, scope) => {
    // No cart was supplied, so there is nothing to model line by line: the cap
    // computed below is already the whole limit (the requested amount, or the
    // eligible total, which is 0 without line items).
    if (!cartKnown) return want;
    const unrestricted = isUnrestricted(scope);
    let left = want;
    for (const line of lines) {
      if (left <= 0) break;
      if (!unrestricted && !isEligible(scope, line.item)) continue;
      const spend = Math.min(line.paise, left);
      line.paise -= spend;
      left -= spend;
    }
    return want - left;
  };

  const allocations = [];
  let coveredPaise = 0;
  let stoppedAtLimit = false;

  for (const bucket of list) {
    // Only buckets that contribute consume a slot: a card that cannot pay for
    // anything in this cart should not cost the caller one of its N cards.
    // Checked before the early stop so that "the limit is what ended the walk"
    // is a fact on its own, reported only when it actually cost coverage.
    if (allocations.length >= limit) {
      stoppedAtLimit = true;
      break;
    }
    if (coveredPaise >= targetPaise) break;

    const usable = Math.min(Math.max(0, toPaise(bucket?.amount)), targetPaise - coveredPaise);
    if (usable <= 0) continue;

    // Cheapest cap first: what is left to cover, then what the cart still
    // holds (so a draw can never exceed the basket even when the requested
    // amount does), then — for a restricted bucket — what its own scope can
    // still pay for out of what is left.
    let cap = usable;
    if (cartKnown) cap = Math.min(cap, cartRemainingPaise());
    if (!isUnrestricted(bucket?.scope)) {
      cap = Math.min(cap, toPaise(eligibleTotal(bucket.scope, remainingLines())));
    }
    if (cap <= 0) continue;

    const contribution = consume(cap, bucket?.scope);
    if (contribution <= 0) continue;
    allocations.push({ bucketId: bucket?.id ?? null, amount: round2(contribution / 100) });
    coveredPaise += contribution;
  }

  const shortfallPaise = Math.max(0, targetPaise - coveredPaise);
  return {
    allocations,
    covered: round2(coveredPaise / 100),
    shortfall: round2(shortfallPaise / 100),
    fullyCovered: shortfallPaise === 0,
    // Only meaningful when the limit is what stopped the walk: if the cart ran
    // out of money first there is nothing to report as truncated.
    truncatedByMaxBuckets: stoppedAtLimit && shortfallPaise > 0,
  };
}