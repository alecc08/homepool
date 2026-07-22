# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.5.0] - 2026-07-22

## [1.4.1] - 2026-07-21

## [1.4.0] - 2026-07-21

## [1.3.0] - 2026-07-21

### Added

- Installations now have optional contact / location fields — address, contact name, phone, email and notes — for users managing multiple pools at different addresses (#35).
- Added a `CLAUDE.md` documenting the repo's components and release-label workflow.

## [1.2.0] - 2026-07-21

### Added

- Lovelace card: tapping a parameter tile opens the log-measurement popup focused on that field, and a 📈 icon on each tile opens Home Assistant's native more-info dialog for that sensor (#32).
- Quick-maintenance buttons now flash a "✓ Logged" confirmation when pressed (#32).
- New `homepool-history-card` — a read-only table of recent measurements, treatments and maintenance with a configurable `max_items` and type filters, backed by a new `sensor.<installation>_history` entity.
- `/v1/history` now returns all action kinds (measurement/treatment/maintenance) with `type`, `from_date`, `to_date` and `limit` filters.

### Fixed

- Lovelace card: logging a measurement no longer loses input focus / drops keystrokes when the card refreshes — the form is now a popup that background updates don't rebuild (#32).

## [1.1.1] - 2026-07-21

## [1.1.0] - 2026-07-20

## [1.0.2] - 2026-07-20

## [1.0.1] - 2026-07-20

## [1.0.0] - 2026-07-20

### Added

- All components (HA integration, web app, API) now version in lockstep — every release bumps `manifest.json`, `apps/web/package.json`, and `apps/api/VERSION` together via `release.yml` (#25).
- Weekly automated dependency updates via Renovate: patch/minor updates auto-merge after a 3-day stability window and passing CI, major updates always wait for manual review (#25).
- Every PR must carry a `release:major`/`release:minor`/`release:patch`/`release:no-release` label before it can merge — enforced by a required check, closing the gap that let a PR merge without one and silently default to a patch release.
- Release versioning now happens pre-merge: adding a `release:*` label to an open PR pushes the version bump straight onto that PR's branch (so it goes through normal CI like any other change) instead of committing directly to `main` after the fact, which a protected `main` no longer allows.

### Changed

- `docker-compose.yml` renamed to `compose.yaml` (#25).

### Removed

- Dead pre-rebrand `landing/` and `docs/index.html` marketing pages — never published (no GitHub Pages configured), unreferenced anywhere, and still fully "Pooly"-branded (#25).

## [0.1.3] - 2026-07-20

## [0.2.0] - 2026-07-20 [RETRACTED]

> Retracted: the integration shipped with a call to `frontend.async_register_extra_js_url`,
> an API removed from current HA core, which crashed integration setup entirely (see
> [0.1.2](#012---2026-07-20)). Its git tag also pointed at an unrelated orphaned commit
> due to a release-CI bug, and has been deleted. Do not install this version; use 0.1.2
> or later.

### Added

- "Deep Ocean" visual redesign: near-black cool surfaces, hairline borders, a single cyan accent, no gradients — applied across every page, modal, and the sidebar/mobile nav, with a matching refined light theme (#22).
- Hand-rolled `TrendChart` component (line/area with an ideal-range band, status-colored dots, hover tooltip) replacing the CSS bar charts on the dashboard and Measurements page (#22).
- Redesigned dashboard: a unified water-status board of param tiles (value, status dot, ideal range, sparkline) replaces the old KPI grid + params banner, plus a new "Needs attention" panel merging overdue maintenance and out-of-range params into one prioritized list (#22).
- A hand-written custom Home Assistant Lovelace card (`homepool-card`), served directly by the integration — no separate frontend install. Mirrors the web app's param-tile look, with status dots, due chips, quick-add maintenance buttons, and an inline measurement-logging form (#22).
- `status` and `ideal_min`/`ideal_max` attributes on homepool's water-parameter sensors (backward compatible — older servers simply omit them) (#22).

### Changed

- Lucide icons replace hand-inline SVGs and emoji throughout the UI (nav, theme switch, installation type picker, dialogs, etc.) (#22).
- README reordered to lead with the Home Assistant story, including a new homepool-card section; stale Pooly-era `docs/api.md` and `docs/stack.md` removed (#22).

## [0.1.2] - 2026-07-20

### Fixed

- `frontend.async_register_extra_js_url` was removed from current HA core, breaking setup of the integration entirely; switched to `frontend.add_extra_js_url` (#23).

## [0.1.1] - 2026-07-20

### Added

- Dashboard tiles for CYA/stabilizer and hardness alongside the existing pH, chlorine/bromine, TAC, and temperature tiles (#11).
- A "Simulator" tool for freestyle what-if dosage estimates and a pool heating-energy (kWh) calculator, without needing a saved installation reading (#11).

### Changed

- **Breaking:** renamed the Home Assistant integration's domain from `pooly` to `homepool` to match the web app's rebrand. If you already had the integration installed, entity IDs change from `sensor.pooly_*` to `sensor.homepool_*` and the service moves from `pooly.log_measurement` to `homepool.log_measurement` — update any dashboards or automations that reference the old names, then reinstall/reload the integration (#11).

### Fixed

- Dosage recommendations now trigger as soon as a reading leaves the tighter "ideal" band, matching the dashboard's "Watch" status badge; previously a param could show a "Watch" warning on the dashboard while the Recommendations page reported everything as fine (#11).

## [0.1.0] - 2026-07-19

### Added

- Home Assistant button entities for one-tap maintenance logging (cartridge cleaning, skimmer filter cleaning, backwash, pH calibration, purge, water change) (#12).
- Home Assistant `pooly.log_measurement` service for logging water measurements from a dashboard, script, or automation (#12).
- Versioning and release CI/CD pipeline: tags and GitHub Releases are cut automatically on merge to `main`, with the version bump driven by a `release:patch` / `release:minor` / `release:major` / `release:no-release` PR label (#18).

### Changed

- Removed the "pool condition" (clear/cloudy/green) card from the main dashboard; it was based on a simplistic heuristic that didn't reliably reflect actual water condition (#13).
