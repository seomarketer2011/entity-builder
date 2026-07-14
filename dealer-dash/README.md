# Dealer Dash

An original maze-chase arcade game (Pac-Man-style genre, **not** a clone —
own maze, own art, own AI). Grab all the cash, dodge the dealers, grab a
police badge to bust them.

- **Live:** https://dealer-dash.pages.dev
- Single self-contained `public/index.html` — no backend, no build, no CDN deps.
- Deployed as a static Cloudflare Pages project.

## How to play

- **Desktop:** Arrow keys or WASD. Space/Enter to start or restart.
- **Mobile:** Swipe on the board, or use the on-screen D-pad.
- Eat every 💵 (cash) to clear the level.
- 🕴️ dealers chase you — four of them, each with different behaviour
  (direct chaser, ambusher, flanker, and a wanderer that backs off when far).
- Grab a 🛡️ **badge** and dealers panic (😱) — bust them for escalating
  points (200 → 400 → 800 → 1600). Busted dealers (👀) run back to their den.
- 3 lives. Each level regenerates a fresh maze and speeds up.

## Design notes

- The maze is generated at runtime with a **recursive-backtracker** (spanning
  tree = guaranteed fully connected), then a few extra walls are opened to add
  loops for better chases, plus a central den and a horizontal wrap tunnel.
  Validated over 3000 generations: every pellet is always reachable.
- Movement is grid-based with smooth interpolation between tiles; enemies use
  target-tile pathfinding (greedy toward a per-role target, random when
  frightened).

## Deploy

```bash
export CLOUDFLARE_ACCOUNT_ID=<account id>
wrangler pages deploy public --project-name=dealer-dash
```
