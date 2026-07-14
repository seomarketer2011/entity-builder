# Weight Tracker (Cloudflare Pages + D1)

A simple, private, mobile-friendly weight-loss tracker.

- **Live:** https://my-weightloss.pages.dev
- **Enter weight in kg** — the app shows **kg · lbs · stones+lbs** (the UK way) everywhere.
- **Goal tracking:** set a start date/weight, goal weight, and target date; the app shows
  your **± change**, **% to goal**, an **on-track / behind** status vs your target date,
  and a **projected finish date** at your current rate.
- **Extras:** progress line chart, 7-day trend, BMI (if you add your height), edit/delete
  past weigh-ins.
- **Private:** protected by a passcode (stored server-side as the `APP_PASSCODE` secret).

## Architecture

| Piece | Tech |
|-------|------|
| Hosting | Cloudflare Pages (`*.pages.dev`) |
| Database | Cloudflare D1 (SQLite), binding `DB` |
| API | Pages Functions in `functions/api/` |
| Frontend | Single static `public/index.html` (no framework, no CDN) |
| Auth | Passcode in `x-passcode` header, checked by `functions/api/_middleware.js` |

### API

All routes require the `x-passcode` header.

- `GET  /api/entries` — list weigh-ins
- `POST /api/entries` — add `{date, weight_kg, note?}`
- `PUT  /api/entries/:id` — edit
- `DELETE /api/entries/:id` — delete
- `GET  /api/settings` — read goal/profile
- `PUT  /api/settings` — update goal/profile
- `POST /api/login` — passcode check (used by the unlock screen)

## Local development

```bash
cd weightloss-app
npm install
npm run schema:local     # create tables in the local D1
npm run dev              # http://localhost:8788  (add APP_PASSCODE to .dev.vars)
```

Create a `.dev.vars` file (git-ignored) for local runs:

```
APP_PASSCODE=564116
```

## Deploy

```bash
export CLOUDFLARE_ACCOUNT_ID=<account id>
npm run schema:remote                       # one-time: create tables in remote D1
npm run deploy                              # deploy to Cloudflare Pages
wrangler pages secret put APP_PASSCODE --project-name=my-weightloss   # set/change passcode
```

## Change the passcode

```bash
echo "NEWCODE" | wrangler pages secret put APP_PASSCODE --project-name=my-weightloss
```

Then re-enter it in the app (it's cached in your browser until you change it).

## Conversions

- 1 kg = 2.2046226218 lb
- 1 stone = 14 lb
- e.g. `82.5 kg → 181.9 lb → 12 st 13.9 lb`
