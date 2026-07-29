# Screenshot pipeline

Regenerates the screenshots the root `README.md` embeds, into `docs/screenshots/`.

Run it whenever the UI changes enough that the README misrepresents the app. It is a
manual tool: nothing in CI touches it, and it is not part of the app or the release.

## Running it

Needs Docker and Node 20+.

```bash
cd tools/screenshots
npm install
npx playwright install chromium

npm run up      # throwaway stack on :8099 (builds apps/api + apps/web)
npm run seed    # the demo pool — six weeks of readings, treatments, maintenance
npm run shots   # web app        → docs/screenshots/*.png
npm run ha-shots# Lovelace cards → docs/screenshots/hass-*.png
npm run down    # tears the stack down, demo data included
```

`npm run all` does the five in order. Point any step at a different instance with
`HOMEPOOL_URL=http://host:port`.

**Then look at every PNG it changed.** The scripts can only assert that an element was
found and photographed, not that the result is worth publishing — cut-off text, an empty
state, a stray focus ring and a light-mode flash all screenshot perfectly happily.

## How it fits together

| File | Does what |
|---|---|
| `compose.yaml` | A stack under its own project name (`homepool-docs`), on port 8099, with **no named volume** — so it can't touch a real instance's data and `down` disposes of everything. |
| `demo-data.mjs` | The demo pool, defined once and shared by the seeder and the card harness so the web and HA screenshots agree. Deterministic: no `Math.random`, so re-running changes pixels only when the app changed. |
| `seed.mjs` | POSTs that data through the API-key `/v1` endpoints (the same ones the HA integration writes through). Refuses to run against an instance that already has accounts. |
| `shots.mjs` | Drives the web app with Playwright. Language, theme, active installation and measurement-input mode are all set by writing the app's own localStorage keys rather than clicking. |
| `ha-harness.html` | Renders the real, unmodified `homepool-card.js` outside Home Assistant — see below. |
| `ha-shots.mjs` | Builds the harness fixture from the live seeded API and photographs each card. |

## Screenshotting the HA cards without Home Assistant

`custom_components/homepool/frontend/homepool-card.js` is a self-contained vanilla ES
module: it reads `hass.states`, calls `hass.callService`, and styles its own markup from CSS
variables that all have fallbacks. So the harness imports it **unmodified**, hands it a
`hass`-shaped object, and screenshots the result. Two things are imitated, both chrome
rather than content:

- **`<ha-card>`**, which HA defines and the cards wrap their markup in. It has to be
  registered as a real custom element, not a CSS rule: `ha-card` is created *inside* the
  card's shadow root, which document styles don't reach. All the shim contributes is
  `display: block` and a rounded border — the background, padding, colour and every pixel
  of content come from the card's own stylesheet.
- **HA's dark theme variables**, plus `color-scheme: dark` so the editor's native form
  controls render dark the way they do in HA.

The fixture is built from the live seeded API in `ha-shots.mjs`, mapping `/v1/current`,
`/v1/todo`, `/v1/history` and `/v1/treatments` into the entities `sensor.py` would create.
If that mapping drifts from `sensor.py`, the cards will render something HA never would —
so it's the first place to look if a card screenshot disagrees with a real dashboard.

## Adding a shot

Add a capture to `shots.mjs` (or `ha-shots.mjs`), reference it from the root `README.md`,
and run the pipeline. Two habits worth keeping:

- Wait on a real signal — an element, `networkidle` — not a fixed sleep.
- Blur the last field you typed into, or it wears a focus ring.

## Known gaps

- **No mobile entry-sheet shot.** `.mobile-header`/`.mobile-nav` are fixed at `z-index: 200`
  (`apps/web/src/index.css`) while the Radix dialog portal sits at 50, so on a phone the
  header paints over an open sheet and its title reads through the translucent backdrop.
  Raising the dialog isn't a one-liner: `[data-radix-popper-content-wrapper]` is pinned to
  200, so lifting dialogs above the chrome would drop every Select popup behind its own
  modal. Once that's sorted on a device, the capture is a few lines in `shots.mjs`.
- **The card editor's per-task quick-add chips don't appear.** `HomepoolCardEditor._build()`
  runs on whichever of `setConfig`/`hass` lands first, so it never has both, and the chips
  are discovered from `hass`. The screenshot shows what users actually see.
- The lockfile is deliberately untracked (see `.gitignore`) — this tool ships with nothing.
