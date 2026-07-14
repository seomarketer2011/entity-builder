# Dealer Dash

An original maze-chase arcade game (Pac-Man-style genre, **not** a clone —
own maze, own art, own AI). Grab all the cash, dodge the dealers, grab a
police badge to bust them.

- **Live:** https://dealer-dash.pages.dev
- Single self-contained `public/index.html` — no backend, no build, no CDN deps.
- Deployed as a static Cloudflare Pages project.

## Story & how to play

You play **Donny the Dealer**. He's holding; the addicts want to buy.

- **Desktop:** Arrow keys or WASD. Space/Enter to start or restart.
- **Mobile:** Swipe on the board, or use the on-screen D-pad.
- Collect the stash dots to clear the level — each one tops up your **STASH** bar
  and earns £10.
- Four **addicts** 🕴️ chase you, each with different behaviour (direct chaser,
  ambusher, flanker, and a wanderer that backs off when far). One of them wears
  a real photo sprite.
- When an addict catches you, you make a **£100 sale** and they wander off happy
  (😌) — *but only if you're holding*. Each sale drains your stash bar.
- Get caught with an **empty stash** and they mob you — you lose a life.
- Grab a **line** (the pulsing white icon) to send every addict into a **frenzy**
  (😱); you can shove through them for £75 each while it lasts.
- The maze is **braided** — no dead-ends, so you can never be blocked into a corner.
- 3 lives. Each level regenerates a fresh maze and speeds up.

## Custom faces

Enemy/player sprites can be real circular PNGs dropped into `public/` (e.g.
`lady.png`) and referenced via the `sprite` field on a role, or drawn as
cartoon avatars in canvas (see `drawDonny`).

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
