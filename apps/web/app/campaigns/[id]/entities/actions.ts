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

export async function importIndustry(formData: FormData): Promise<void> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const industry = String(formData.get("industry") ?? "locksmith-services");
  const response = await callInternal(`/api/internal/import-industry?industry=${industry}`);
  const body = (await response.json().catch(() => ({}))) as {
    newEntities?: number;
    error?: string;
  };
  const target = `/campaigns/${campaignId}/entities?industry=${industry}`;
  if (!response.ok) redirect(`${target}&error=${encodeURIComponent(body.error ?? "import failed")}`);
  redirect(
    `${target}&notice=${encodeURIComponent(
      `Imported — ${body.newEntities ?? 0} new entities proposed for review`,
    )}`,
  );
}

export async function reviewEntities(formData: FormData): Promise<void> {
  const campaignId = String(formData.get("campaignId") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const entityIds = String(formData.get("entityIds") ?? "")
    .split(",")
    .filter(Boolean);
  if (!campaignId || entityIds.length === 0) return;

  const response = await callInternal("/api/internal/review-entity", { decision, entityIds });
  const body = (await response.json().catch(() => ({}))) as { updated?: number; error?: string };
  const target = `/campaigns/${campaignId}/entities`;
  if (!response.ok) redirect(`${target}?error=${encodeURIComponent(body.error ?? "review failed")}`);
  redirect(`${target}?notice=${encodeURIComponent(`${body.updated ?? 0} entities ${decision}`)}`);
}
