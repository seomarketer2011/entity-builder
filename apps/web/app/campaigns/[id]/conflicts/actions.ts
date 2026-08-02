"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";

/**
 * Acknowledging a conflict records that the operator has seen it. It
 * deliberately does NOT change the measured status — the lifecycle engine
 * owns that, based on data alone. This only silences the "new" highlight.
 */
export async function acknowledgeConflict(formData: FormData): Promise<void> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const conflictId = String(formData.get("conflictId") ?? "");
  const returnTo = String(formData.get("returnTo") ?? "");
  if (!campaignId || !conflictId) return;

  const { supabase, user } = await requireUser();
  if (!user) redirect("/login");

  // RLS restricts this to conflicts in the caller's organisation.
  await supabase
    .from("query_conflicts")
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: user.id })
    .eq("id", conflictId);

  revalidatePath(`/campaigns/${campaignId}/conflicts`);
  redirect(returnTo || `/campaigns/${campaignId}/conflicts`);
}
