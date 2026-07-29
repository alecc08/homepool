// Fills a throwaway homepool instance with the demo pool from demo-data.mjs.
//
// Writes through the API-key `/v1` surface (POST /v1/measurements, /v1/treatments,
// /v1/maintenance/complete) rather than poking Postgres: those endpoints all take
// an explicit `date`, which is exactly what backdating six weeks of history needs,
// and they are the same paths the Home Assistant integration exercises — so if the
// seeder breaks, something real broke.
//
// Refuses to run against anything that already has accounts, so pointing it at a
// live instance by mistake can't overwrite someone's pool.

import {
  ACCOUNT, PARTNER, POOL, SPA, MEASUREMENTS, TREATMENTS, MAINTENANCE, CUSTOM_TASKS, daysAgo,
} from './demo-data.mjs';

const BASE = process.env.HOMEPOOL_URL ?? 'http://localhost:8099';
const API = `${BASE}/api`;

let cookie = '';
let apiKey = '';

async function call(path, { method = 'GET', body, key = false } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (key && apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  // The session cookie arrives on register/login and every later session-auth
  // call rides on it.
  const setCookie = res.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];

  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status} ${await res.text()}`);
  }
  return res.status === 204 ? null : res.json();
}

async function waitForApi() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${API}/health`);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`API never became healthy at ${API} — is the stack up? (npm run up)`);
}

async function main() {
  console.log(`→ waiting for ${API}`);
  await waitForApi();

  // Guard rail: this script backdates history and renames installations. Doing
  // that to a real instance would be destructive, and the only instance it can
  // possibly be safe on is an empty one.
  const status = await call('/auth/registration-status');
  if (!status.first_run) {
    throw new Error(
      `${BASE} already has accounts — refusing to seed. This script is only for the ` +
      `throwaway stack (npm run down && npm run up to reset it).`,
    );
  }

  console.log('→ registering the demo account');
  await call('/auth/register', { method: 'POST', body: ACCOUNT });
  ({ key: apiKey } = await call('/me/api-key', { method: 'POST' }));

  // Registration hands out a default installation, but its treatment catalog is
  // seeded for *its* sanitizer (bromine) at creation, and seeding deliberately
  // never tops up an existing catalog. PATCHing it to a salt pool would leave it
  // stocked with bromine products, so the demo installations are created fresh —
  // seeded correctly for what they actually are — and the default is dropped.
  const [byDefault] = await call('/installations');
  const pool = await call('/installations', { method: 'POST', body: POOL });
  const spa = await call('/installations', { method: 'POST', body: SPA });
  await call(`/installations/${byDefault.id}`, { method: 'DELETE' });
  console.log(`→ pool #${pool.id} "${pool.name}", spa #${spa.id} "${spa.name}"`);

  console.log(`→ ${CUSTOM_TASKS.length} custom maintenance tasks`);
  for (const task of CUSTOM_TASKS) {
    await call(`/installations/${pool.id}/maintenance`, { method: 'POST', body: task });
  }

  console.log(`→ ${MEASUREMENTS.length} measurements`);
  for (const { day, ...fields } of MEASUREMENTS) {
    await call('/v1/measurements', {
      method: 'POST', key: true,
      body: { installation_id: pool.id, date: daysAgo(day), ...fields },
    });
  }

  console.log(`→ ${TREATMENTS.length} treatments`);
  for (const { day, ...fields } of TREATMENTS) {
    await call('/v1/treatments', {
      method: 'POST', key: true,
      body: { installation_id: pool.id, date: daysAgo(day), ...fields },
    });
  }

  // Completions name a task by builtin key or by label; both are resolved here
  // against the live list so demo-data.mjs never has to know database ids.
  const tasks = await call(`/installations/${pool.id}/maintenance`);
  const byName = new Map(tasks.flatMap(t => [[t.key, t], [t.label, t]]));

  console.log(`→ ${MAINTENANCE.length} maintenance completions`);
  for (const { day, task, notes } of MAINTENANCE) {
    const match = byName.get(task);
    if (!match) throw new Error(`No maintenance task named "${task}" — known: ${[...byName.keys()].join(', ')}`);
    await call('/v1/maintenance/complete', {
      method: 'POST', key: true,
      body: { installation_id: pool.id, task_id: match.id, date: daysAgo(day), notes: notes ?? '' },
    });
  }

  // A second account, purely so the Sharing tab screenshot shows a real share
  // instead of an empty state. Registration is a session-auth call, so it takes
  // over the cookie — the demo account is logged back in afterwards.
  console.log('→ a second account, and a share of the pool with it');
  await call('/auth/register', { method: 'POST', body: PARTNER });
  await call('/auth/login', { method: 'POST', body: { email: ACCOUNT.email, password: ACCOUNT.password } });
  await call(`/installations/${pool.id}/shares`, {
    method: 'POST', body: { email: PARTNER.email, role: 'editor' },
  });

  console.log(`\n✓ seeded. Open ${BASE} and sign in as ${ACCOUNT.email} / ${ACCOUNT.password}`);
}

main().catch(err => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
