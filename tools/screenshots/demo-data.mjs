// The demo pool, defined once.
//
// seed.mjs POSTs this into a throwaway API so the web app has something to
// screenshot; ha-harness.html renders the same numbers through the Lovelace
// card. Sharing the source is the point — otherwise the card screenshots and
// the app screenshots would quietly disagree about what the pool looks like.
//
// Everything is deterministic (no Math.random) so re-running the pipeline
// produces the same pixels and the diff stays honest: a screenshot that
// changed, changed because the app did.

/** Days back from today → ISO date. `0` is today. */
export function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export const POOL = {
  name: 'My pool',
  type: 'pool',
  sanitizer: 'salt',
  volume: 50000,
  volume_unit: 'L',
  temp_unit: 'C',
};

export const SPA = {
  name: 'Hot tub',
  type: 'spa',
  sanitizer: 'bromine',
  volume: 1500,
  volume_unit: 'L',
  temp_unit: 'C',
};

// Six weeks of readings, oldest first, roughly twice a week.
//
// The shape is deliberate rather than random: pH drifts up the way a salt pool's
// does (the generator is a continuous source of hydroxide), free chlorine sags
// between shocks, and CYA creeps up as stabilizer is added. The **last** entry
// is out of range on pH and free chlorine on purpose — that is what populates
// the dashboard's "Needs attention" card and gives the Recommendations page
// something to recommend. A pool sitting perfectly in range screenshots as a
// row of empty states.
export const MEASUREMENTS = [
  { day: 42, ph: 7.4, chlorine: 3.2, tac: 75, hardness: 240, salt: 3100, stabilizer: 62, temp: 24.1 },
  { day: 39, ph: 7.4, chlorine: 3.0, tac: 74, hardness: 240, salt: 3080, stabilizer: 62, temp: 24.8 },
  { day: 35, ph: 7.5, chlorine: 2.8, tac: 72, hardness: 235, salt: 3050, stabilizer: 61, temp: 25.4 },
  { day: 32, ph: 7.5, chlorine: 3.4, tac: 72, hardness: 235, salt: 3400, stabilizer: 64, temp: 25.9 },
  { day: 28, ph: 7.6, chlorine: 3.1, tac: 70, hardness: 230, salt: 3380, stabilizer: 64, temp: 26.3 },
  { day: 25, ph: 7.5, chlorine: 2.9, tac: 70, hardness: 230, salt: 3350, stabilizer: 65, temp: 26.8 },
  { day: 21, ph: 7.6, chlorine: 2.6, tac: 68, hardness: 228, salt: 3320, stabilizer: 66, temp: 27.2 },
  { day: 18, ph: 7.5, chlorine: 3.5, tac: 74, hardness: 228, salt: 3300, stabilizer: 66, temp: 27.6 },
  { day: 14, ph: 7.6, chlorine: 3.2, tac: 73, hardness: 225, salt: 3280, stabilizer: 68, temp: 28.0 },
  { day: 11, ph: 7.6, chlorine: 2.9, tac: 72, hardness: 225, salt: 3260, stabilizer: 68, temp: 28.4 },
  { day: 8, ph: 7.7, chlorine: 2.7, tac: 71, hardness: 222, salt: 3240, stabilizer: 70, temp: 28.7 },
  { day: 6, ph: 7.7, chlorine: 2.4, tac: 70, hardness: 222, salt: 3220, stabilizer: 71, temp: 29.0 },
  { day: 4, ph: 7.8, chlorine: 2.2, tac: 69, hardness: 220, salt: 3200, stabilizer: 72, temp: 29.2 },
  // The pH decreaser logged on day 2 drags total alkalinity down with it (acid
  // lowers both), which the app's own pH advice warns about — so the last
  // reading is under the TA floor and earns a third recommendation.
  { day: 2, ph: 7.8, chlorine: 1.9, tac: 64, hardness: 220, salt: 3180, stabilizer: 73, temp: 29.4 },
  { day: 0, ph: 7.9, chlorine: 1.6, tac: 54, hardness: 218, salt: 3160, stabilizer: 74, temp: 29.6, cc: 0.3 },
];

// Products come from the seeded catalog for a salt pool (water_params.py's
// _SANITIZER_TREATMENTS["salt"] + _COMMON_TREATMENTS + _POOL_TREATMENTS), so
// these keys resolve without any catalog customization. One carries a brand,
// which is what exercises the brand rendering in the history rows.
export const TREATMENTS = [
  { day: 32, treatment: 'salt', qty: '20', unit: 'kg', brand: 'Windsor Pool Salt' },
  { day: 18, treatment: 'chlorine_shock', qty: '450', unit: 'g', notes: 'After the storm' },
  { day: 11, treatment: 'stabilizer', qty: '300', unit: 'g' },
  { day: 6, treatment: 'algaecide', qty: '250', unit: 'ml', brand: 'HTH Super' },
  { day: 2, treatment: 'ph_decreaser', qty: '400', unit: 'ml' },
];

// Tasks beyond the seeded set (water_params.py's DEFAULT_MAINTENANCE_TASKS for
// a pool gives ph_measurement / filter_maintenance / water_change /
// ph_calibration). Adding a couple is what shows, in the screenshot itself,
// that the task list is yours to extend.
export const CUSTOM_TASKS = [
  { label: 'Brushing the walls', interval_days: 7, icon: 'mdi:broom' },
  { label: 'Skimmer basket', interval_days: 3, icon: 'mdi:basket-outline' },
];

// Completions, keyed by task key — a builtin key for the seeded tasks, or the
// exact label for one of CUSTOM_TASKS (seed.mjs resolves both against the live
// task list). The days are chosen to leave the pool with a believable spread of
// due states: water_change 10 days overdue and brushing 2 days overdue (so
// "Needs attention" and the Maintenance page both have something in them),
// everything else comfortably in date.
export const MAINTENANCE = [
  { day: 100, task: 'water_change' },
  { day: 40, task: 'ph_calibration' },
  { day: 24, task: 'filter_maintenance' },
  { day: 16, task: 'Brushing the walls' },
  { day: 10, task: 'filter_maintenance', notes: 'Backwashed until the sight glass ran clear' },
  { day: 9, task: 'Brushing the walls' },
  { day: 3, task: 'Skimmer basket' },
  { day: 1, task: 'Skimmer basket' },
];

// example.com rather than something like homepool.local: the API validates
// addresses with email-validator, which rejects reserved TLDs (.local, .test,
// .invalid) outright — and example.com is the domain reserved for exactly this.
// These addresses are visible in the profile and Sharing screenshots.
export const ACCOUNT = {
  email: 'demo@example.com',
  first_name: 'Demo',
  password: 'HomepoolDemo!2026',
};

export const PARTNER = {
  email: 'sam@example.com',
  first_name: 'Sam',
  password: 'HomepoolDemo!2026',
};
