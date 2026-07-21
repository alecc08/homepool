# Working in homepool

homepool is a self-hosted pool & spa maintenance tracker: log water measurements and
treatments, get sanitizer-aware target ranges and dosing advice, and surface it all in
Home Assistant. It's a monorepo with three components that ship and version together.

## Components

- **`apps/api`** — FastAPI backend (SQLModel over PostgreSQL). The single source of truth
  for data (users, installations, measurements/actions) and all business logic (target
  ranges, dosing, simulator).
- **`apps/web`** — React + Vite single-page PWA. Talks only to the API; nginx serves it and
  proxies `/api` to the backend.
- **`custom_components/homepool`** — Home Assistant integration. A read/write client of the
  API's versioned `/v1` surface; it does not own any data model of its own.

`compose.yaml` wires all three (plus Postgres) together for local development.

The web app is bilingual (English + French) via an in-app toggle — user-facing strings live
in the i18n translations and must be added to **every** locale, not just one.

## Database

There is no migration framework. Tables are created from the SQLModel classes at startup,
and schema changes to existing tables are done with hand-rolled, idempotent
`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` helpers run on boot (Postgres only — they no-op
elsewhere, and the test DB is created fresh from the models). When you add a column to an
existing model, add a matching helper so deployed databases pick it up.

## Releases

Every PR into `main` must carry exactly one release label:
`release:major` / `release:minor` / `release:patch` / `release:no-release`. A required
check blocks merging without one.

Versions are bumped **only** by the Release workflow when a `release:*` label is added — it
updates every component's version in lockstep. **Never hand-edit a version field** (the HA
`manifest.json`, the web `package.json`/lockfile, or `apps/api/VERSION`); let the workflow
do it. On merge, the workflow tags and publishes the release.

## Tests

- Backend: `pytest` from `apps/api` (needs `DATABASE_URL` set; CI points it at a throwaway
  SQLite file). Tests live in `apps/api/tests`.
- Frontend: `npm test` (Vitest) from `apps/web`. `npm run build` also typechecks.

CI runs both on every PR. Add tests alongside behavior changes.
