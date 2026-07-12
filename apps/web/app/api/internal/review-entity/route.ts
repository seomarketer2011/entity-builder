import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Approve/reject entities in the shared master graph. Shared-graph writes
 * go through the service role by design; this route gates them behind a
 * signed-in reviewer and records who decided (rule 3: humans approve).
 * V1 note (docs/ENTITY_SYSTEM.md): any authenticated user may review —
 * fine while the platform is single-operator; RBAC comes in Phase 6.
 */
export async function POST(request: Request) {
  const session = await createClient();
  const {
    data: { user },
  } = await session.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as {
    entityIds?: string[];
    decision?: string;
  };
  const decision = body.decision;
  const entityIds = body.entityIds ?? [];
  if ((decision !== "approved" && decision !== "rejected") || entityIds.length === 0) {
    return NextResponse.json({ error: "decision and entityIds required" }, { status: 400 });
  }
  if (entityIds.length > 500) {
    return NextResponse.json({ error: "too many entities in one call" }, { status: 400 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const db = createSupabaseClient(url, key, { auth: { persistSession: false } });

  const { data, error } = await db
    .from("entities")
    .update({
      status: decision,
      reviewed_by: user.id,
      reviewed_at: new Date().toISOString(),
    })
    .in("id", entityIds)
    .select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Relationships whose both ends are approved get promoted alongside.
  if (decision === "approved") {
    await db
      .from("entity_relationships")
      .update({ review_status: "approved", reviewed_by: user.id, reviewed_at: new Date().toISOString() })
      .eq("review_status", "proposed")
      .in("subject_entity_id", entityIds)
      .in("object_entity_id", entityIds);
  }

  return NextResponse.json({ updated: data?.length ?? 0, decision });
}
