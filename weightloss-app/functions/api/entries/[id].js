// /api/entries/:id — edit or delete a single weigh-in.

export async function onRequestPut({ request, env, params }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json({ error: "Bad id." }, 400);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const date = String(body.date || "").slice(0, 10);
  const weight = Number(body.weight_kg);
  const note = body.note ? String(body.note).slice(0, 500) : null;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json({ error: "date must be YYYY-MM-DD." }, 400);
  }
  if (!Number.isFinite(weight) || weight <= 0 || weight > 700) {
    return json({ error: "weight_kg must be a positive number (kg)." }, 400);
  }

  const res = await env.DB.prepare(
    "UPDATE entries SET date = ?, weight_kg = ?, note = ? WHERE id = ?"
  )
    .bind(date, weight, note, id)
    .run();

  if (res.meta.changes === 0) return json({ error: "Not found." }, 404);
  return json({ id, date, weight_kg: weight, note });
}

export async function onRequestDelete({ env, params }) {
  const id = Number(params.id);
  if (!Number.isInteger(id)) return json({ error: "Bad id." }, 400);

  const res = await env.DB.prepare("DELETE FROM entries WHERE id = ?")
    .bind(id)
    .run();

  if (res.meta.changes === 0) return json({ error: "Not found." }, 404);
  return json({ ok: true });
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
