// Passcode gate for every /api/* route.
// The passcode is stored as the Pages secret APP_PASSCODE.
// The client sends it in the `x-passcode` header on every request.
export async function onRequest(context) {
  const { request, env, next } = context;

  // Allow CORS pre-flight through without a passcode.
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204 });
  }

  const expected = env.APP_PASSCODE;
  // If no passcode is configured on the server, fail closed.
  if (!expected) {
    return json({ error: "Server not configured (missing APP_PASSCODE)." }, 500);
  }

  const provided = request.headers.get("x-passcode") || "";
  if (provided !== expected) {
    return json({ error: "Wrong passcode." }, 401);
  }

  return next();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
