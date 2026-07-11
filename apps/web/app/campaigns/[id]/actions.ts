"use server";

import {
  addMonths,
  BACKFILL_MONTHS,
  freshestSyncableDate,
  INCREMENTAL_REPULL_DAYS,
  addDays,
} from "@entity-builder/gsc";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function addSite(formData: FormData): Promise<void> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const organisationId = String(formData.get("organisationId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const baseUrlRaw = String(formData.get("baseUrl") ?? "").trim();
  if (!campaignId || !organisationId || !name || !baseUrlRaw) return;

  let domain: string;
  let baseUrl: string;
  try {
    // Accept bare domains ("example.com") as well as full URLs.
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(baseUrlRaw)
      ? baseUrlRaw
      : `https://${baseUrlRaw}`;
    const parsed = new URL(withScheme);
    if (!parsed.hostname.includes(".")) throw new Error("no dot");
    domain = parsed.hostname;
    baseUrl = parsed.origin;
  } catch {
    redirect(
      `/campaigns/${campaignId}?error=${encodeURIComponent(`"${baseUrlRaw}" is not a valid domain`)}`,
    );
  }

  const supabase = await createClient();
  const { error } = await supabase.from("sites").insert({
    campaign_id: campaignId,
    organisation_id: organisationId,
    name,
    domain,
    base_url: baseUrl,
  });
  if (error) redirect(`/campaigns/${campaignId}?error=${encodeURIComponent(error.message)}`);
  redirect(`/campaigns/${campaignId}?notice=${encodeURIComponent(`Site "${name}" added — now link its property below`)}`);
}

export async function linkPropertyToSite(formData: FormData): Promise<void> {
  const propertyId = String(formData.get("propertyId") ?? "");
  const campaignId = String(formData.get("campaignId") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  if (!propertyId || !campaignId) return;

  const supabase = await createClient();
  const { error } = await supabase
    .from("gsc_properties")
    .update({ site_id: siteId || null })
    .eq("id", propertyId);
  if (error) redirect(`/campaigns/${campaignId}?error=${encodeURIComponent(error.message)}`);
  redirect(
    `/campaigns/${campaignId}?notice=${encodeURIComponent(siteId ? "Property linked — you can now queue a sync" : "Property unlinked")}`,
  );
}

export async function queueSyncJob(formData: FormData): Promise<void> {
  const propertyId = String(formData.get("propertyId") ?? "");
  const organisationId = String(formData.get("organisationId") ?? "");
  const campaignId = String(formData.get("campaignId") ?? "");
  const kind = String(formData.get("kind") ?? "");
  if (!propertyId || !organisationId || (kind !== "backfill" && kind !== "incremental")) return;

  // Recorded window (the worker re-plans precisely at run time).
  const today = new Date().toISOString().slice(0, 10);
  const dateTo = freshestSyncableDate(today);
  const dateFrom =
    kind === "backfill"
      ? addMonths(dateTo, -BACKFILL_MONTHS)
      : addDays(dateTo, -(INCREMENTAL_REPULL_DAYS - 1));

  const supabase = await createClient();
  const { error } = await supabase.from("gsc_sync_jobs").insert({
    organisation_id: organisationId,
    property_id: propertyId,
    kind,
    status: "queued",
    date_from: dateFrom,
    date_to: dateTo,
  });
  if (error) redirect(`/campaigns/${campaignId}?error=${encodeURIComponent(error.message)}`);
  redirect(
    `/campaigns/${campaignId}?notice=${encodeURIComponent(`${kind} job queued — the worker will pick it up shortly`)}`,
  );
}
