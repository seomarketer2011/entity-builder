# Security

## Tenancy

- Row Level Security enabled on every tenant-scoped table.
- Policies restrict by `organisation_id` via the authenticated user's
  membership; campaign-level restriction where applicable.
- The Supabase service-role key bypasses RLS: backend only (worker, server
  API routes), never in browser bundles, never in logs.
- Every hand-written query in `packages/database` takes tenant context
  explicitly; no query helper may default to "all rows".

## Credentials

- `.env.example` documents variable names only.
- Local dev: `.env.local` (gitignored). CI: GitHub Secrets. Production:
  hosting secret store.
- Google refresh tokens encrypted at rest (AES-256-GCM with
  `TOKEN_ENCRYPTION_KEY`); decrypted only in the worker at call time.
- No credentials in chat, commits, issues, or fixtures. CI runs secret
  scanning on every PR.

## LLM boundaries

LLMs may: extract candidate entities/relationships, cluster queries, draft
briefs, explain scores.
LLMs may NOT: decide business capabilities, confirm regulations apply,
approve entities/relationships, publish anything, or compute opportunity
scores. Those pass through rules, evidence, and human approval.

## Operational

- Migrations reviewed for destructive operations before merge.
- Audit log for approvals/rejections (who approved which entity, when).
- Backups: point-in-time recovery on production database.
- Role-based permissions (Phase 6): owner / editor / viewer per campaign.
