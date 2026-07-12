import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import locksmith from "@/../../fixtures/entities/locksmith-services.json";
import fireProtection from "@/../../fixtures/entities/fire-protection.json";

/**
 * Imports a curated industry template (fixtures/entities/*) into the
 * shared master graph. Entities land as status='proposed' — a human
 * approves them in the Entities view (non-negotiable rule 3). Idempotent:
 * re-import upserts by canonical name and never downgrades approvals.
 * Caller must be signed in (or the cron bearer token).
 */

interface TemplateEntity {
  canonicalName: string;
  entityType: string;
  aliases: string[];
  children?: TemplateEntity[];
}

interface Template {
  industry: { slug: string; name: string };
  entities: TemplateEntity[];
  relationships: Array<{ subject: string; predicate: string; object: string }>;
}

const TEMPLATES: Record<string, Template> = {
  "locksmith-services": locksmith as Template,
  "fire-protection": fireProtection as unknown as Template,
};

export async function POST(request: Request) {
  const expected = process.env.SYNC_TOKEN;
  const isCron = !!expected && request.headers.get("authorization") === `Bearer ${expected}`;
  if (!isCron) {
    const session = await createClient();
    const {
      data: { user },
    } = await session.auth.getUser();
    if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ error: "not configured" }, { status: 503 });
  const db = createSupabaseClient(url, key, { auth: { persistSession: false } });

  const slug = new URL(request.url).searchParams.get("industry") ?? "locksmith-services";
  const template = TEMPLATES[slug];
  if (!template) {
    return NextResponse.json(
      { error: `unknown industry template: ${slug}`, available: Object.keys(TEMPLATES) },
      { status: 400 },
    );
  }

  const { data: industry, error: industryError } = await db
    .from("industries")
    .upsert(
      { slug: template.industry.slug, name: template.industry.name },
      { onConflict: "slug" },
    )
    .select("id")
    .single();
  if (industryError || !industry) {
    return NextResponse.json({ error: industryError?.message }, { status: 500 });
  }

  let entityCount = 0;
  let aliasCount = 0;
  const idByName = new Map<string, string>();

  async function importEntity(e: TemplateEntity, parentId: string | null): Promise<void> {
    const { data: existing } = await db
      .from("entities")
      .select("id, status")
      .eq("industry_id", industry!.id)
      .eq("canonical_name", e.canonicalName)
      .maybeSingle();

    let entityId: string;
    if (existing) {
      entityId = existing.id; // never downgrade an approved entity
    } else {
      const { data: created, error: createError } = await db
        .from("entities")
        .insert({
          industry_id: industry!.id,
          canonical_name: e.canonicalName,
          entity_type: e.entityType,
          parent_entity_id: parentId,
          status: "proposed",
        })
        .select("id")
        .single();
      if (createError || !created) throw new Error(createError?.message ?? "entity insert failed");
      entityId = created.id;
      entityCount++;
    }
    idByName.set(e.canonicalName, entityId);

    for (const alias of e.aliases ?? []) {
      const { error: aliasError } = await db
        .from("entity_aliases")
        .upsert({ entity_id: entityId, alias }, { onConflict: "entity_id,alias" });
      if (!aliasError) aliasCount++;
    }
    for (const child of e.children ?? []) {
      await importEntity(child, entityId);
    }
  }

  try {
    for (const e of template.entities) await importEntity(e, null);

    let relationshipCount = 0;
    for (const r of template.relationships) {
      const subjectId = idByName.get(r.subject);
      const objectId = idByName.get(r.object);
      if (!subjectId || !objectId) continue;
      // NULL location_id defeats ON CONFLICT (nulls never match), so
      // check-then-insert keeps re-imports idempotent.
      const { data: existingRel } = await db
        .from("entity_relationships")
        .select("id")
        .eq("subject_entity_id", subjectId)
        .eq("predicate", r.predicate)
        .eq("object_entity_id", objectId)
        .eq("industry_id", industry.id)
        .is("location_id", null)
        .maybeSingle();
      if (!existingRel) {
        const { error: relError } = await db.from("entity_relationships").insert({
          subject_entity_id: subjectId,
          predicate: r.predicate,
          object_entity_id: objectId,
          industry_id: industry.id,
          review_status: "proposed",
        });
        if (!relError) relationshipCount++;
      }
    }

    return NextResponse.json({
      industry: template.industry.slug,
      newEntities: entityCount,
      aliases: aliasCount,
      relationships: relationshipCount,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "import failed" },
      { status: 500 },
    );
  }
}
