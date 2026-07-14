// If the request reaches here, the middleware already validated the passcode.
export function onRequestPost() {
  return new Response(JSON.stringify({ ok: true }), {
    headers: { "content-type": "application/json" },
  });
}
