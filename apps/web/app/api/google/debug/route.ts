import {
  decryptToken,
  listProperties,
  refreshAccessToken,
  type FetchLike,
} from "@entity-builder/gsc";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * Support diagnostic: for the signed-in user's organisation, compare what
 * Google's Sites API returns right now vs what is stored. Read-only;
 * RLS scopes everything to the caller's own organisations.
 */
export async function GET(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "sign in first" }, { status: 401 });

  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const encryptionKey = process.env.TOKEN_ENCRYPTION_KEY;
  if (!clientId || !clientSecret || !encryptionKey) {
    return NextResponse.json({ error: "OAuth env incomplete" }, { status: 500 });
  }

  const { data: connections, error: connError } = await supabase
    .from("google_connections")
    .select("id, organisation_id, google_account_email, encrypted_refresh_token, token_nonce, created_at")
    .is("revoked_at", null)
    .order("created_at", { ascending: false });
  if (connError) return NextResponse.json({ error: connError.message }, { status: 500 });
  if (!connections?.length) {
    return NextResponse.json({ error: "no active Google connections found" }, { status: 404 });
  }

  const fetchImpl = fetch as unknown as FetchLike;
  const report = [];
  for (const conn of connections) {
    const { data: stored } = await supabase
      .from("gsc_properties")
      .select("property_uri, permission_level, site_id")
      .eq("connection_id", conn.id)
      .order("property_uri");
    try {
      // PostgREST returns bytea as \x-prefixed hex strings.
      const cipherHex = String(conn.encrypted_refresh_token).replace(/^\\x/, "");
      const nonceHex = String(conn.token_nonce).replace(/^\\x/, "");
      const refreshToken = decryptToken(
        {
          ciphertext: Buffer.from(cipherHex, "hex"),
          nonce: Buffer.from(nonceHex, "hex"),
        },
        encryptionKey,
      );
      const grant = await refreshAccessToken(fetchImpl, { clientId, clientSecret }, refreshToken);
      const live = await listProperties(fetchImpl, grant.accessToken);
      report.push({
        connection: conn.id,
        googleAccount: conn.google_account_email,
        connectedAt: conn.created_at,
        liveFromGoogleNow: {
          count: live.length,
          properties: live.map((p) => `${p.siteUrl} [${p.permissionLevel}]`),
        },
        storedInDatabase: {
          count: stored?.length ?? 0,
          properties: (stored ?? []).map(
            (p) => `${p.property_uri} [${p.permission_level ?? "?"}]${p.site_id ? " → linked" : ""}`,
          ),
        },
      });
    } catch (error) {
      report.push({
        connection: conn.id,
        googleAccount: conn.google_account_email,
        error: error instanceof Error ? error.message : String(error),
        storedInDatabase: { count: stored?.length ?? 0 },
      });
    }
  }

  return NextResponse.json({ connections: report }, { status: 200 });
}
