"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

async function callInternal(path: string, body?: unknown): Promise<Response> {
  const headerList = await headers();
  const host = headerList.get("host");
  return fetch(`https://${host}${path}`, {
    method: "POST",
    headers: {
      cookie: headerList.get("cookie") ?? "",
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}

/** Run discovery. SERP mining is opt-in because it costs money per run. */
export async function runDiscovery(formData: FormData): Promise<void> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  const industry = String(formData.get("industry") ?? "");
  const useSerp = String(formData.get("serp") ?? "") === "1";

  const params = new URLSearchParams({ campaign: campaignId });
  if (siteId) params.set("site", siteId);
  // Explicit: coverage is judged against this industry's graph and approved
  // candidates are created in it, so it is never inferred.
  if (industry) params.set("industry", industry);
  if (useSerp) params.set("serp", "1");

  const response = await callInternal(`/api/internal/discover-entities?${params.toString()}`);
  const body = (await response.json().catch(() => ({}))) as {
    discovered?: Array<{
      site: string;
      gscCandidates?: number;
      serpCandidates?: number;
      serpCostUsd?: number;
      notes?: string[];
      error?: string;
    }>;
    error?: string;
  };

  const target =
    `/campaigns/${campaignId}/discovery?site=${siteId}` +
    (industry ? `&industry=${encodeURIComponent(industry)}` : "");
  if (!response.ok) {
    redirect(`${target}&error=${encodeURIComponent(body.error ?? "discovery failed")}`);
  }

  const summary = (body.discovered ?? [])
    .map((d) => {
      if (d.error) return `${d.site}: ${d.error}`;
      const parts = [`${d.gscCandidates ?? 0} from demand`];
      if (useSerp) parts.push(`${d.serpCandidates ?? 0} from competitors`);
      if (d.serpCostUsd) parts.push(`$${d.serpCostUsd.toFixed(3)} spent`);
      const notes = d.notes?.length ? ` (${d.notes.join("; ")})` : "";
      return `${d.site}: ${parts.join(", ")}${notes}`;
    })
    .join(" · ");

  redirect(`${target}&notice=${encodeURIComponent(summary || "No sites analysed")}`);
}

/** Approve or reject candidates. Never auto-applies — always a click. */
export async function reviewCandidates(formData: FormData): Promise<void> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const siteId = String(formData.get("siteId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const industry = String(formData.get("industry") ?? "");
  const candidateIds = String(formData.get("candidateIds") ?? "")
    .split(",")
    .filter(Boolean);

  const target =
    `/campaigns/${campaignId}/discovery?site=${siteId}` +
    (industry ? `&industry=${encodeURIComponent(industry)}` : "");
  if (!campaignId || candidateIds.length === 0) redirect(target);

  // Per-row reviewer edits, when the form carried them.
  const overrides: Record<string, { name?: string; parentEntityId?: string; predicate?: string }> =
    {};
  for (const candidateId of candidateIds) {
    const name = formData.get(`name-${candidateId}`);
    const parent = formData.get(`parent-${candidateId}`);
    const predicate = formData.get(`predicate-${candidateId}`);
    const entry: { name?: string; parentEntityId?: string; predicate?: string } = {};
    if (typeof name === "string" && name.trim().length > 0) entry.name = name.trim();
    if (typeof parent === "string" && parent.length > 0) entry.parentEntityId = parent;
    if (typeof predicate === "string" && predicate.length > 0) entry.predicate = predicate;
    if (Object.keys(entry).length > 0) overrides[candidateId] = entry;
  }

  const response = await callInternal("/api/internal/review-candidate", {
    decision,
    candidateIds,
    overrides,
  });
  const body = (await response.json().catch(() => ({}))) as {
    updated?: number;
    blocked?: Array<{ name: string; reason: string }>;
    error?: string;
  };

  if (!response.ok) {
    redirect(`${target}&error=${encodeURIComponent(body.error ?? "review failed")}`);
  }

  const blocked = body.blocked?.length
    ? ` · ${body.blocked.length} blocked: ${body.blocked.map((b) => `${b.name} (${b.reason})`).join("; ")}`
    : "";
  redirect(
    `${target}&notice=${encodeURIComponent(`${body.updated ?? 0} candidates ${decision}${blocked}`)}`,
  );
}
