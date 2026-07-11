import { redirect } from "next/navigation";
import { requireUser } from "@/lib/supabase/server";
import { createCampaign, createOrganisation } from "./actions";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const { supabase, user } = await requireUser();
  if (!user) redirect("/login");

  const { data: organisations } = await supabase
    .from("organisations")
    .select("id, name, campaigns(id, name, country_code, sites(id))")
    .order("name");

  return (
    <div>
      <h1>Campaigns</h1>
      <p className="muted">Signed in as {user.email}</p>

      {(organisations ?? []).map((org) => (
        <div className="card" key={org.id}>
          <h2 style={{ marginTop: 0 }}>{org.name}</h2>
          {org.campaigns.length === 0 ? (
            <p className="muted">No campaigns yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Campaign</th>
                  <th>Country</th>
                  <th className="num">Sites</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {org.campaigns.map((c) => (
                  <tr key={c.id}>
                    <td>{c.name}</td>
                    <td>{c.country_code ?? "—"}</td>
                    <td className="num">{c.sites.length}</td>
                    <td>
                      <a className="button secondary" href={`/campaigns/${c.id}`}>
                        Open
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <form className="inline" action={createCampaign}>
            <input type="hidden" name="organisationId" value={org.id} />
            <input name="name" placeholder="New campaign name" required />
            <input name="countryCode" placeholder="Country (e.g. GB)" maxLength={2} size={12} />
            <button>Add campaign</button>
          </form>
        </div>
      ))}

      <div className="card">
        <h2 style={{ marginTop: 0 }}>New organisation</h2>
        <form className="inline" action={createOrganisation}>
          <input name="name" placeholder="Organisation name" required />
          <button>Create</button>
        </form>
      </div>
    </div>
  );
}
