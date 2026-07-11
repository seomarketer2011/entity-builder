import { randomBytes } from "node:crypto";
import { buildAuthUrl } from "@entity-builder/gsc";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const url = new URL(request.url);
  const organisationId = url.searchParams.get("org");
  const campaignId = url.searchParams.get("campaign");
  if (!organisationId || !campaignId) {
    return NextResponse.json({ error: "org and campaign are required" }, { status: 400 });
  }

  // Confirm membership before starting the flow (RLS-backed check).
  const { data: org } = await supabase
    .from("organisations")
    .select("id")
    .eq("id", organisationId)
    .single();
  if (!org) return NextResponse.json({ error: "not a member" }, { status: 403 });

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    return NextResponse.json(
      { error: "Google OAuth is not configured (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_REDIRECT_URI)" },
      { status: 500 },
    );
  }

  const state = randomBytes(16).toString("hex");
  const response = NextResponse.redirect(buildAuthUrl({ clientId, redirectUri }, state));
  response.cookies.set(
    "gsc_oauth_state",
    JSON.stringify({ state, organisationId, campaignId }),
    { httpOnly: true, secure: true, sameSite: "lax", maxAge: 600, path: "/api/google" },
  );
  return response;
}
