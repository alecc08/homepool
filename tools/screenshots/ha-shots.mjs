// Captures the Home Assistant Lovelace card screenshots — without Home Assistant.
//
// The cards are plain custom elements that only ever read `hass.states`, so this
// serves ha-harness.html with a `hass`-shaped fixture and photographs the result.
// The fixture is built from the **live seeded API** using the same `/v1` endpoints
// the integration's coordinator polls, mapped into entities the way sensor.py
// does — so what the card renders here is what it renders in HA, on the same pool
// the web-app screenshots show.

import { readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { ACCOUNT } from './demo-data.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, '../../docs/screenshots');
const CARD = resolve(HERE, '../../custom_components/homepool/frontend/homepool-card.js');
const BASE = process.env.HOMEPOOL_URL ?? 'http://localhost:8099';
const API = `${BASE}/api`;

const PREFIX = 'sensor.my_pool';

// sensor.py's HomepoolMeasurementSensor entity-id suffix per homepool field,
// mirroring FIELD_SUFFIXES in homepool-card.js.
const FIELD_SUFFIXES = {
  ph: 'ph',
  chlorine: 'chlorine',
  bromine: 'bromine',
  tac: 'tac',
  hardness: 'hardness',
  salt: 'salt',
  stabilizer: 'stabilizer_cya',
  cc: 'combined_chlorine',
  temp: 'temperature',
};

// The entity names the integration assigns (FIELD_NAMES in const.py). Every
// measurement sensor sets _attr_has_entity_name, so the friendly_name HA
// composes — and the card reads — is "<device name> <entity name>", the device
// being the installation.
const FIELD_NAMES = {
  ph: 'pH',
  chlorine: 'Chlorine',
  bromine: 'Bromine',
  tac: 'TAC',
  hardness: 'Hardness',
  salt: 'Salt',
  stabilizer: 'Stabilizer (CYA)',
  cc: 'Combined Chlorine',
  temp: 'Temperature',
};

async function api(path, apiKey) {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${await res.text()}`);
  return res.json();
}

/** Signs in as the demo account and mints an API key for the /v1 reads. */
async function apiKey() {
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: ACCOUNT.email, password: ACCOUNT.password }),
  });
  if (!login.ok) throw new Error(`login → ${login.status}: is the stack seeded? (npm run seed)`);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const res = await fetch(`${API}/me/api-key`, { method: 'POST', headers: { Cookie: cookie } });
  if (!res.ok) throw new Error(`POST /me/api-key → ${res.status}`);
  return (await res.json()).key;
}

/** Turns the API's own payloads into the entities sensor.py would have created. */
function buildFixture({ installation, current, todo, history, treatments }) {
  const states = {};

  const put = (entityId, state, attributes = {}) => {
    states[entityId] = { entity_id: entityId, state: String(state), attributes };
  };

  // ── One measurement sensor per tracked parameter ─────────────────────────
  for (const [field, reading] of Object.entries(current)) {
    if (!reading) continue;
    const attrs = { friendly_name: `${installation.name} ${FIELD_NAMES[field]}` };
    // pH is unitless in HA's PH device class (sensor.py drops the unit).
    if (field !== 'ph' && reading.unit) attrs.unit_of_measurement = reading.unit;
    for (const key of ['date', 'status', 'ideal_min', 'ideal_max', 'acceptable_min', 'acceptable_max']) {
      if (reading[key] !== null && reading[key] !== undefined) attrs[key] = reading[key];
    }
    attrs.sanitizer = installation.sanitizer;
    put(`${PREFIX}_${FIELD_SUFFIXES[field]}`, reading.value, attrs);
  }

  // ── Days-until-due sensor + "log" button per enabled task ────────────────
  // Both carry task_key, which is how the card discovers them
  // (discoverTaskEntities in homepool-card.js).
  for (const task of todo) {
    if (!task.enabled) continue;
    const slug = task.label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
    const shared = { task_key: task.key, label: task.label };
    if (task.days_until_due !== null && task.days_until_due !== undefined) {
      put(`${PREFIX}_days_until_${slug}_due`, task.days_until_due, {
        ...shared, friendly_name: `My pool Days Until ${task.label} Due`,
      });
    }
    put(`button.my_pool_log_${slug}`, 'unknown', {
      ...shared, friendly_name: `My pool Log ${task.label}`,
    });
  }

  // ── History + treatment catalog sensors ─────────────────────────────────
  put(`${PREFIX}_history`, history.length, {
    friendly_name: 'My pool History',
    entries: history,
  });
  put(`${PREFIX}_treatments`, treatments.length, {
    friendly_name: 'My pool Treatments',
    treatments: treatments.map(p => ({
      key: p.key, label: p.label, icon: p.icon, default_unit: p.default_unit, param: p.param,
    })),
  });

  const cardConfig = {
    type: 'custom:homepool-card',
    title: installation.name,
    entity_prefix: PREFIX,
    installation_id: installation.id,
    show_buttons: true,
    show_due: true,
  };

  return {
    states,
    mainCardConfig: cardConfig,
    historyCardConfig: {
      type: 'custom:homepool-history-card',
      title: installation.name,
      entity_prefix: PREFIX,
      max_items: 8,
    },
  };
}

async function shot(locator, name) {
  await locator.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`  ✓ ${name}.png`);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  console.log(`→ reading the seeded pool from ${API}`);
  const key = await apiKey();
  const installations = await api('/v1/installations', key);
  const installation = installations.find(i => i.type === 'pool') ?? installations[0];
  const scope = `?installation_id=${installation.id}`;
  const fixture = buildFixture({
    installation,
    current: await api(`/v1/current${scope}`, key),
    todo: await api(`/v1/todo${scope}`, key),
    history: await api(`/v1/history${scope}&limit=8`, key),
    treatments: await api(`/v1/treatments${scope}`, key),
  });

  const browser = await chromium.launch();
  // Tall enough that no card is longer than the viewport. Element screenshots of
  // something that doesn't fit get stitched across scroll positions, and the
  // seams pull in whatever sits below the card.
  const page = await browser
    .newContext({ viewport: { width: 900, height: 2200 }, deviceScaleFactor: 2 })
    .then(c => c.newPage());
  page.on('console', m => { if (m.type() === 'error') console.error(`  ! ${m.text()}`); });

  // Served from memory rather than the filesystem so the harness and the real,
  // untouched card module can sit at the same origin without copying anything.
  const html = await readFile(resolve(HERE, 'ha-harness.html'), 'utf8');
  const cardJs = await readFile(CARD, 'utf8');
  await page.route('**/harness.html', r => r.fulfill({ contentType: 'text/html', body: html }));
  await page.route('**/card.js', r => r.fulfill({ contentType: 'text/javascript', body: cardJs }));
  await page.addInitScript(`window.HA_FIXTURE = ${JSON.stringify(fixture)};`);

  await page.goto('https://harness.local/harness.html');
  await page.waitForFunction('window.harnessReady === true');
  await page.waitForTimeout(600);

  console.log('cards');
  // The ha-card surface rather than the host element: that's the card as a
  // dashboard shows it, with no surrounding page background in the crop.
  await shot(page.locator('homepool-card').locator('ha-card'), 'hass-main-card');
  await shot(page.locator('homepool-history-card').locator('ha-card'), 'hass-history-card');

  // The treatment form, opened the way a user would. It's a position:fixed
  // overlay, so it sits outside the card's own box — the modal is captured
  // directly rather than via its host element.
  const main = page.locator('homepool-card');
  await main.locator('#hp-treatment-toggle').click();
  await page.waitForTimeout(400);
  const products = fixture.states[`${PREFIX}_treatments`].attributes.treatments;
  await main.locator('select[name="treatment"]').selectOption(products[0].key);
  await main.locator('input[name="qty"]').fill('20');
  await main.locator('input[name="brand"]').fill('Windsor Pool Salt');
  // Drop focus so the last-typed field isn't wearing a focus ring in the shot.
  await main.locator('.hp-modal-header').click();
  await page.waitForTimeout(300);
  await shot(main.locator('.hp-modal'), 'hass-treatment-form');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // And the visual editor, which is where the quick-add buttons get hidden.
  await page.evaluate('window.harness.openEditor()');
  await page.waitForTimeout(500);
  await shot(page.locator('#editor'), 'hass-card-editor');

  await browser.close();
  console.log(`\n✓ written to ${OUT}`);
}

main().catch(err => {
  console.error(`\n✗ ${err.message}`);
  process.exit(1);
});
