// The permission decision itself, kept free of Next.js and of `pg` so it can be
// unit tested directly (lib/authorization.js imports next/headers and the
// database pool, neither of which exists under `node --test`).
//
// Kept deliberately as a pure predicate over an already-resolved access object
// - the same shape getUserAccess() returns - so there is exactly one place that
// decides "may this user do this", and the route layer only has to fetch it.
export function hasPermission(access, slug) {
  if (access.roles.includes("super_admin")) return true;
  return access.permissions.includes(slug);
}
