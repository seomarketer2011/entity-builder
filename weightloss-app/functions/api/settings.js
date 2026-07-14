// /api/settings — get or update the goal + profile (single row).

export async function onRequestGet({ env }) {
  const row = await env.DB.prepare(
    "SELECT start_date, start_weight_kg, goal_weight_kg, goal_date, height_cm FROM settings WHERE id = 1"
  ).first();
  return json(row || {});
}

export async function onRequestPut({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }

  const startDate = optDate(body.start_date);
  const goalDate = optDate(body.goal_date);
  const startWeight = optNum(body.start_weight_kg);
  const goalWeight = optNum(body.goal_weight_kg);
  const height = optNum(body.height_cm);

  if (startDate === INVALID || goalDate === INVALID) {
    return json({ error: "Dates must be YYYY-MM-DD." }, 400);
  }
  if (startWeight === INVALID || goalWeight === INVALID || height === INVALID) {
    return json({ error: "Weights/height must be positive numbers." }, 400);
  }

  await env.DB.prepare(
    `UPDATE settings
       SET start_date = ?, start_weight_kg = ?, goal_weight_kg = ?, goal_date = ?, height_cm = ?
     WHERE id = 1`
  )
    .bind(startDate, startWeight, goalWeight, goalDate, height)
    .run();

  return json({ ok: true });
}

const INVALID = Symbol("invalid");

function optDate(v) {
  if (v === undefined || v === null || v === "") return null;
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : INVALID;
}

function optNum(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 && n < 1000 ? n : INVALID;
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}
