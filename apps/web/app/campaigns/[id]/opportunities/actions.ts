"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";

export async function runAnalysis(formData: FormData): Promise<void> {
  const campaignId = String(formData.get("campaignId") ?? "");
  if (!campaignId) return;
  // Call the analysis route in-process, forwarding the user's cookies so
  // the membership check applies.
  const headerList = await headers();
  const host = headerList.get("host");
  const response = await fetch(`https://${host}/api/internal/analyze?campaign=${campaignId}`, {
    method: "POST",
    headers: { cookie: headerList.get("cookie") ?? "" },
  });
  const body = (await response.json().catch(() => ({}))) as {
    analysed?: Array<{ findings?: number }>;
    error?: string;
  };
  if (!response.ok) {
    redirect(
      `/campaigns/${campaignId}/opportunities?error=${encodeURIComponent(body.error ?? "analysis failed")}`,
    );
  }
  const total = (body.analysed ?? []).reduce((sum, r) => sum + (r.findings ?? 0), 0);
  redirect(
    `/campaigns/${campaignId}/opportunities?notice=${encodeURIComponent(
      `Analysis complete — ${total} open opportunit${total === 1 ? "y" : "ies"}`,
    )}`,
  );
}

export async function reviewOpportunity(formData: FormData): Promise<void> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const opportunityId = String(formData.get("opportunityId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  if (!campaignId || !opportunityId || (decision !== "accepted" && decision !== "dismissed")) return;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { error } = await supabase
    .from("opportunities")
    .update({ status: decision })
    .eq("id", opportunityId);
  if (error) {
    redirect(`/campaigns/${campaignId}/opportunities?error=${encodeURIComponent(error.message)}`);
  }
  await supabase.from("opportunity_reviews").insert({
    opportunity_id: opportunityId,
    reviewer_id: user?.id ?? null,
    decision,
  });
  // Redirect for a guaranteed fresh render on the Workers runtime; the
  // feed is priority-ordered so the next card to action is at the top.
  redirect(`/campaigns/${campaignId}/opportunities`);
}
