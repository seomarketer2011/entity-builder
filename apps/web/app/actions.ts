"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export async function createOrganisation(formData: FormData): Promise<void> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const supabase = await createClient();
  const { error } = await supabase.rpc("create_organisation", { org_name: name });
  if (error) redirect(`/?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/");
}

export async function createCampaign(formData: FormData): Promise<void> {
  const organisationId = String(formData.get("organisationId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  const countryCode =
    String(formData.get("countryCode") ?? "").trim().toUpperCase() || null;
  if (!organisationId || !name) return;
  const supabase = await createClient();
  const { error } = await supabase.from("campaigns").insert({
    organisation_id: organisationId,
    name,
    country_code: countryCode,
  });
  if (error) redirect(`/?error=${encodeURIComponent(error.message)}`);
  revalidatePath("/");
}
