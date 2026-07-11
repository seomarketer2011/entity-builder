import {
  encryptToken,
  exchangeCode,
  fetchGoogleAccountEmail,
  listProperties,
  type FetchLike,
} from "@entity-builder/gsc";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";

function fail(request: Request, campaignId: string | undefined, message: string) {
  const target = campaignId ? `/campaigns/${campaignId}` : "/";
  return NextResponse.redirect(
    new URL(`${target}?error=${encodeURIComponent(message)}`, request.url),
  );
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.redirect(new URL("/login", request.url));

  const cookieStore = await cookies();
  const stateCookie = cookieStore.get("gsc_oauth_state")?.value;
  let saved: { state: string; organisationId: string; campaignId: string } | undefined;
  try {
    saved = stateCookie ? JSON.parse(stateCookie) : undefined;
  } catch {
    saved = undefined;
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (!saved || !state || state !== saved.state) {
    return fail(request, saved?.campaignId, "OAuth state mismatch — try connecting again");
  }
  if (!code) {
    return fail(request, saved.campaignId, url.searchParams.get("error") ?? "Google returned no code");
  }

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!clientId || !clientSecret || !redirectUri || !encryptionKey) {
    return fail(request, saved.campaignId, "Google OAuth is not fully configured");
  }

  try {
    const fetchImpl = fetch as unknown as FetchLike;
    const grant = await exchangeCode(fetchImpl, { clientId, clientSecret, redirectUri }, code);
    if (!grant.refreshToken) {
      return fail(
        request,
        saved.campaignId,
        "Google did not return a refresh token — remove the app's access at myaccount.google.com/permissions and reconnect",
      );
    }

    const encrypted = encryptToken(grant.refreshToken, encryptionKey);

    // The Google account's own email — NOT the app user's login email.
    const googleEmail = await fetchGoogleAccountEmail(fetchImpl, grant.accessToken);

    // Writes go through the user's session client, so RLS enforces that the
    // user is a member of the organisation they're connecting for.
    const { data: connection, error: connError } = await supabase
      .from("google_connections")
      .insert({
        organisation_id: saved.organisationId,
        google_account_email: googleEmail ?? "unknown",
        encrypted_refresh_token: `\\x${encrypted.ciphertext.toString("hex")}`,
        token_nonce: `\\x${encrypted.nonce.toString("hex")}`,
      })
      .select("id")
      .single();
    if (connError || !connection) {
      return fail(request, saved.campaignId, connError?.message ?? "could not store connection");
    }

    const properties = await listProperties(fetchImpl, grant.accessToken);
    if (properties.length > 0) {
      const { error: propsError } = await supabase.from("gsc_properties").upsert(
        properties.map((p) => ({
          organisation_id: saved.organisationId,
          connection_id: connection.id,
          property_uri: p.siteUrl,
          permission_level: p.permissionLevel,
        })),
        { onConflict: "connection_id,property_uri" },
      );
      if (propsError) {
        return fail(request, saved.campaignId, propsError.message);
      }
    }

    const response = NextResponse.redirect(
      new URL(`/campaigns/${saved.campaignId}`, request.url),
    );
    response.cookies.delete("gsc_oauth_state");
    return response;
  } catch (error) {
    const message = error instanceof Error ? error.message : "connection failed";
    return fail(request, saved.campaignId, message);
  }
}
