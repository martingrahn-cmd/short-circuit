# Short Circuit ⚡

**Route the current before it routes you.**

A circuit-lock arcade puzzle. Uncover conductors, swap them into a route
from IN to OUT — while the live current creeps up behind your fingers.
Born as the safecracking minigame in
[Manny the Mole](https://github.com/martingrahn-cmd/manny-the-mole),
now a game of its own.

## What's in it

- **The 24-lock campaign** — every lock is a fixed, designed board with a
  gold/silver/bronze medal time. Beat it, then beat your time.
- **The Daily Lock** — one board a day, seeded by the date, identical for
  every player in the world. Solve it daily to keep your streak alive;
  miss a day and the count starts over, but your best streak is remembered.
- **Wear** — a lock that beats you wears down: the current runs 20% slower
  every retry, up to roughly double. Persistence always gets you through;
  the medals only go to clean hands.
- **Welded conductors** — gold cells are fixed in place and must be on the
  route, so late boards are built between given anchors instead of freely.
- **Teaching lock** — the first lock anyone plays runs a crawling current.

Touch-first (tap to uncover, tap two conductors to swap), keyboard-friendly,
no download, no account.

## Files

| File | What it is |
|---|---|
| `index.html` | The page: shell markup + all CSS (the puzzle surface is lifted from Manny the Mole, battle-tested there) |
| `engine.js` | The puzzle engine, lifted intact from Manny the Mole — board generation, current flow, wear, `LOCK_CAMPAIGN`, daily-lock seeding, medals. The engine also carries Manny's wire-bank puzzle, unused here but kept as a possible second mode. |
| `app.js` | The game around the engine: screens, storage, daily streak, campaign chain, DOM renderer |
| `sound.js` | WebAudio voice: samples with procedural fallbacks |
| `sounds.js` | Base64 mp3 one-shots (generated via Manny's `tools/build-sounds.py`) |
| `tools/build-bundle.py` | Single self-contained HTML file (for CSP-strict hosts) |
| `tools/build-crazygames.py` | Submission zip with the CrazyGames SDK tag injected |

## Platform integrations

All optional, all guarded — the game runs identically from a bare
`file://` open:

- **CrazyGames SDK** (`window.CrazyGames`): loading/gameplay events and
  `happytime()` on a solve. The tag is only present in the zip build.
- **GameVolt SDK** (`window.GameVolt`): init, save migration, and the
  daily streak submitted to a `daily-streak` leaderboard. Present only
  when the game is served on gamevolt.io.

## Storage

`localStorage`, keys prefixed `short-circuit:` — campaign bests, the
daily record (date, time, streak, best streak), mute, and the
seen-the-teaching-lock flag.
