-- 0009: org members can record opportunity reviews (accept/dismiss audit)

create policy opp_reviews_insert_by_org on opportunity_reviews for insert
  with check (
    exists (
      select 1 from opportunities o
      where o.id = opportunity_id and is_org_member(o.organisation_id)
    )
  );
