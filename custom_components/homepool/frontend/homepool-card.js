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

// Ordered by real-world frequency of use (most-used first). The
// `log_measurement` entry is the form-toggle button, kept in this same list
// so ordering and per-item show/hide (config.quick_add) apply uniformly.
const QUICK_ADD_ITEMS = [
  { key: 'log_measurement', kind: 'form-toggle' },
  { key: 'backwash', label: 'Backwash', suffix: 'log_backwash' },
  { key: 'skimmer_filter_cleaning', label: 'Skimmer filter cleaning', suffix: 'log_skimmer_filter_cleaning' },
  { key: 'ph_calibration', label: 'pH calibration', suffix: 'log_ph_calibration' },
  { key: 'purge', label: 'Purge', suffix: 'log_purge' },
  { key: 'water_change', label: 'Water change', suffix: 'log_water_change' },
  { key: 'cartridge_cleaning', label: 'Cartridge cleaning', suffix: 'log_cartridge_cleaning' },
];

const DUE_SUFFIXES = {
  ph_measurement: 'days_until_ph_measurement_due',
  filter_maintenance: 'days_until_filter_maintenance_due',
};

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
    due_ph: 'pH measurement',
    due_filter: 'Filter maintenance',
    due_today: 'due today',
    due_overdue: (n) => `overdue by ${n}d`,
    due_in: (n) => `due in ${n}d`,
    quick_add: 'Quick add',
    log_measurement: 'Log measurement',
    save: 'Save',
    cancel: 'Cancel',
    more_fields: 'More fields',
    notes: 'Notes',
  },
  fr: {
    title: 'homepool',
    ideal: 'idéal',
    measured_today: "mesuré aujourd'hui",
    measured_yesterday: 'mesuré hier',
    measured_days_ago: (n) => `mesuré il y a ${n} jours`,
    never_measured: 'jamais mesuré',
    no_data: 'Aucune entité homepool trouvée pour cette configuration.',
    due_ph: 'Mesure du pH',
    due_filter: 'Entretien du filtre',
    due_today: "aujourd'hui",
    due_overdue: (n) => `en retard de ${n}j`,
    due_in: (n) => `dans ${n}j`,
    quick_add: 'Ajout rapide',
    log_measurement: 'Enregistrer une mesure',
    save: 'Enregistrer',
    cancel: 'Annuler',
    more_fields: 'Plus de champs',
    notes: 'Notes',
  },
};

function t(hass, key, ...args) {
  const lang = (hass && hass.language && hass.language.startsWith('fr')) ? 'fr' : 'en';
  const entry = STRINGS[lang][key] ?? STRINGS.en[key];
  return typeof entry === 'function' ? entry(...args) : entry;
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
    const defaultQuickAdd = {};
    QUICK_ADD_ITEMS.forEach((item) => { defaultQuickAdd[item.key] = true; });
    this._config = {
      title: config.title ?? 'homepool',
      entity_prefix: config.entity_prefix,
      installation_id: config.installation_id ?? null,
      show_buttons: config.show_buttons !== false,
      show_due: config.show_due !== false,
      show_header: config.show_header !== false,
      show_logo: config.show_logo !== false,
      parameters: config.parameters ?? null,
      quick_add: { ...defaultQuickAdd, ...(config.quick_add || {}) },
    };
    if (!this.shadowRoot) this.attachShadow({ mode: 'open' });
    this._formOpen = false;
    this._formMoreOpen = false;
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
    const hass = this._hass;
    if (!hass) return [];
    const quickAdd = this._config.quick_add || {};
    return QUICK_ADD_ITEMS.filter((item) => item.kind !== 'form-toggle' && quickAdd[item.key] !== false)
      .map((item) => ({
        label: item.label,
        entityId: `button.${this._config.entity_prefix.replace(/^sensor\./, '')}_${item.suffix}`,
      }))
      .filter((e) => hass.states[e.entityId] !== undefined);
  }

  _dueEntities() {
    const hass = this._hass;
    if (!hass) return [];
    return Object.entries(DUE_SUFFIXES)
      .map(([key, suffix]) => ({ key, entityId: this._entityId(suffix) }))
      .filter((e) => hass.states[e.entityId] !== undefined);
  }

  _pressButton(entityId) {
    this._hass.callService('button', 'press', { entity_id: entityId });
  }

  _submitForm(values) {
    if (!this._config.installation_id) return;
    const data = { installation_id: this._config.installation_id };
    for (const [k, v] of Object.entries(values)) {
      if (v === '' || v === null || v === undefined) continue;
      data[k] = k === 'notes' ? v : parseFloat(v);
    }
    this._hass.callService('homepool', 'log_measurement', data);
    this._formOpen = false;
    this._formMoreOpen = false;
    this._render();
  }

  _render() {
    const hass = this._hass;
    const config = this._config;
    if (!hass || !config || !this.shadowRoot) return;

    const params = this._paramEntities();
    const buttons = config.show_buttons ? this._buttonEntities() : [];
    const dues = config.show_due ? this._dueEntities() : [];

    if (params.length === 0 && buttons.length === 0) {
      this.shadowRoot.innerHTML = `
        ${this._styles()}
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
            <span class="hp-label">${attrs.friendly_name ? attrs.friendly_name.replace(/^.*?\s/, '') : field}</span>
            ${status ? `<span class="hp-dot" style="background:${rail}"></span>` : ''}
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

    const dueHtml = dues.map(({ key, entityId }) => {
      const st = hass.states[entityId];
      const days = st.state === 'unavailable' || st.state === 'unknown' ? null : parseFloat(st.state);
      if (days === null) return '';
      const label = key === 'ph_measurement' ? t(hass, 'due_ph') : t(hass, 'due_filter');
      const overdue = days < 0;
      const dueSoon = days >= 0 && days <= 3;
      const chipClass = overdue ? 'hp-chip-danger' : dueSoon ? 'hp-chip-warn' : 'hp-chip-neutral';
      const text = overdue ? t(hass, 'due_overdue', Math.abs(Math.round(days)))
        : days === 0 ? t(hass, 'due_today')
        : t(hass, 'due_in', Math.round(days));
      return `<span class="hp-chip ${chipClass}">${label}: ${text}</span>`;
    }).join('');

    const buttonsByEntity = new Map(buttons.map((b) => [b.entityId, b]));
    const showFormToggle = config.installation_id && config.quick_add?.log_measurement !== false;
    const buttonsHtml = QUICK_ADD_ITEMS.map((item) => {
      if (item.kind === 'form-toggle') {
        return showFormToggle
          ? `<button class="hp-btn hp-btn-accent" id="hp-form-toggle">${t(hass, 'log_measurement')}</button>`
          : '';
      }
      const entityId = `button.${config.entity_prefix.replace(/^sensor\./, '')}_${item.suffix}`;
      const btn = buttonsByEntity.get(entityId);
      if (!btn) return '';
      return `
        <button class="hp-btn" data-entity="${entityId}">${
          (hass.states[entityId] && hass.states[entityId].attributes.friendly_name || btn.label).replace(/^.*?\s/, '')
        }</button>
      `;
    }).join('');

    const formHtml = this._formOpen ? this._formHtml(hass, this._sanitizer()) : '';

    const formState = this._formOpen ? this._captureFormState() : null;

    this.shadowRoot.innerHTML = `
      ${this._styles()}
      <ha-card>
        ${config.show_header ? `
          <div class="hp-header">
            ${config.show_logo ? HOMEPOOL_ICON_SVG : ''}
            <span>${config.title}</span>
          </div>
        ` : ''}
        ${dueHtml ? `<div class="hp-due-row">${dueHtml}</div>` : ''}
        ${params.length ? `<div class="hp-grid">${tilesHtml}</div>` : ''}
        ${buttons.length || showFormToggle ? `
          <div class="hp-section-label">${t(hass, 'quick_add')}</div>
          <div class="hp-buttons">
            ${buttonsHtml}
          </div>
        ` : ''}
        ${formHtml}
      </ha-card>
    `;

    this.shadowRoot.querySelectorAll('.hp-btn[data-entity]').forEach((btn) => {
      btn.addEventListener('click', () => this._pressButton(btn.dataset.entity));
    });
    const toggle = this.shadowRoot.getElementById('hp-form-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        this._formOpen = !this._formOpen;
        this._render();
      });
    }
    if (config.installation_id) {
      this.shadowRoot.querySelectorAll('.hp-tile[data-field]').forEach((tile) => {
        tile.addEventListener('click', () => this._openFormOnField(tile.dataset.field));
      });
    }
    this._restoreFormState(formState);
    const formEl = this.shadowRoot.getElementById('hp-form');
    if (formEl) {
      formEl.addEventListener('submit', (e) => {
        e.preventDefault();
        const data = new FormData(formEl);
        this._submitForm(Object.fromEntries(data.entries()));
      });
      const cancelBtn = this.shadowRoot.getElementById('hp-form-cancel');
      if (cancelBtn) cancelBtn.addEventListener('click', () => { this._formOpen = false; this._formMoreOpen = false; this._render(); });
      const moreToggle = this.shadowRoot.getElementById('hp-form-more-toggle');
      if (moreToggle) {
        moreToggle.addEventListener('click', () => {
          this._formMoreOpen = !this._formMoreOpen;
          this._render();
        });
      }
    }
  }

  // Opens the log-measurement form focused on a tapped tile's field,
  // expanding "more fields" first if the field isn't in the sanitizer's
  // default set.
  _openFormOnField(field) {
    const primary = SANITIZER_FORM_FIELDS[this._sanitizer()] || DEFAULT_FORM_FIELDS;
    this._formOpen = true;
    if (!primary.includes(field)) this._formMoreOpen = true;
    this._render();
    const formEl = this.shadowRoot.getElementById('hp-form');
    if (formEl && formEl.elements[field]) formEl.elements[field].focus();
  }

  // Captures the open form's live values + focus/cursor position before a
  // hass-triggered _render() blows away and rebuilds the shadow DOM via
  // innerHTML, so uncontrolled <input> state survives the rebuild. Mirrors
  // the capture/restore idiom already used by HomepoolCardEditor._sync().
  _captureFormState() {
    const formEl = this.shadowRoot.getElementById('hp-form');
    if (!formEl) return null;
    const active = this.shadowRoot.activeElement;
    const values = {};
    formEl.querySelectorAll('input').forEach((el) => { values[el.name] = el.value; });
    return {
      values,
      activeName: active && active.name,
      selectionStart: active && active.selectionStart,
      selectionEnd: active && active.selectionEnd,
    };
  }

  _restoreFormState(captured) {
    if (!captured) return;
    const formEl = this.shadowRoot.getElementById('hp-form');
    if (!formEl) return;
    Object.entries(captured.values).forEach(([name, value]) => {
      const el = formEl.elements[name];
      if (el) el.value = value;
    });
    if (captured.activeName) {
      const el = formEl.elements[captured.activeName];
      if (el) {
        el.focus();
        if (typeof captured.selectionStart === 'number') el.setSelectionRange(captured.selectionStart, captured.selectionEnd);
      }
    }
  }

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
          ${this._formMoreOpen ? `
            <div class="hp-form-grid hp-form-more">
              ${more.map(fieldInput).join('')}
              <label class="hp-form-field hp-form-field-wide">
                <span>${t(hass, 'notes')}</span>
                <input name="notes" type="text" />
              </label>
            </div>
          ` : ''}
        ` : ''}
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
        .hp-form-field input {
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

// Sorted longest-first so e.g. "stabilizer_cya" is tried before any shorter
// suffix that could otherwise false-match a prefix of it.
const SORTED_FIELD_SUFFIXES = Object.values(FIELD_SUFFIXES).sort((a, b) => b.length - a.length);

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
    const quickAddChipsHtml = QUICK_ADD_ITEMS.filter((i) => i.kind !== 'form-toggle')
      .map((item) => `<button type="button" class="chip" data-quick-add="${item.key}">${item.label}</button>`)
      .join('');
    const parameterChipsHtml = Object.keys(FIELD_SUFFIXES)
      .map((key) => `<button type="button" class="chip" data-parameter="${key}">${FORM_FIELD_LABELS[key] || key}</button>`)
      .join('');

    this.shadowRoot.innerHTML = `
      <style>
        .row { display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px; }
        label { font-size: 12px; font-weight: 600; }
        input { padding: 6px 8px; font-size: 13px; }
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
        <label>Pool sensor <span class="hint">(pick any sensor from the installation — fills in the fields below)</span></label>
        <div id="picker-slot"></div>
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

    this._picker = document.createElement('ha-entity-picker');
    this._picker.includeDomains = ['sensor'];
    this._picker.entityFilter = (stateObj) => {
      const entry = this._hass && this._hass.entities && this._hass.entities[stateObj.entity_id];
      return !!entry && entry.platform === 'homepool';
    };
    this._picker.addEventListener('value-changed', (e) => this._onPick(e.detail.value));
    this.shadowRoot.getElementById('picker-slot').appendChild(this._picker);

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

  // Finds the entity_id (if any is currently loaded) that represents the
  // configured entity_prefix, so the picker can show it as selected.
  _guessEntity(prefix) {
    if (!prefix) return '';
    const candidates = SORTED_FIELD_SUFFIXES.map((s) => `${prefix}_${s}`);
    if (this._hass) {
      const found = candidates.find((id) => this._hass.states[id] !== undefined);
      if (found) return found;
    }
    return candidates[0] ?? '';
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

    if (this._picker && this._hass) {
      this._picker.hass = this._hass;
      const derived = this._guessEntity(c.entity_prefix);
      if (this._picker.value !== derived) this._picker.value = derived;
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

  // Picking one sensor derives both entity_prefix (strip the known field
  // suffix) and installation_id (via the entity's device identifiers,
  // `(DOMAIN, installation_id)` — see sensor.py's device_info) so the user
  // never has to type either by hand.
  _onPick(entityId) {
    if (!entityId) return;
    const suffix = SORTED_FIELD_SUFFIXES.find((s) => entityId.endsWith(`_${s}`));
    const updates = { entity_prefix: suffix ? entityId.slice(0, -(suffix.length + 1)) : entityId };

    const entry = this._hass && this._hass.entities && this._hass.entities[entityId];
    const device = entry && this._hass.devices && this._hass.devices[entry.device_id];
    const identifier = device && device.identifiers && device.identifiers.find(([domain]) => domain === 'homepool');
    if (identifier) updates.installation_id = parseInt(identifier[1], 10);

    this._config = { ...this._config, ...updates };
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config } }));
    this._sync();
  }

  _update(key, value) {
    this._config = { ...this._config, [key]: value };
    this.dispatchEvent(new CustomEvent('config-changed', { detail: { config: this._config } }));
  }
}

HomepoolCard.getConfigElement = () => document.createElement('homepool-card-editor');

customElements.define('homepool-card', HomepoolCard);
customElements.define('homepool-card-editor', HomepoolCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: 'homepool-card',
  name: 'homepool',
  description: 'Water chemistry status board for a homepool installation.',
  preview: false,
});
