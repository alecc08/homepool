/**
 * homepool Lovelace card.
 *
 * Hand-written vanilla ES module — no build step, no lit, no dependencies.
 * Mirrors the "Deep Ocean" param-tile look of the homepool web app: a mono
 * value, unit, status rail/dot, ideal range, and a "measured N days ago"
 * readout, sourced from the homepool sensor entities' `status` /
 * `ideal_min` / `ideal_max` / `date` attributes (apps/api/main.py's
 * ParamValueOut). Those attributes are optional — a server predating them
 * simply omits the keys, and every tile below degrades to a neutral (no
 * status dot) display when they're missing.
 */

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

// The two form-toggle buttons are fixed quick-add entries (they open the
// measurement and treatment forms). Maintenance quick-add buttons and the
// "days until due" chips are no longer a fixed set: they're discovered from the
// homepool task entities by their `task_key` attribute (see discoverTaskEntities),
// so the card stays in sync with whatever configurable tasks the API returns.
const FORM_TOGGLE_KEY = 'log_measurement';
const TREATMENT_TOGGLE_KEY = 'log_treatment';

// Amounts a treatment can be recorded in, mirroring TREATMENT_UNITS in the web
// app. The product's own default_unit is preselected; this is the override list.
const TREATMENT_UNITS = ['g', 'kg', 'ml', 'L', 'oz', 'lb', 'fl oz', 'gal', 'tablet', 'cap', 'scoop'];

// Finds the homepool maintenance-task entities (todo "days until due" sensors,
// or "mark done" buttons) for one installation by their `task_key` attribute.
// `idPrefix` is the entity-id prefix those entities share, derived from the
// card's entity_prefix. Sorted by entity_id for a stable display order.
function discoverTaskEntities(hass, idPrefix) {
  if (!hass || !idPrefix) return [];
  return Object.keys(hass.states)
    .filter((id) => id.startsWith(idPrefix))
    .map((id) => ({ entityId: id, attrs: hass.states[id].attributes || {} }))
    .filter(({ attrs }) => attrs.task_key !== undefined)
    .map(({ entityId, attrs }) => ({
      key: attrs.task_key,
      label: attrs.label || attrs.task_key,
      entityId,
    }))
    .sort((a, b) => a.entityId.localeCompare(b.entityId));
}

// button.<x> entity-id prefix for the given entity_prefix (sensor.<x> → button.<x>_).
function taskButtonPrefix(entityPrefix) {
  return `button.${entityPrefix.replace(/^sensor\./, '')}_`;
}

// Discovers the homepool installations known to this HA instance, so the card
// editors can offer a "pick a pool" dropdown instead of making the user find a
// sensor. Anchors on each installation's history sensor (`sensor.<prefix>_history`,
// created unconditionally per installation in sensor.py) — a robust anchor that
// doesn't depend on which measurement fields exist and survives legacy sticky
// ids like `sensor.backyard_home_history`. Recovers `prefix` by stripping the
// `_history` suffix, reads `installationId` from the device's homepool
// identifier `(DOMAIN, id)`, and labels each entry by device name (falling back
// to the prefix). Returns [{ deviceId, installationId, name, prefix }] sorted by
// name; [] when hass/registries aren't loaded yet.
function discoverInstallations(hass) {
  if (!hass || !hass.entities || !hass.devices) return [];
  return Object.keys(hass.entities)
    .map((id) => ({ id, entry: hass.entities[id] }))
    .filter(({ id, entry }) => entry && entry.platform === 'homepool' && id.endsWith('_history'))
    .map(({ id, entry }) => {
      const prefix = id.slice(0, -'_history'.length);
      const device = hass.devices[entry.device_id];
      const identifier = device && device.identifiers
        && device.identifiers.find(([domain]) => domain === 'homepool');
      const installationId = identifier ? parseInt(identifier[1], 10) : undefined;
      const name = (device && (device.name_by_user || device.name)) || prefix;
      return { deviceId: entry.device_id, installationId, name, prefix };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

const FORM_FIELD_LABELS = {
  ph: 'pH',
  chlorine: 'Cl',
  bromine: 'Br',
  cc: 'CC',
  tac: 'TAC',
  hardness: 'CH',
  salt: 'Salt',
  stabilizer: 'CYA',
  temp: 'T°',
};

// Quick-add field set per sanitizer — keeps the default form short and
// relevant instead of showing every field regardless of pool type. Anything
// not in the active set is still reachable via the "more fields" toggle.
// Installations on a server too old to send `sanitizer` (or with it unset)
// fall back to the original always-shown set.
const SANITIZER_FORM_FIELDS = {
  chlorine: ['ph', 'chlorine', 'cc', 'tac', 'temp'],
  bromine: ['ph', 'bromine', 'tac', 'temp'],
  salt: ['ph', 'chlorine', 'salt', 'tac', 'temp'],
};
const DEFAULT_FORM_FIELDS = ['ph', 'chlorine', 'bromine', 'tac', 'temp'];

const STRINGS = {
  en: {
    title: 'homepool',
    ideal: 'ideal',
    measured_today: 'measured today',
    measured_yesterday: 'measured yesterday',
    measured_days_ago: (n) => `measured ${n} days ago`,
    never_measured: 'never measured',
    no_data: 'No homepool entities found for this card configuration.',
    due_today: 'due today',
    due_overdue: (n) => `overdue by ${n}d`,
    due_in: (n) => `due in ${n}d`,
    quick_add: 'Quick add',
    log_measurement: 'Log measurement',
    log_treatment: 'Log treatment',
    treatment_product: 'Product',
    treatment_amount: 'Amount',
    treatment_unit: 'Unit',
    treatment_brand: 'Brand',
    no_treatments: 'No treatment products are set up for this pool yet.',
    save: 'Save',
    cancel: 'Cancel',
    more_fields: 'More fields',
    notes: 'Notes',
    logged: 'Logged',
    history: 'History',
    no_history: 'No history entries yet.',
    kind_measurement: 'Measurement',
    kind_treatment: 'Treatment',
    kind_maintenance: 'Maintenance',
    col_date: 'Date',
    col_type: 'Type',
    col_detail: 'Detail',
  },
  fr: {
    title: 'homepool',
    ideal: 'idéal',
    measured_today: "mesuré aujourd'hui",
    measured_yesterday: 'mesuré hier',
    measured_days_ago: (n) => `mesuré il y a ${n} jours`,
    never_measured: 'jamais mesuré',
    no_data: 'Aucune entité homepool trouvée pour cette configuration.',
    due_today: "aujourd'hui",
    due_overdue: (n) => `en retard de ${n}j`,
    due_in: (n) => `dans ${n}j`,
    quick_add: 'Ajout rapide',
    log_measurement: 'Enregistrer une mesure',
    log_treatment: 'Enregistrer un traitement',
    treatment_product: 'Produit',
    treatment_amount: 'Quantité',
    treatment_unit: 'Unité',
    treatment_brand: 'Marque',
    no_treatments: 'Aucun produit de traitement configuré pour ce bassin.',
    save: 'Enregistrer',
    cancel: 'Annuler',
    more_fields: 'Plus de champs',
    notes: 'Notes',
    logged: 'Enregistré',
    history: 'Historique',
    no_history: 'Aucune entrée pour le moment.',
    kind_measurement: 'Mesure',
    kind_treatment: 'Traitement',
    kind_maintenance: 'Entretien',
    col_date: 'Date',
    col_type: 'Type',
    col_detail: 'Détail',
  },
};

function t(hass, key, ...args) {
  const lang = (hass && hass.language && hass.language.startsWith('fr')) ? 'fr' : 'en';
  const entry = STRINGS[lang][key] ?? STRINGS.en[key];
  return typeof entry === 'function' ? entry(...args) : entry;
}

// Product and task labels are free text the user typed into homepool, and this
// card builds its DOM with innerHTML — so anything user-authored goes through
// here before it lands in markup.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// A tile's label: the sensor's friendly name with the device name taken off the
// front, since the card is already titled with the pool.
//
// Every measurement sensor sets _attr_has_entity_name, so HA composes
// friendly_name as "<installation> <field>" — "Backyard pool Chlorine". Dropping
// only the first word ("pool Chlorine") leaks the rest of a multi-word pool name
// into every tile and then ellipsizes it, so the card's own title is tried first
// and the single-word strip is kept as the fallback for when it doesn't match
// (a renamed entity, or a title that isn't the pool's name).
function tileLabel(attrs, field, title) {
  const friendly = attrs.friendly_name;
  if (!friendly) return field;
  if (title && friendly.toLowerCase().startsWith(`${title.toLowerCase()} `)) {
    return friendly.slice(title.length + 1);
  }
  return friendly.replace(/^.*?\s/, '');
}

function daysAgo(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr + 'T00:00:00Z').getTime();
  const today = new Date();
  const todayUtc = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((todayUtc - then) / 86400000);
}

function statusColor(status) {
  if (status === 'ok') return 'var(--homepool-ok, #3FB68B)';
  if (status === 'warn') return 'var(--homepool-warn, #D9A13B)';
  if (status === 'danger') return 'var(--homepool-danger, #E5645F)';
  return 'var(--homepool-border, #1E2630)';
}

function fmtValue(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '—';
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

// Inlined from apps/web/src/assets/homepool-icon.svg — the card is a
// single self-contained JS file, so no static-path registration/fetch.
const HOMEPOOL_ICON_SVG = `
  <svg class="hp-logo" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" fill="none">
    <rect width="48" height="48" rx="11" fill="#0B0F14"/>
    <line x1="24" y1="10" x2="24" y2="29" stroke="#8B98A9" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M8 24 C13 19 18.5 19 24 24 C29.5 29 35 29 40 24" stroke="#22D3EE" stroke-width="3" fill="none" stroke-linecap="round"/>
    <circle cx="24" cy="35" r="3.4" fill="#22D3EE"/>
  </svg>
`;

// mdi:chart-line, inlined so the tile's "open history" affordance stays
// self-contained (no ha-icon dependency / icon-set fetch).
const CHART_ICON_SVG = `
  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M3.5,18.49L9.5,12.48L13.5,16.48L22,6.92L20.59,5.51L13.5,13.48L9.5,9.48L2,16.99L3.5,18.49Z"/>
  </svg>
`;

// A small horizontal scale: the acceptable band (or, lacking that, a padded
// ideal band) as the track, the ideal band highlighted within it, and a
// marker at the current value — same status palette as the tile's dot/rail.
function gaugeHtml(value, attrs) {
  const iMin = attrs.ideal_min;
  const iMax = attrs.ideal_max;
  if (iMin === undefined || iMax === undefined || Number.isNaN(value)) return '';
  const idealSpan = iMax - iMin || 1;
  const scaleMin = attrs.acceptable_min !== undefined ? attrs.acceptable_min : iMin - idealSpan * 0.5;
  const scaleMax = attrs.acceptable_max !== undefined ? attrs.acceptable_max : iMax + idealSpan * 0.5;
  const span = scaleMax - scaleMin || 1;
  const pct = (v) => clamp(((v - scaleMin) / span) * 100, 0, 100);
  return `
    <div class="hp-gauge">
      <div class="hp-gauge-track"></div>
      <div class="hp-gauge-ideal" style="left:${pct(iMin)}%;width:${pct(iMax) - pct(iMin)}%"></div>
      <div class="hp-gauge-marker" style="left:${pct(value)}%;background:${statusColor(attrs.status)}"></div>
    </div>
  `;
}

class HomepoolCard extends HTMLElement {
  static getStubConfig() {
    return {
      type: 'custom:homepool-card',
      title: 'homepool',
      entity_prefix: 'sensor.my_pool',
      installation_id: 1,
      show_buttons: true,
      show_due: true,
      show_header: true,
      show_logo: true,
    };
  }

  setConfig(config) {
    if (!config || !config.entity_prefix) {
      throw new Error('homepool-card: `entity_prefix` is required (e.g. sensor.my_pool)');
    }
    this._config = {
      title: config.title ?? 'homepool',
      entity_prefix: config.entity_prefix,
      installation_id: config.installation_id ?? null,
      show_buttons: config.show_buttons !== false,
      show_due: config.show_due !== false,
      show_header: config.show_header !== false,
      show_logo: config.show_logo !== false,
      parameters: config.parameters ?? null,
      // Quick-add buttons (form toggle + discovered per-task buttons) are shown
      // by default; a `{ <key>: false }` entry hides a specific one.
      quick_add: config.quick_add || {},
    };
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    // null when closed, otherwise which form the shared modal is showing.
    this._modalKind = null;
    this._formMoreOpen = false;
    this._pressed = {};
    this._pressTimers = {};
    // Force a fresh shell so a reconfigure never leaves a stale modal behind.
    this._shellBuilt = false;
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 4;
  }

  _entityId(base) {
    return `${this._config.entity_prefix}_${base}`;
  }

  // The installation's treatment catalog, published by its Treatments sensor
  // (sensor.py's HomepoolTreatmentsSensor). Empty on an older server that has
  // no such entity, which is what hides the "Log treatment" button.
  _treatments() {
    const st = this._hass?.states?.[this._entityId('treatments')];
    const list = st?.attributes?.treatments;
    return Array.isArray(list) ? list : [];
  }

  // Sourced from the pH sensor's `sanitizer` attribute (every installation
  // tracks pH, so it's a reliable anchor) — null on older servers that don't
  // send it yet, in which case the form falls back to showing every field.
  _sanitizer() {
    const hass = this._hass;
    if (!hass) return null;
    const phEntity = hass.states[this._entityId(FIELD_SUFFIXES.ph)];
    return (phEntity && phEntity.attributes && phEntity.attributes.sanitizer) || null;
  }

  _paramEntities() {
    const hass = this._hass;
    if (!hass) return [];
    const fields = this._config.parameters && this._config.parameters.length
      ? this._config.parameters
      : Object.keys(FIELD_SUFFIXES);
    return fields
      .filter((f) => FIELD_SUFFIXES[f])
      .map((f) => ({ field: f, entityId: this._entityId(FIELD_SUFFIXES[f]) }))
      .filter((e) => hass.states[e.entityId] !== undefined);
  }

  _buttonEntities() {
    const quickAdd = this._config.quick_add || {};
    return discoverTaskEntities(this._hass, taskButtonPrefix(this._config.entity_prefix))
      .filter((e) => quickAdd[e.key] !== false);
  }

  _dueEntities() {
    return discoverTaskEntities(this._hass, `${this._config.entity_prefix}_`);
  }

  // Fires the button and flashes a transient "✓" success state so the user
  // gets confirmation the press registered. The pressed state lives on the
  // instance (not the DOM), so it survives the poll-driven card re-renders
  // that happen while the flash is visible.
  _pressButton(entityId) {
    this._hass.callService('button', 'press', { entity_id: entityId });
    this._pressed[entityId] = true;
    if (this._pressTimers[entityId]) clearTimeout(this._pressTimers[entityId]);
    this._pressTimers[entityId] = setTimeout(() => {
      delete this._pressed[entityId];
      delete this._pressTimers[entityId];
      this._renderCard();
    }, 1600);
    this._renderCard();
  }

  // Posts the log_measurement service call. Returns false (no-op) when the
  // card has no installation_id configured, so callers can skip success UI.
  _submitForm(values) {
    if (!this._config.installation_id) return false;
    const data = { installation_id: this._config.installation_id };
    for (const [k, v] of Object.entries(values)) {
      if (v === '' || v === null || v === undefined) continue;
      data[k] = k === 'notes' ? v : parseFloat(v);
    }
    this._hass.callService('homepool', 'log_measurement', data);
    return true;
  }

  // Posts the log_treatment service call. Returns false (no-op) when the card
  // has no installation_id, or when no product was picked, so callers can skip
  // the success UI.
  _submitTreatment(values) {
    if (!this._config.installation_id) return false;
    if (!values.treatment) return false;
    const data = {
      installation_id: this._config.installation_id,
      treatment: values.treatment,
    };
    // Everything else is optional; an empty unit lets the server fall back to
    // the product's own default rather than storing a blank one.
    for (const key of ['qty', 'unit', 'brand', 'notes']) {
      if (values[key]) data[key] = values[key];
    }
    this._hass.callService('homepool', 'log_treatment', data);
    return true;
  }

  // Builds the persistent shell once (style + a card mount + a modal mount),
  // then renders each independently. The card mount is rewritten on every
  // hass poll; the modal mount is only touched on open/close/submit — so an
  // open log-measurement form is never torn down mid-keystroke (issue #32).
  _render() {
    const hass = this._hass;
    const config = this._config;
    if (!hass || !config || !this.shadowRoot) return;
    if (!this._shellBuilt) {
      this.shadowRoot.innerHTML = `${this._styles()}<div id="hp-card-mount"></div><div id="hp-modal-mount"></div>`;
      this._cardMount = this.shadowRoot.getElementById('hp-card-mount');
      this._modalMount = this.shadowRoot.getElementById('hp-modal-mount');
      this._shellBuilt = true;
    }
    // Only the card body is rebuilt on a hass poll. The modal is managed
    // independently by _openModal/_closeModal so an open form is never torn
    // down mid-keystroke (issue #32).
    this._renderCard();
  }

  _renderCard() {
    const hass = this._hass;
    const config = this._config;
    if (!hass || !config || !this._cardMount) return;

    const params = this._paramEntities();
    const buttons = config.show_buttons ? this._buttonEntities() : [];
    const dues = config.show_due ? this._dueEntities() : [];

    if (params.length === 0 && buttons.length === 0) {
      this._cardMount.innerHTML = `
        <ha-card>
          ${config.show_header ? `
            <div class="hp-header">
              ${config.show_logo ? HOMEPOOL_ICON_SVG : ''}
              <span>${config.title}</span>
            </div>
          ` : ''}
          <div class="hp-empty">${t(hass, 'no_data')}</div>
        </ha-card>
      `;
      return;
    }

    const tilesHtml = params.map(({ field, entityId }) => {
      const st = hass.states[entityId];
      const attrs = st.attributes || {};
      const value = parseFloat(st.state);
      const unit = attrs.unit_of_measurement || '';
      const status = attrs.status || null;
      const rail = statusColor(status);
      const idealLine = (attrs.ideal_min !== undefined && attrs.ideal_max !== undefined)
        ? `<div class="hp-ideal">${t(hass, 'ideal')} ${fmtValue(attrs.ideal_min)}–${fmtValue(attrs.ideal_max)}</div>`
        : '';
      const gauge = gaugeHtml(value, attrs);
      const da = daysAgo(attrs.date);
      const measuredLine = da === null ? ''
        : `<div class="hp-measured">${
            da === 0 ? t(hass, 'measured_today')
            : da === 1 ? t(hass, 'measured_yesterday')
            : t(hass, 'measured_days_ago', da)
          }</div>`;
      return `
        <div class="hp-tile${config.installation_id ? ' hp-tile-tappable' : ''}" data-field="${field}" style="--hp-rail:${rail}">
          <div class="hp-tile-top">
            <span class="hp-label">${escapeHtml(tileLabel(attrs, field, config.title))}</span>
            <span class="hp-tile-top-right">
              <button class="hp-tile-info" data-info="${entityId}" title="${t(hass, 'history')}" aria-label="${t(hass, 'history')}">${CHART_ICON_SVG}</button>
              ${status ? `<span class="hp-dot" style="background:${rail}"></span>` : ''}
            </span>
          </div>
          <div class="hp-value-row">
            <span class="hp-value">${fmtValue(value)}</span>
            ${unit ? `<span class="hp-unit">${unit}</span>` : ''}
          </div>
          ${gauge}
          ${idealLine}
          ${measuredLine}
        </div>
      `;
    }).join('');

    const dueHtml = dues.map(({ label, entityId }) => {
      const st = hass.states[entityId];
      const days = st.state === 'unavailable' || st.state === 'unknown' ? null : parseFloat(st.state);
      if (days === null || Number.isNaN(days)) return '';
      const overdue = days < 0;
      const dueSoon = days >= 0 && days <= 3;
      const chipClass = overdue ? 'hp-chip-danger' : dueSoon ? 'hp-chip-warn' : 'hp-chip-neutral';
      const text = overdue ? t(hass, 'due_overdue', Math.abs(Math.round(days)))
        : days === 0 ? t(hass, 'due_today')
        : t(hass, 'due_in', Math.round(days));
      return `<span class="hp-chip ${chipClass}">${escapeHtml(label)}: ${text}</span>`;
    }).join('');

    const showFormToggle = config.installation_id && config.quick_add?.[FORM_TOGGLE_KEY] !== false;
    const formToggleHtml = showFormToggle
      ? `<button class="hp-btn hp-btn-accent" id="hp-form-toggle">${t(hass, 'log_measurement')}</button>`
      : '';
    // Hidden when the server predates the treatment catalog: without the
    // Treatments sensor there is nothing to offer in the product picker.
    const showTreatmentToggle = config.installation_id
      && config.quick_add?.[TREATMENT_TOGGLE_KEY] !== false
      && this._treatments().length > 0;
    const treatmentToggleHtml = showTreatmentToggle
      ? `<button class="hp-btn hp-btn-accent" id="hp-treatment-toggle">${t(hass, 'log_treatment')}</button>`
      : '';
    const taskButtonsHtml = buttons.map((btn) => {
      const pressed = this._pressed[btn.entityId];
      return `<button class="hp-btn${pressed ? ' hp-btn-success' : ''}" data-entity="${escapeHtml(btn.entityId)}">${
        pressed ? `✓ ${t(hass, 'logged')}` : escapeHtml(btn.label)
      }</button>`;
    }).join('');
    const buttonsHtml = formToggleHtml + treatmentToggleHtml + taskButtonsHtml;

    this._cardMount.innerHTML = `
      <ha-card>
        ${config.show_header ? `
          <div class="hp-header">
            ${config.show_logo ? HOMEPOOL_ICON_SVG : ''}
            <span>${config.title}</span>
          </div>
        ` : ''}
        ${dueHtml ? `<div class="hp-due-row">${dueHtml}</div>` : ''}
        ${params.length ? `<div class="hp-grid">${tilesHtml}</div>` : ''}
        ${buttons.length || showFormToggle || showTreatmentToggle ? `
          <div class="hp-section-label">${t(hass, 'quick_add')}</div>
          <div class="hp-buttons">
            ${buttonsHtml}
          </div>
        ` : ''}
      </ha-card>
    `;

    this._cardMount.querySelectorAll('.hp-btn[data-entity]').forEach((btn) => {
      btn.addEventListener('click', () => this._pressButton(btn.dataset.entity));
    });
    const toggle = this._cardMount.querySelector('#hp-form-toggle');
    if (toggle) toggle.addEventListener('click', () => this._openModal());
    const treatmentToggle = this._cardMount.querySelector('#hp-treatment-toggle');
    if (treatmentToggle) treatmentToggle.addEventListener('click', () => this._openTreatmentModal());
    // A tile's chart icon opens HA's native more-info dialog for that sensor;
    // tapping the tile body opens the log modal focused on the field.
    this._cardMount.querySelectorAll('.hp-tile-info[data-info]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        this._openMoreInfo(btn.dataset.info);
      });
    });
    if (config.installation_id) {
      this._cardMount.querySelectorAll('.hp-tile[data-field]').forEach((tile) => {
        tile.addEventListener('click', () => this._openModal(tile.dataset.field));
      });
    }
  }

  _openMoreInfo(entityId) {
    this.dispatchEvent(new CustomEvent('hass-more-info', {
      detail: { entityId },
      bubbles: true,
      composed: true,
    }));
  }

  // Opens the log-measurement modal, optionally focused on `field` (expanding
  // "more fields" first if that field isn't in the sanitizer's primary set).
  _openModal(field) {
    if (!this._config.installation_id) return;
    this._modalKind = 'measurement';
    if (field) {
      const primary = SANITIZER_FORM_FIELDS[this._sanitizer()] || DEFAULT_FORM_FIELDS;
      if (!primary.includes(field)) this._formMoreOpen = true;
    }
    this._renderModal();
    const formEl = this._modalMount.querySelector('#hp-form');
    const target = (field && formEl?.elements[field]) || formEl?.querySelector('input');
    if (target) target.focus();
  }

  // Same modal shell, different form: which product went in and how much.
  _openTreatmentModal() {
    if (!this._config.installation_id) return;
    this._modalKind = 'treatment';
    this._renderModal();
    const amount = this._modalMount.querySelector('#hp-form input[name="qty"]');
    if (amount) amount.focus();
  }

  _closeModal() {
    this._modalKind = null;
    this._formMoreOpen = false;
    this._renderModal();
  }

  _renderModal() {
    if (!this._modalMount) return;
    if (!this._modalKind) {
      this._modalMount.innerHTML = '';
      return;
    }
    const hass = this._hass;
    const isTreatment = this._modalKind === 'treatment';
    this._modalMount.innerHTML = `
      <div class="hp-modal-backdrop" id="hp-modal-backdrop" tabindex="-1">
        <div class="hp-modal" role="dialog" aria-modal="true">
          <div class="hp-modal-header">
            <span>${t(hass, isTreatment ? 'log_treatment' : 'log_measurement')}</span>
            <button class="hp-modal-close" id="hp-modal-close" aria-label="${t(hass, 'cancel')}">✕</button>
          </div>
          ${isTreatment ? this._treatmentFormHtml(hass) : this._formHtml(hass, this._sanitizer())}
        </div>
      </div>
    `;

    const backdrop = this._modalMount.querySelector('#hp-modal-backdrop');
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) this._closeModal(); });
    backdrop.addEventListener('keydown', (e) => { if (e.key === 'Escape') this._closeModal(); });
    this._modalMount.querySelector('#hp-modal-close').addEventListener('click', () => this._closeModal());

    const formEl = this._modalMount.querySelector('#hp-form');
    formEl.addEventListener('submit', (e) => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(formEl).entries());
      const submitted = isTreatment ? this._submitTreatment(data) : this._submitForm(data);
      if (submitted) this._showModalSuccess();
      else this._closeModal();
    });
    this._modalMount.querySelector('#hp-form-cancel').addEventListener('click', () => this._closeModal());
    // Picking a product re-seeds the unit, so choosing bromine tablets doesn't
    // leave you dosing grams — unless the unit was already changed by hand.
    const productSelect = this._modalMount.querySelector('#hp-treatment-product');
    if (productSelect) {
      const unitSelect = this._modalMount.querySelector('#hp-treatment-unit');
      productSelect.addEventListener('change', () => {
        if (!unitSelect || unitSelect.dataset.touched === '1') return;
        const picked = this._treatments().find((p) => p.key === productSelect.value);
        if (picked?.default_unit) unitSelect.value = picked.default_unit;
      });
      if (unitSelect) {
        unitSelect.addEventListener('change', () => { unitSelect.dataset.touched = '1'; });
      }
    }
    // "More fields" just reveals the pre-rendered section — no rebuild, so
    // values already typed into the primary fields are never lost.
    const moreToggle = this._modalMount.querySelector('#hp-form-more-toggle');
    if (moreToggle) {
      moreToggle.addEventListener('click', () => {
        this._formMoreOpen = !this._formMoreOpen;
        const moreEl = this._modalMount.querySelector('#hp-form-more');
        if (moreEl) moreEl.hidden = !this._formMoreOpen;
        moreToggle.textContent = `${this._formMoreOpen ? '−' : '+'} ${t(hass, 'more_fields')}`;
      });
    }
  }

  _showModalSuccess() {
    const modal = this._modalMount.querySelector('.hp-modal');
    if (modal) modal.innerHTML = `<div class="hp-modal-success">✓ ${t(this._hass, 'logged')}</div>`;
    setTimeout(() => this._closeModal(), 1100);
  }

  // The "more fields" block is always rendered (just hidden when collapsed) so
  // toggling it never rebuilds the form and never drops in-progress input.
  _formHtml(hass, sanitizer) {
    const primary = SANITIZER_FORM_FIELDS[sanitizer] || DEFAULT_FORM_FIELDS;
    const more = Object.keys(FORM_FIELD_LABELS).filter((f) => !primary.includes(f));
    const fieldInput = (name) => `
      <label class="hp-form-field">
        <span>${FORM_FIELD_LABELS[name]}</span>
        <input name="${name}" type="number" step="0.1" inputmode="decimal" />
      </label>
    `;
    return `
      <form id="hp-form" class="hp-form">
        <div class="hp-form-grid">
          ${primary.map(fieldInput).join('')}
        </div>
        ${more.length ? `
          <button type="button" id="hp-form-more-toggle" class="hp-form-more-toggle">
            ${this._formMoreOpen ? '−' : '+'} ${t(hass, 'more_fields')}
          </button>
          <div class="hp-form-grid hp-form-more" id="hp-form-more" ${this._formMoreOpen ? '' : 'hidden'}>
            ${more.map(fieldInput).join('')}
            <label class="hp-form-field hp-form-field-wide">
              <span>${t(hass, 'notes')}</span>
              <input name="notes" type="text" />
            </label>
          </div>
        ` : ''}
        <div class="hp-form-actions">
          <button type="button" id="hp-form-cancel" class="hp-btn">${t(hass, 'cancel')}</button>
          <button type="submit" class="hp-btn hp-btn-accent">${t(hass, 'save')}</button>
        </div>
      </form>
    `;
  }

  // Which product, how much, and optionally the brand you actually bought.
  // Products come from the Treatments sensor, so the picker always matches the
  // installation's own catalog.
  _treatmentFormHtml(hass) {
    const products = this._treatments();
    if (!products.length) {
      return `
        <form id="hp-form" class="hp-form">
          <div class="hp-form-empty">${t(hass, 'no_treatments')}</div>
          <div class="hp-form-actions">
            <button type="button" id="hp-form-cancel" class="hp-btn">${t(hass, 'cancel')}</button>
          </div>
        </form>
      `;
    }
    const first = products[0];
    // A product's own unit may not be in the standard list (a custom product
    // configured through the API); keep it selectable rather than silently
    // rewriting it.
    const units = [...new Set([...products.map((p) => p.default_unit).filter(Boolean), ...TREATMENT_UNITS])];
    return `
      <form id="hp-form" class="hp-form">
        <div class="hp-form-grid">
          <label class="hp-form-field hp-form-field-wide">
            <span>${t(hass, 'treatment_product')}</span>
            <select name="treatment" id="hp-treatment-product">
              ${products.map((p) => `<option value="${escapeHtml(p.key)}">${escapeHtml(p.label)}</option>`).join('')}
            </select>
          </label>
          <label class="hp-form-field">
            <span>${t(hass, 'treatment_amount')}</span>
            <input name="qty" type="number" step="any" inputmode="decimal" />
          </label>
          <label class="hp-form-field">
            <span>${t(hass, 'treatment_unit')}</span>
            <select name="unit" id="hp-treatment-unit">
              ${units.map((u) => `<option value="${escapeHtml(u)}"${u === first.default_unit ? ' selected' : ''}>${escapeHtml(u)}</option>`).join('')}
            </select>
          </label>
          <label class="hp-form-field hp-form-field-wide">
            <span>${t(hass, 'treatment_brand')}</span>
            <input name="brand" type="text" />
          </label>
          <label class="hp-form-field hp-form-field-wide">
            <span>${t(hass, 'notes')}</span>
            <input name="notes" type="text" />
          </label>
        </div>
        <div class="hp-form-actions">
          <button type="button" id="hp-form-cancel" class="hp-btn">${t(hass, 'cancel')}</button>
          <button type="submit" class="hp-btn hp-btn-accent">${t(hass, 'save')}</button>
        </div>
      </form>
    `;
  }

  _styles() {
    return `
      <style>
        :host {
          --hp-bg: var(--card-background-color, #11161D);
          --hp-bg-2: var(--secondary-background-color, #0D1218);
          --hp-border: var(--divider-color, #1E2630);
          --hp-text: var(--primary-text-color, #E6EDF3);
          --hp-text-muted: var(--secondary-text-color, #8B98A9);
          --hp-accent: var(--accent-color, #22D3EE);
        }
        ha-card {
          background: var(--hp-bg);
          color: var(--hp-text);
          padding: 12px 14px 14px;
          font-family: var(--paper-font-body1_-_font-family, sans-serif);
        }
        .hp-header {
          font-size: 15px;
          font-weight: 700;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .hp-logo {
          width: 20px;
          height: 20px;
          flex-shrink: 0;
          border-radius: 5px;
        }
        .hp-empty {
          color: var(--hp-text-muted);
          font-size: 13px;
          padding: 8px 0;
        }
        .hp-due-row {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
          margin-bottom: 10px;
        }
        .hp-chip {
          font-size: 11px;
          font-weight: 600;
          padding: 3px 8px;
          border-radius: 999px;
          font-family: monospace;
        }
        .hp-chip-neutral { background: var(--hp-bg-2); color: var(--hp-text-muted); }
        .hp-chip-warn { background: rgba(217,161,59,0.15); color: #D9A13B; }
        .hp-chip-danger { background: rgba(229,100,95,0.15); color: #E5645F; }
        .hp-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
          gap: 8px;
          margin-bottom: 8px;
        }
        .hp-tile {
          position: relative;
          background: var(--hp-bg-2);
          border: 1px solid var(--hp-border);
          border-radius: 10px;
          padding: 8px 10px 8px 12px;
          overflow: hidden;
        }
        .hp-tile::before {
          content: '';
          position: absolute;
          left: 0; top: 0; bottom: 0;
          width: 3px;
          background: var(--hp-rail, transparent);
        }
        .hp-tile-tappable {
          cursor: pointer;
        }
        .hp-tile-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .hp-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--hp-text-muted);
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        .hp-dot {
          width: 6px; height: 6px;
          border-radius: 50%;
          flex-shrink: 0;
        }
        .hp-value-row {
          display: flex;
          align-items: baseline;
          gap: 3px;
          margin: 4px 0 2px;
        }
        .hp-value {
          font-family: monospace;
          font-size: 19px;
          font-weight: 600;
        }
        .hp-unit {
          font-family: monospace;
          font-size: 10px;
          color: var(--hp-text-muted);
        }
        .hp-ideal, .hp-measured {
          font-family: monospace;
          font-size: 9px;
          color: var(--hp-text-muted);
        }
        .hp-gauge {
          position: relative;
          height: 5px;
          margin: 5px 0 4px;
        }
        .hp-gauge-track {
          position: absolute;
          inset: 0;
          border-radius: 3px;
          background: var(--hp-border);
        }
        .hp-gauge-ideal {
          position: absolute;
          top: 0;
          bottom: 0;
          border-radius: 3px;
          background: rgba(63, 182, 139, 0.35);
        }
        .hp-gauge-marker {
          position: absolute;
          top: -2px;
          width: 2px;
          height: 9px;
          border-radius: 1px;
          transform: translateX(-1px);
        }
        .hp-section-label {
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--hp-text-muted);
          margin: 10px 0 6px;
        }
        .hp-buttons {
          display: flex;
          gap: 6px;
          flex-wrap: wrap;
        }
        .hp-btn {
          font-size: 12px;
          font-weight: 500;
          padding: 6px 10px;
          border-radius: 6px;
          border: 1px solid var(--hp-border);
          background: var(--hp-bg-2);
          color: var(--hp-text);
          cursor: pointer;
        }
        .hp-btn-accent {
          background: var(--hp-accent);
          color: #06181D;
          border: none;
          font-weight: 700;
        }
        .hp-btn-success {
          background: var(--homepool-ok, #3FB68B);
          color: #06181D;
          border: none;
          font-weight: 700;
        }
        .hp-tile-top-right {
          display: flex;
          align-items: center;
          gap: 5px;
          flex-shrink: 0;
        }
        .hp-tile-info {
          display: inline-flex;
          padding: 0;
          border: none;
          background: none;
          color: var(--hp-text-muted);
          cursor: pointer;
          opacity: 0.65;
        }
        .hp-tile-info:hover { opacity: 1; color: var(--hp-accent); }
        .hp-tile-info svg { width: 13px; height: 13px; display: block; }
        .hp-modal-backdrop {
          position: fixed;
          inset: 0;
          z-index: 999;
          background: rgba(0, 0, 0, 0.55);
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 16px;
        }
        .hp-modal {
          background: var(--hp-bg);
          border: 1px solid var(--hp-border);
          border-radius: 14px;
          padding: 14px 16px 16px;
          width: 100%;
          max-width: 420px;
          max-height: 90vh;
          overflow-y: auto;
          box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
        }
        .hp-modal-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          font-size: 15px;
          font-weight: 700;
        }
        .hp-modal-close {
          background: none;
          border: none;
          color: var(--hp-text-muted);
          font-size: 16px;
          line-height: 1;
          cursor: pointer;
          padding: 2px 4px;
        }
        .hp-modal-close:hover { color: var(--hp-text); }
        .hp-modal-success {
          padding: 28px 8px;
          text-align: center;
          font-size: 18px;
          font-weight: 700;
          color: var(--homepool-ok, #3FB68B);
        }
        .hp-form {
          margin-top: 10px;
          padding-top: 10px;
          border-top: 1px solid var(--hp-border);
        }
        .hp-form-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(70px, 1fr));
          gap: 6px;
          margin-bottom: 10px;
        }
        .hp-form-field {
          display: flex;
          flex-direction: column;
          gap: 3px;
          font-size: 10px;
          color: var(--hp-text-muted);
        }
        .hp-form-field input,
        .hp-form-field select {
          font-family: monospace;
          font-size: 13px;
          padding: 5px 6px;
          border-radius: 6px;
          border: 1px solid var(--hp-border);
          background: var(--hp-bg-2);
          color: var(--hp-text);
        }
        .hp-form-field-wide {
          grid-column: 1 / -1;
        }
        .hp-form-empty {
          font-size: 12px;
          color: var(--hp-text-muted);
          padding: 4px 0 8px;
        }
        .hp-form-more[hidden] {
          /* The [hidden] attribute must win over .hp-form-grid's display:grid,
             which otherwise outranks the UA [hidden]{display:none} rule and
             leaves the collapsible "more fields" block permanently visible. */
          display: none;
        }
        .hp-form-more-toggle {
          background: none;
          border: none;
          color: var(--hp-accent);
          font-size: 11px;
          font-weight: 600;
          cursor: pointer;
          padding: 0 0 8px;
        }
        .hp-form-actions {
          display: flex;
          justify-content: flex-end;
          gap: 8px;
        }
      </style>
    `;
  }
}

class HomepoolCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._buildOrSync();
  }

  set hass(hass) {
    this._hass = hass;
    this._buildOrSync();
  }

  // Builds the form DOM exactly once. Every later call (from our own
  // config-changed round trip, or a `hass` update) only pushes values into
  // the existing nodes — rebuilding via innerHTML on every keystroke is what
  // destroyed the focused <input> and reset the cursor on every character.
  _buildOrSync() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    if (!this._built) {
      this._build();
      this._built = true;
    }
    this._sync();
  }

  _build() {
    // Maintenance quick-add buttons are discovered from the task entities, so
    // the editor's toggle chips reflect the installation's configured tasks
    // (with the "Log measurement" form toggle always available). Discovery
    // needs both hass and a configured entity_prefix; before then only the
    // form-toggle chip shows, and the rest appear when the editor is reopened.
    const editorPrefix = this._config && this._config.entity_prefix;
    const taskChips = editorPrefix
      ? discoverTaskEntities(this._hass, taskButtonPrefix(editorPrefix))
      : [];
    const quickAddChipsHtml = [
      `<button type="button" class="chip" data-quick-add="${FORM_TOGGLE_KEY}">${STRINGS.en.log_measurement}</button>`,
      `<button type="button" class="chip" data-quick-add="${TREATMENT_TOGGLE_KEY}">${STRINGS.en.log_treatment}</button>`,
      ...taskChips.map((tb) => `<button type="button" class="chip" data-quick-add="${escapeHtml(tb.key)}">${escapeHtml(tb.label)}</button>`),
    ].join('');
    const parameterChipsHtml = Object.keys(FIELD_SUFFIXES)
      .map((key) => `<button type="button" class="chip" data-parameter="${key}">${FORM_FIELD_LABELS[key] || key}</button>`)
      .join('');

    this.shadowRoot.innerHTML = `
      <style>
        .row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
        label { font-size: 12px; font-weight: 600; }
        input { padding: 6px 8px; font-size: 13px; }
        select { padding: 6px 8px; font-size: 13px; }
        .hint { font-size: 11px; font-weight: 400; color: var(--secondary-text-color); }
        .chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
        .chip {
          font-size: 12px;
          font-weight: 500;
          padding: 5px 10px;
          border-radius: 999px;
          border: 1px solid var(--divider-color, #ccc);
          background: transparent;
          color: var(--secondary-text-color);
          cursor: pointer;
        }
        .chip.active {
          background: var(--accent-color, #22D3EE);
          color: #06181D;
          border-color: transparent;
          font-weight: 700;
        }
      </style>
      <div class="row">
        <label>Title</label>
        <input id="title" />
      </div>
      <div class="row">
        <label>Pool / Spa <span class="hint">(pick an installation — fills in the fields below)</span></label>
        <select id="installation-picker"></select>
      </div>
      <div class="row">
        <label>Entity prefix (e.g. sensor.my_pool)</label>
        <input id="entity_prefix" />
      </div>
      <div class="row">
        <label>Installation ID (for the log-measurement form)</label>
        <input id="installation_id" type="number" />
      </div>
      <div class="row">
        <label><input id="show_header" type="checkbox" /> Show title bar</label>
      </div>
      <div class="row">
        <label><input id="show_logo" type="checkbox" /> Show logo</label>
      </div>
      <div class="row">
        <label><input id="show_buttons" type="checkbox" /> Show quick-add buttons</label>
      </div>
      <div class="row">
        <label><input id="show_due" type="checkbox" /> Show due chips</label>
      </div>
      <div class="row">
        <label>Quick add actions</label>
        <div class="chip-row" id="quick-add-chips">${quickAddChipsHtml}</div>
      </div>
      <div class="row">
        <label>Parameters shown</label>
        <div class="chip-row" id="parameter-chips">${parameterChipsHtml}</div>
      </div>
    `;

    this.shadowRoot.getElementById('installation-picker')
      .addEventListener('change', (e) => this._onPickInstallation(e.target.value));

    ['title', 'entity_prefix'].forEach((id) => {
      this.shadowRoot.getElementById(id).addEventListener('input', (e) => this._update(id, e.target.value));
    });
    this.shadowRoot.getElementById('installation_id').addEventListener('input', (e) => {
      this._update('installation_id', e.target.value ? parseInt(e.target.value, 10) : null);
    });
    ['show_header', 'show_logo', 'show_buttons', 'show_due'].forEach((id) => {
      this.shadowRoot.getElementById(id).addEventListener('change', (e) => this._update(id, e.target.checked));
    });
    this.shadowRoot.querySelectorAll('#quick-add-chips .chip').forEach((chip) => {
      chip.addEventListener('click', () => this._toggleQuickAdd(chip.dataset.quickAdd));
    });
    this.shadowRoot.querySelectorAll('#parameter-chips .chip').forEach((chip) => {
      chip.addEventListener('click', () => this._toggleParameter(chip.dataset.parameter));
    });
  }

  _sync() {
    const c = this._config || {};
    const active = this.shadowRoot.activeElement;
    const syncInput = (id, value) => {
      const el = this.shadowRoot.getElementById(id);
      if (el && el !== active) el.value = value ?? '';
    };
    syncInput('title', c.title);
    syncInput('entity_prefix', c.entity_prefix);
    syncInput('installation_id', c.installation_id ?? '');

    const showHeader = this.shadowRoot.getElementById('show_header');
    if (showHeader && showHeader !== active) showHeader.checked = c.show_header !== false;
    const showLogo = this.shadowRoot.getElementById('show_logo');
    if (showLogo && showLogo !== active) showLogo.checked = c.show_logo !== false;
    const showButtons = this.shadowRoot.getElementById('show_buttons');
    if (showButtons && showButtons !== active) showButtons.checked = c.show_buttons !== false;
    const showDue = this.shadowRoot.getElementById('show_due');
    if (showDue && showDue !== active) showDue.checked = c.show_due !== false;

    // Chips aren't focusable text inputs with in-progress typed state, so
    // it's safe to just re-sync their visual state unconditionally.
    const quickAdd = c.quick_add || {};
    this.shadowRoot.querySelectorAll('#quick-add-chips .chip').forEach((chip) => {
      chip.classList.toggle('active', quickAdd[chip.dataset.quickAdd] !== false);
    });
    const activeParams = c.parameters && c.parameters.length ? c.parameters : Object.keys(FIELD_SUFFIXES);
    this.shadowRoot.querySelectorAll('#parameter-chips .chip').forEach((chip) => {
      chip.classList.toggle('active', activeParams.includes(chip.dataset.parameter));
    });

    const picker = this.shadowRoot.getElementById('installation-picker');
    if (picker) {
      const installs = discoverInstallations(this._hass);
      // Rebuild the <option> set only when the discovered installations change
      // (guarded by a deviceId:name signature) so a dropdown the user has open
      // isn't clobbered on every `hass` tick.
      const signature = installs.map((i) => `${i.deviceId}:${i.name}`).join('|');
      if (this._installSig !== signature) {
        this._installSig = signature;
        picker.textContent = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '— Select pool / spa —';
        picker.appendChild(placeholder);
        installs.forEach((inst) => {
          const opt = document.createElement('option');
          opt.value = inst.deviceId;
          opt.textContent = inst.name; // textContent, never innerHTML — device names are untrusted
          picker.appendChild(opt);
        });
      }
      const selected = installs.find((i) => i.prefix === c.entity_prefix);
      picker.value = selected ? selected.deviceId : '';
    }
  }

  _toggleQuickAdd(key) {
    const quickAdd = { ...(this._config.quick_add || {}) };
    quickAdd[key] = quickAdd[key] === false;
    this._config = { ...this._config, quick_add: quickAdd };
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config } }));
    this._sync();
  }

  _toggleParameter(key) {
    const current = this._config.parameters && this._config.parameters.length
      ? this._config.parameters
      : Object.keys(FIELD_SUFFIXES);
    const next = current.includes(key) ? current.filter((f) => f !== key) : [...current, key];
    this._config = { ...this._config, parameters: next };
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config } }));
    this._sync();
  }

  // Picking an installation from the dropdown sets both entity_prefix and
  // installation_id from the discovered entry (see discoverInstallations), so
  // the user never has to type either by hand.
  _onPickInstallation(deviceId) {
    if (!deviceId) return;
    const inst = discoverInstallations(this._hass).find((i) => i.deviceId === deviceId);
    if (!inst) return;
    const updates = { entity_prefix: inst.prefix };
    if (inst.installationId !== undefined) updates.installation_id = inst.installationId;
    this._config = { ...this._config, ...updates };
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config } }));
    this._sync();
  }

  _update(key, value) {
    this._config = { ...this._config, [key]: value };
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config } }));
  }
}

// ── History table card ───────────────────────────────────────────────────

const HISTORY_KINDS = ['measurement', 'treatment', 'maintenance'];

function fmtHistoryDate(hass, dateStr) {
  if (!dateStr) return '';
  const lang = (hass && hass.language) || 'en';
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString(lang, { month: 'short', day: 'numeric', year: 'numeric' });
}

// A compact, read-only log: reads the homepool history sensor's `entries`
// attribute (measurements, treatments, maintenance — see sensor.py's
// HomepoolHistorySensor) and renders the most recent `max_items` as a table.
class HomepoolHistoryCard extends HTMLElement {
  static getStubConfig() {
    return {
      type: 'custom:homepool-history-card',
      title: 'homepool',
      entity_prefix: 'sensor.my_pool',
      max_items: 20,
      show_header: true,
      show_logo: true,
    };
  }

  setConfig(config) {
    if (!config || (!config.entity && !config.entity_prefix)) {
      throw new Error('homepool-history-card: `entity` or `entity_prefix` is required');
    }
    this._config = {
      title: config.title ?? 'homepool',
      entity: config.entity ?? null,
      entity_prefix: config.entity_prefix ?? null,
      max_items: config.max_items ?? 20,
      types: (config.types && config.types.length) ? config.types : null,
      show_header: config.show_header !== false,
      show_logo: config.show_logo !== false,
    };
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  getCardSize() {
    return 4;
  }

  _historyEntityId() {
    const c = this._config;
    return c.entity || (c.entity_prefix ? `${c.entity_prefix}_history` : null);
  }

  _entries() {
    const hass = this._hass;
    const id = this._historyEntityId();
    const st = id && hass && hass.states[id];
    const entries = (st && st.attributes && st.attributes.entries) || [];
    const types = this._config.types;
    const filtered = types ? entries.filter((e) => types.includes(e.kind)) : entries;
    return filtered.slice(0, this._config.max_items);
  }

  _render() {
    const hass = this._hass;
    const config = this._config;
    if (!hass || !config || !this.shadowRoot) return;
    const entries = this._entries();

    const rowsHtml = entries.map((e) => {
      let detail;
      if (e.kind === 'measurement') {
        const pills = Object.keys(FORM_FIELD_LABELS)
          .filter((f) => e[f] !== undefined && e[f] !== null)
          .map((f) => `<span class="hp-hist-pill">${FORM_FIELD_LABELS[f]} ${fmtValue(e[f])}</span>`)
          .join('');
        detail = pills || escapeHtml(e.label || '');
      } else if (e.kind === 'treatment') {
        const amount = e.qty ? ` — ${e.qty}${e.unit ? ` ${e.unit}` : ''}` : '';
        const brand = e.brand ? ` · ${e.brand}` : '';
        detail = escapeHtml(`${e.label || ''}${amount}${brand}`);
      } else {
        detail = escapeHtml(e.label || '');
      }
      return `
        <tr>
          <td class="hp-hist-date">${fmtHistoryDate(hass, e.date)}</td>
          <td><span class="hp-chip hp-kind-${e.kind}">${t(hass, `kind_${e.kind}`)}</span></td>
          <td class="hp-hist-detail">
            <div class="hp-hist-main">${detail}</div>
            ${e.notes && e.kind !== 'measurement' ? `<div class="hp-hist-notes">${escapeHtml(e.notes)}</div>` : ''}
          </td>
        </tr>
      `;
    }).join('');

    this.shadowRoot.innerHTML = `
      ${this._styles()}
      <ha-card>
        ${config.show_header ? `
          <div class="hp-header">
            ${config.show_logo ? HOMEPOOL_ICON_SVG : ''}
            <span>${config.title} · ${t(hass, 'history')}</span>
          </div>
        ` : ''}
        ${entries.length ? `
          <div class="hp-hist-wrap">
            <table class="hp-hist">
              <thead>
                <tr>
                  <th>${t(hass, 'col_date')}</th>
                  <th>${t(hass, 'col_type')}</th>
                  <th>${t(hass, 'col_detail')}</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        ` : `<div class="hp-empty">${t(hass, 'no_history')}</div>`}
      </ha-card>
    `;
  }

  _styles() {
    return `
      <style>
        :host {
          --hp-bg: var(--card-background-color, #11161D);
          --hp-bg-2: var(--secondary-background-color, #0D1218);
          --hp-border: var(--divider-color, #1E2630);
          --hp-text: var(--primary-text-color, #E6EDF3);
          --hp-text-muted: var(--secondary-text-color, #8B98A9);
          --hp-accent: var(--accent-color, #22D3EE);
        }
        ha-card {
          background: var(--hp-bg);
          color: var(--hp-text);
          padding: 12px 14px 14px;
          font-family: var(--paper-font-body1_-_font-family, sans-serif);
        }
        .hp-header {
          font-size: 15px;
          font-weight: 700;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .hp-logo { width: 20px; height: 20px; flex-shrink: 0; border-radius: 5px; }
        .hp-empty { color: var(--hp-text-muted); font-size: 13px; padding: 8px 0; }
        .hp-hist-wrap { overflow-x: auto; }
        table.hp-hist { width: 100%; border-collapse: collapse; }
        .hp-hist th {
          text-align: left;
          font-size: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
          color: var(--hp-text-muted);
          font-weight: 600;
          padding: 4px 6px;
          border-bottom: 1px solid var(--hp-border);
        }
        .hp-hist td {
          padding: 6px 6px;
          border-bottom: 1px solid var(--hp-border);
          vertical-align: top;
          font-size: 12px;
        }
        .hp-hist tr:last-child td { border-bottom: none; }
        .hp-hist-date {
          white-space: nowrap;
          font-family: monospace;
          font-size: 11px;
          color: var(--hp-text-muted);
        }
        .hp-chip {
          display: inline-block;
          font-size: 10px;
          font-weight: 600;
          padding: 2px 7px;
          border-radius: 999px;
          white-space: nowrap;
        }
        .hp-kind-measurement { background: rgba(34, 211, 238, 0.15); color: var(--hp-accent); }
        .hp-kind-treatment { background: rgba(63, 182, 139, 0.15); color: #3FB68B; }
        .hp-kind-maintenance { background: var(--hp-bg-2); color: var(--hp-text-muted); }
        .hp-hist-pill {
          display: inline-block;
          font-family: monospace;
          font-size: 11px;
          background: var(--hp-bg-2);
          border: 1px solid var(--hp-border);
          border-radius: 4px;
          padding: 1px 5px;
          margin: 1px 3px 1px 0;
        }
        .hp-hist-notes { font-size: 11px; color: var(--hp-text-muted); margin-top: 2px; }
      </style>
    `;
  }
}

class HomepoolHistoryCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
    this._buildOrSync();
  }

  set hass(hass) {
    this._hass = hass;
    this._buildOrSync();
  }

  _buildOrSync() {
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    if (!this._built) {
      this._build();
      this._built = true;
    }
    this._sync();
  }

  _build() {
    const typeChipsHtml = HISTORY_KINDS
      .map((k) => `<button type="button" class="chip" data-type="${k}">${k.charAt(0).toUpperCase() + k.slice(1)}</button>`)
      .join('');

    this.shadowRoot.innerHTML = `
      <style>
        .row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
        label { font-size: 12px; font-weight: 600; }
        input { padding: 6px 8px; font-size: 13px; }
        select { padding: 6px 8px; font-size: 13px; }
        .hint { font-size: 11px; font-weight: 400; color: var(--secondary-text-color); }
        .chip-row { display: flex; flex-wrap: wrap; gap: 6px; }
        .chip {
          font-size: 12px;
          font-weight: 500;
          padding: 5px 10px;
          border-radius: 999px;
          border: 1px solid var(--divider-color, #ccc);
          background: transparent;
          color: var(--secondary-text-color);
          cursor: pointer;
        }
        .chip.active {
          background: var(--accent-color, #22D3EE);
          color: #06181D;
          border-color: transparent;
          font-weight: 700;
        }
      </style>
      <div class="row">
        <label>Title</label>
        <input id="title" />
      </div>
      <div class="row">
        <label>Pool / Spa <span class="hint">(pick an installation — fills in the entity prefix)</span></label>
        <select id="installation-picker"></select>
      </div>
      <div class="row">
        <label>Entity prefix (e.g. sensor.my_pool)</label>
        <input id="entity_prefix" />
      </div>
      <div class="row">
        <label>Max items</label>
        <input id="max_items" type="number" min="1" />
      </div>
      <div class="row">
        <label><input id="show_header" type="checkbox" /> Show title bar</label>
      </div>
      <div class="row">
        <label><input id="show_logo" type="checkbox" /> Show logo</label>
      </div>
      <div class="row">
        <label>History types shown</label>
        <div class="chip-row" id="type-chips">${typeChipsHtml}</div>
      </div>
    `;

    this.shadowRoot.getElementById('installation-picker')
      .addEventListener('change', (e) => this._onPickInstallation(e.target.value));

    this.shadowRoot.getElementById('title').addEventListener('input', (e) => this._update('title', e.target.value));
    this.shadowRoot.getElementById('entity_prefix').addEventListener('input', (e) => this._update('entity_prefix', e.target.value));
    this.shadowRoot.getElementById('max_items').addEventListener('input', (e) => {
      this._update('max_items', e.target.value ? parseInt(e.target.value, 10) : 20);
    });
    ['show_header', 'show_logo'].forEach((id) => {
      this.shadowRoot.getElementById(id).addEventListener('change', (e) => this._update(id, e.target.checked));
    });
    this.shadowRoot.querySelectorAll('#type-chips .chip').forEach((chip) => {
      chip.addEventListener('click', () => this._toggleType(chip.dataset.type));
    });
  }

  _sync() {
    const c = this._config || {};
    const active = this.shadowRoot.activeElement;
    const syncInput = (id, value) => {
      const el = this.shadowRoot.getElementById(id);
      if (el && el !== active) el.value = value ?? '';
    };
    syncInput('title', c.title);
    syncInput('entity_prefix', c.entity_prefix);
    syncInput('max_items', c.max_items ?? 20);

    const showHeader = this.shadowRoot.getElementById('show_header');
    if (showHeader && showHeader !== active) showHeader.checked = c.show_header !== false;
    const showLogo = this.shadowRoot.getElementById('show_logo');
    if (showLogo && showLogo !== active) showLogo.checked = c.show_logo !== false;

    const activeTypes = c.types && c.types.length ? c.types : HISTORY_KINDS;
    this.shadowRoot.querySelectorAll('#type-chips .chip').forEach((chip) => {
      chip.classList.toggle('active', activeTypes.includes(chip.dataset.type));
    });

    const picker = this.shadowRoot.getElementById('installation-picker');
    if (picker) {
      const installs = discoverInstallations(this._hass);
      // Rebuild the <option> set only when the discovered installations change
      // (guarded by a deviceId:name signature) so a dropdown the user has open
      // isn't clobbered on every `hass` tick.
      const signature = installs.map((i) => `${i.deviceId}:${i.name}`).join('|');
      if (this._installSig !== signature) {
        this._installSig = signature;
        picker.textContent = '';
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = '— Select pool / spa —';
        picker.appendChild(placeholder);
        installs.forEach((inst) => {
          const opt = document.createElement('option');
          opt.value = inst.deviceId;
          opt.textContent = inst.name; // textContent, never innerHTML — device names are untrusted
          picker.appendChild(opt);
        });
      }
      const selected = installs.find((i) => i.prefix === c.entity_prefix);
      picker.value = selected ? selected.deviceId : '';
    }
  }

  _toggleType(key) {
    const current = this._config.types && this._config.types.length ? this._config.types : HISTORY_KINDS;
    const next = current.includes(key) ? current.filter((k) => k !== key) : [...current, key];
    this._config = { ...this._config, types: next };
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config } }));
    this._sync();
  }

  // Picking an installation sets entity_prefix from the discovered entry (the
  // history card has no installation_id). See discoverInstallations.
  _onPickInstallation(deviceId) {
    if (!deviceId) return;
    const inst = discoverInstallations(this._hass).find((i) => i.deviceId === deviceId);
    if (!inst) return;
    this._config = { ...this._config, entity_prefix: inst.prefix };
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config } }));
    this._sync();
  }

  _update(key, value) {
    this._config = { ...this._config, [key]: value };
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config } }));
  }
}

HomepoolCard.getConfigElement = () => document.createElement('homepool-card-editor');
HomepoolHistoryCard.getConfigElement = () => document.createElement('homepool-history-card-editor');

// Register defensively: HA injects this module globally (add_extra_js_url), and it can be
// evaluated more than once (frontend reloads, re-added resources). A bare customElements.define
// on an already-registered tag throws "Failed to execute 'define'… already used", which would
// abort the rest of this block and leave registration half-done. Guarding each define keeps a
// re-run a harmless no-op. (This does not eliminate HA's own render/whenDefined race — where a
// dashboard paints before this module has executed — which is timing on the HA side.)
const defineCard = (tag, cls) => {
  if (!customElements.get(tag)) customElements.define(tag, cls);
};
defineCard('homepool-card', HomepoolCard);
defineCard('homepool-card-editor', HomepoolCardEditor);
defineCard('homepool-history-card', HomepoolHistoryCard);
defineCard('homepool-history-card-editor', HomepoolHistoryCardEditor);

window.customCards = window.customCards || [];
const registerCard = (entry) => {
  if (!window.customCards.some((c) => c.type === entry.type)) window.customCards.push(entry);
};
registerCard({
  type: 'homepool-card',
  name: 'homepool',
  description: 'Water chemistry status board for a homepool installation.',
  preview: false,
});
registerCard({
  type: 'homepool-history-card',
  name: 'homepool history',
  description: 'Recent measurements, treatments and maintenance for a homepool installation.',
  preview: false,
});
