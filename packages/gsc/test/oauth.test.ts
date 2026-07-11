import { describe, expect, it } from "vitest";
import {
  buildAuthUrl,
  exchangeCode,
  refreshAccessToken,
  type FetchLike,
} from "../src/oauth.js";

function fakeFetch(status: number, body: unknown): { fetch: FetchLike; calls: Array<{ url: string; body?: string }> } {
  const calls: Array<{ url: string; body?: string }> = [];
  const fetch: FetchLike = async (url, init) => {
    calls.push({ url, body: init?.body });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    };
  };
  return { fetch, calls };
}

const config = {
  clientId: "client-id",
  clientSecret: "client-secret",
  redirectUri: "https://app.example.com/api/google/callback",
};

describe("buildAuthUrl", () => {
  it("requests offline access with the read-only scope and state", () => {
    const url = new URL(buildAuthUrl(config, "state-xyz"));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("state")).toBe("state-xyz");
    expect(url.searchParams.get("scope")).toContain("webmasters.readonly");
  });
});

describe("exchangeCode", () => {
  it("posts the grant and maps the token response", async () => {
    const { fetch, calls } = fakeFetch(200, {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3599,
    });
    const grant = await exchangeCode(fetch, config, "the-code");
    expect(grant).toEqual({ accessToken: "at", refreshToken: "rt", expiresInSeconds: 3599 });
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0]!.body).toContain("grant_type=authorization_code");
    expect(calls[0]!.body).toContain("code=the-code");
  });

  it("throws on error without echoing credentials", async () => {
    const { fetch } = fakeFetch(400, { error: "invalid_grant" });
    await expect(exchangeCode(fetch, config, "bad")).rejects.toThrow(/400/);
    await expect(exchangeCode(fetch, config, "bad")).rejects.not.toThrow(/client-secret/);
  });
});

describe("refreshAccessToken", () => {
  it("uses the refresh_token grant", async () => {
    const { fetch, calls } = fakeFetch(200, { access_token: "at2", expires_in: 3599 });
    const grant = await refreshAccessToken(fetch, config, "rt");
    expect(grant.accessToken).toBe("at2");
    expect(calls[0]!.body).toContain("grant_type=refresh_token");
  });
});
