-- 0008: enable RLS on every remaining public table.
-- Shared master-graph tables get authenticated read access (writes go
-- through the service role + review workflow). Child tables inherit
-- tenant scoping from their parents.

-- Shared industry masters: readable by any signed-in user.
alter table industries enable row level security;
alter table services enable row level security;
alter table customer_industries enable row level security;
alter table locations enable row level security;
alter table entities enable row level security;
alter table entity_aliases enable row level security;
alter table entity_relationships enable row level security;
alter table entity_sources enable row level security;
alter table entity_evidence enable row level security;

create policy industries_read on industries for select using (auth.uid() is not null);
create policy services_read on services for select using (auth.uid() is not null);
create policy customer_industries_read on customer_industries for select using (auth.uid() is not null);
create policy locations_read on locations for select using (auth.uid() is not null);
create policy entities_read on entities for select using (auth.uid() is not null);
create policy entity_aliases_read on entity_aliases for select using (auth.uid() is not null);
create policy entity_relationships_read on entity_relationships for select using (auth.uid() is not null);
create policy entity_sources_read on entity_sources for select using (auth.uid() is not null);
create policy entity_evidence_read on entity_evidence for select using (auth.uid() is not null);

-- Tenant-scoped child tables: scope via their parent row.
alter table query_cluster_members enable row level security;
create policy cluster_members_by_org on query_cluster_members for select
  using (exists (select 1 from query_clusters c
                 where c.id = cluster_id and is_org_member(c.organisation_id)));

alter table page_intents enable row level security;
create policy page_intents_by_org on page_intents for select
  using (exists (select 1 from pages p
                 where p.id = page_id and is_org_member(p.organisation_id)));

alter table page_entities enable row level security;
create policy page_entities_by_org on page_entities for select
  using (exists (select 1 from pages p
                 where p.id = page_id and is_org_member(p.organisation_id)));

alter table page_manifest_versions enable row level security;
create policy manifest_versions_by_org on page_manifest_versions for select
  using (exists (select 1 from page_manifests m
                 where m.id = manifest_id and is_org_member(m.organisation_id)));

alter table page_evidence enable row level security;
create policy page_evidence_by_org on page_evidence for select
  using (exists (select 1 from pages p
                 where p.id = page_id and is_org_member(p.organisation_id)));

alter table opportunity_evidence enable row level security;
create policy opp_evidence_by_org on opportunity_evidence for select
  using (exists (select 1 from opportunities o
                 where o.id = opportunity_id and is_org_member(o.organisation_id)));

alter table opportunity_scores enable row level security;
create policy opp_scores_by_org on opportunity_scores for select
  using (exists (select 1 from opportunities o
                 where o.id = opportunity_id and is_org_member(o.organisation_id)));

alter table opportunity_reviews enable row level security;
create policy opp_reviews_by_org on opportunity_reviews for select
  using (exists (select 1 from opportunities o
                 where o.id = opportunity_id and is_org_member(o.organisation_id)));

alter table opportunity_outcomes enable row level security;
create policy opp_outcomes_by_org on opportunity_outcomes for select
  using (exists (select 1 from opportunities o
                 where o.id = opportunity_id and is_org_member(o.organisation_id)));

-- network_sites had RLS enabled in 0001 but no policy.
create policy network_sites_by_org on network_sites for select
  using (exists (select 1 from networks n
                 where n.id = network_id and is_org_member(n.organisation_id)));

-- gsc_daily_query_page needs no write policies: only the worker (service
-- role, bypasses RLS) writes facts. Same for the anonymised table.
