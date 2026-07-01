/**
 * Shared response helpers for the `routes/` mount-functions. Centralises
 * the `new Response(JSON.stringify(body), { status, headers })` boilerplate
 * so individual route files can stay focused on their domain logic.
 */

export function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function methodNotAllowed(): Response {
  return new Response("method not allowed", { status: 405 });
}
