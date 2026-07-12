import { notFound, redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { addSite, deleteSite, linkPropertyToSite, queueSyncJob } from "./actions";

export const dynamic = "force-dynamic";

export default async function CampaignPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; notice?: string; q?: string; confirmDelete?: string }>;
}) {
  const { id } = await params;
  const { error, notice, q, confirmDelete } = await searchParams;
  const { supabase, user } = await requireUser();
  if (!user) redirect("/login");

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, name, organisation_id, sites(id, name, domain, base_url)")
    .eq("id", id)
    .single();
  if (!campaign) notFound();

  const { data: properties } = await supabase
    .from("gsc_properties")
    .select("id, property_uri, permission_level, site_id")
    .eq("organisation_id", campaign.organisation_id)
    .order("property_uri");

  const propertyIds = (properties ?? []).map((p) => p.id);
  const { data: jobs } = propertyIds.length
    ? await supabase
        .from("gsc_sync_jobs")
        .select("id, property_id, kind, status, date_from, date_to, rows_imported, error, created_at")
        .in("property_id", propertyIds)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: [] };

  const propertyUri = new Map((properties ?? []).map((p) => [p.id, p.property_uri]));

  return (
    <div>
      <h1>
        {campaign.name}{" "}
        <a
          className="button"
          style={{ float: "right" }}
          href={`/campaigns/${id}/opportunities`}
        >
          Opportunities →
        </a>
      </h1>
      {error ? <p className="error">{error}</p> : null}
      {notice ? <p style={{ color: "#15803d" }}>{notice}</p> : null}

      <h2>Sites</h2>
      <div className="card">
        {campaign.sites.length === 0 ? (
          <p className="muted">No sites yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Domain</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {campaign.sites.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}</td>
                  <td>{s.domain}</td>
                  <td style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
                    <a className="button secondary" href={`/campaigns/${id}/explorer?site=${s.id}`}>
                      Explorer
                    </a>
                    {confirmDelete === s.id ? (
                      <form action={deleteSite} style={{ margin: 0, display: "inline-flex", gap: "0.4rem", alignItems: "center" }}>
                        <input type="hidden" name="campaignId" value={id} />
                        <input type="hidden" name="siteId" value={s.id} />
                        <span className="error">Deletes this site AND its imported data.</span>
                        <button style={{ background: "#b91c1c", borderColor: "#b91c1c" }}>
                          Yes, delete
                        </button>
                        <a className="button secondary" href={`/campaigns/${id}`}>
                          Cancel
                        </a>
                      </form>
                    ) : (
                      <a
                        className="button secondary"
                        style={{ color: "#b91c1c" }}
                        href={`/campaigns/${id}?confirmDelete=${s.id}`}
                      >
                        Delete
                      </a>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <form className="inline" action={addSite}>
          <input type="hidden" name="campaignId" value={campaign.id} />
          <input type="hidden" name="organisationId" value={campaign.organisation_id} />
          <input name="name" placeholder="Site name" required />
          <input name="baseUrl" placeholder="example.com or https://example.com" required />
          <button>Add site</button>
        </form>
      </div>

      <h2>Google Search Console</h2>
      <div className="card">
        <p>
          <a
            className="button"
            href={`/api/google/connect?org=${campaign.organisation_id}&campaign=${campaign.id}`}
          >
            Connect Google account
          </a>{" "}
          <span className="muted">
            Read-only Search Console access; refresh tokens are encrypted at rest.
          </span>
        </p>
        <form className="inline" method="get">
          <input
            name="q"
            placeholder="Filter properties (e.g. jdselectricians)"
            defaultValue={q ?? ""}
            size={40}
          />
          <button className="secondary">Filter</button>
          {q ? (
            <a className="button secondary" href={`/campaigns/${id}`}>
              Clear
            </a>
          ) : null}
        </form>
        {(properties ?? []).length === 0 ? (
          <p className="muted">No properties discovered yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Property</th>
                <th>Permission</th>
                <th>Linked site</th>
                <th>Sync</th>
              </tr>
            </thead>
            <tbody>
              {(properties ?? [])
                .filter((p) => !q || p.property_uri.toLowerCase().includes(q.toLowerCase()))
                .map((p) => (
                <tr key={p.id}>
                  <td>{p.property_uri}</td>
                  <td>{p.permission_level ?? "—"}</td>
                  <td>
                    <form className="inline" action={linkPropertyToSite} style={{ margin: 0 }}>
                      <input type="hidden" name="propertyId" value={p.id} />
                      <input type="hidden" name="campaignId" value={campaign.id} />
                      <select name="siteId" defaultValue={p.site_id ?? ""}>
                        <option value="">— unlinked —</option>
                        {campaign.sites.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                      <button className="secondary">Link</button>
                    </form>
                  </td>
                  <td>
                    <form className="inline" action={queueSyncJob} style={{ margin: 0 }}>
                      <input type="hidden" name="propertyId" value={p.id} />
                      <input type="hidden" name="organisationId" value={campaign.organisation_id} />
                      <input type="hidden" name="campaignId" value={campaign.id} />
                      <select name="kind" defaultValue="incremental">
                        <option value="backfill">Backfill (16 months)</option>
                        <option value="incremental">Incremental</option>
                      </select>
                      <button disabled={!p.site_id}>Queue</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <h2>Sync jobs</h2>
      <div className="card">
        {(jobs ?? []).length === 0 ? (
          <p className="muted">No sync jobs yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Property</th>
                <th>Kind</th>
                <th>Window</th>
                <th>Status</th>
                <th className="num">Rows</th>
                <th>Error</th>
              </tr>
            </thead>
            <tbody>
              {(jobs ?? []).map((j) => (
                <tr key={j.id}>
                  <td>{propertyUri.get(j.property_id) ?? j.property_id}</td>
                  <td>{j.kind}</td>
                  <td>
                    {j.date_from} → {j.date_to}
                  </td>
                  <td>
                    <span className={`badge ${j.status}`}>{j.status}</span>
                  </td>
                  <td className="num">{j.rows_imported}</td>
                  <td className="muted">{j.error ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
