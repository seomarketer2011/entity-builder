// /api/entries  — list all weigh-ins, or add a new one.

export async function onRequestGet({ env }) {
  const { results } = await env.DB.prepare(
    "SELECT id, date, weight_kg, note FROM entries ORDER BY date ASC, id ASC"
  ).all();
  return json(results || []);
}

export async function onRequestPost({ request, env }) {
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
    "INSERT INTO entries (date, weight_kg, note) VALUES (?, ?, ?)"
  )
    .bind(date, weight, note)
    .run();

  return json(
    { id: res.meta.last_row_id, date, weight_kg: weight, note },
    201
  );
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
