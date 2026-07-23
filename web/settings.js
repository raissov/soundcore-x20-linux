import { mountEarbud } from './earbud.js';

const bud = mountEarbud(document.getElementById('gl'), { distance: 4.1, speed: 0.55 });

const send = (obj) => {
  try { window.webkit.messageHandlers.hp.postMessage(JSON.stringify(obj)); } catch (e) {}
};

let SCHEMA = [];
let VALUES = {};

/* ---------- локализация ----------
   Каталог приходит от Python вместе с init: один общий источник строк
   для shell, Python и этой страницы. */

let I18N = {};

function tr(key, fallback, vars) {
  let str = I18N[key];
  if (str === undefined) str = fallback;
  if (vars) {
    for (const k in vars) str = String(str).split('{' + k + '}').join(vars[k]);
  }
  return str;
}

// Типы, которые эта панель не редактирует
const UNSUPPORTED = new Set([
  'modifiableSelect', 'importString', 'multiSelect', 'multiSelectWithRemove',
]);

const label = (id) => tr('setting.' + id, id);
const catLabel = (id) => tr('category.' + id, id);
// Для вариантов есть запасной аэродром: устройство само отдаёт англ. названия
const optLabel = (v, i, s) =>
  tr('option.' + v, (s && s.localizedOptions && s.localizedOptions[i]) || v);

function applyStaticLabels() {
  document.getElementById('refresh').textContent = tr('ui.refresh', 'Refresh');
  const loading = document.getElementById('loading');
  if (loading) loading.textContent = tr('ui.loading', 'Reading settings…');
  document.title = tr('app.settings_title', 'Headphones — Settings');
}

/* ---------- заряд ---------- */

function pct(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  const m = String(raw).match(/^(\d+)\s*\/\s*(\d+)$/);
  if (m) return Number(m[2]) ? Math.round((Number(m[1]) / Number(m[2])) * 100) : null;
  const n = String(raw).match(/^(\d+)/);
  return n ? Number(n[1]) : null;
}

const colorFor = (p) => (p === null ? 'var(--dim)' : p >= 50 ? 'var(--ok)' : p >= 20 ? 'var(--warn)' : 'var(--bad)');

function renderBattery() {
  const cells = [
    [tr('widget.left', 'Left'), VALUES.batteryLevelLeft, VALUES.isChargingLeft],
    [tr('widget.right', 'Right'), VALUES.batteryLevelRight, VALUES.isChargingRight],
    [tr('widget.case', 'Case'), VALUES.caseBatteryLevel, null],
  ];
  const known = [];
  document.getElementById('batt').innerHTML = cells.map(([name, raw, chg]) => {
    const p = pct(raw);
    if (p !== null) known.push(p);
    const charging = chg && String(chg).toLowerCase() === 'yes';
    return `<div class="bcell">
      <div class="lbl">${name}</div>
      <div class="val">${p === null ? '—' : p + '%'}</div>
      <div class="track"><i style="width:${p === null ? 0 : Math.max(2, p)}%;background:${colorFor(p)}"></i></div>
      ${charging ? `<div class="chg">${tr('ui.charging', 'charging')}</div>` : ''}
    </div>`;
  }).join('');
  if (known.length) {
    const m = Math.min(...known);
    bud.setLedColor(m >= 50 ? 0x6ee7a8 : m >= 20 ? 0xffd166 : 0xff6b6b);
  }
}

function renderHeader() {
  const mode = VALUES.ambientSoundMode;
  const strength = VALUES.manualNoiseCanceling;
  let t = mode ? optLabel(mode, 0, null) : tr('widget.mode_unknown', 'mode unknown');
  if (mode === 'NoiseCanceling' && strength) t += ' · ' + (OPT_RU[strength] || strength).toLowerCase();
  document.getElementById('hsub').innerHTML = `<b>${t}</b>`;
}

/* ---------- контролы ---------- */

function applyLocal(id, value) {
  VALUES[id] = value;
  renderHeader();
}

function setValue(item, id, value) {
  item.classList.add('busy');
  send({ op: 'set', id, value });
  applyLocal(id, value);
}

function ctlSelect(item, s) {
  const opts = s.setting.options || [];
  const cur = VALUES[s.settingId];
  // до 3 коротких вариантов — сегменты, иначе выпадающий список
  const short = opts.length <= 3 && opts.every((o) => optLabel(o, 0, s.setting).length <= 14);
  if (short) {
    const seg = document.createElement('div');
    seg.className = 'seg';
    opts.forEach((o, i) => {
      const b = document.createElement('button');
      b.textContent = optLabel(o, i, s.setting);
      b.setAttribute('aria-pressed', String(o === cur));
      b.onclick = () => {
        [...seg.children].forEach((c) => c.setAttribute('aria-pressed', 'false'));
        b.setAttribute('aria-pressed', 'true');
        setValue(item, s.settingId, o);
      };
      seg.appendChild(b);
    });
    return seg;
  }
  const sel = document.createElement('select');
  opts.forEach((o, i) => {
    const op = document.createElement('option');
    op.value = o; op.textContent = optLabel(o, i, s.setting);
    op.selected = o === cur;
    sel.appendChild(op);
  });
  sel.onchange = () => setValue(item, s.settingId, sel.value);
  return sel;
}

function ctlOptionalSelect(item, s) {
  const opts = s.setting.options || [];
  const cur = VALUES[s.settingId];
  const sel = document.createElement('select');
  const none = document.createElement('option');
  none.value = ''; none.textContent = tr('ui.not_set', '— not set —');
  none.selected = cur === null || cur === undefined || cur === '';
  sel.appendChild(none);
  opts.forEach((o, i) => {
    const op = document.createElement('option');
    op.value = o; op.textContent = optLabel(o, i, s.setting);
    op.selected = o === cur;
    sel.appendChild(op);
  });
  sel.onchange = () => setValue(item, s.settingId, sel.value);
  return sel;
}

function ctlToggle(item, s) {
  const cur = VALUES[s.settingId] === true || String(VALUES[s.settingId]) === 'true';
  const b = document.createElement('button');
  b.className = 'sw';
  b.setAttribute('aria-pressed', String(cur));
  b.onclick = () => {
    const next = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(next));
    setValue(item, s.settingId, next);
  };
  return b;
}

function ctlInfo(s) {
  const d = document.createElement('div');
  d.className = 'info';
  const v = VALUES[s.settingId];
  const str = v === null || v === undefined ? '' : String(v).trim();
  d.textContent = str === '' ? '—' : optLabel(str, 0, null);
  return d;
}

function ctlUnsupported() {
  const d = document.createElement('div');
  d.className = 'info';
  d.textContent = tr('ui.in_openscq30', 'in OpenSCQ30');
  return d;
}

function renderEqualizer(s) {
  const bands = (s.setting && s.setting.bandHz) || [];
  const vals = VALUES[s.settingId] || [];
  const min = s.setting.min, max = s.setting.max;
  const wrap = document.createElement('div');
  wrap.className = 'eq';
  const n = Math.min(bands.length, vals.length) || bands.length;
  for (let i = 0; i < n; i++) {
    const v = vals[i];
    const frac = (v - min) / (max - min);
    const hz = bands[i] >= 1000 ? (bands[i] / 1000) + 'k' : bands[i];
    const b = document.createElement('div');
    b.className = 'band';
    b.innerHTML = `<div class="bar"><i style="height:${Math.round(Math.max(0, Math.min(1, frac)) * 100)}%"></i></div>
                   <div class="hz">${hz}</div>`;
    wrap.appendChild(b);
  }
  return wrap;
}

/* ---------- сборка страницы ---------- */

const BATTERY_IDS = new Set([
  'batteryLevelLeft', 'batteryLevelRight', 'caseBatteryLevel',
  'isChargingLeft', 'isChargingRight',
]);

function render() {
  renderBattery();
  renderHeader();

  const body = document.getElementById('body');
  body.innerHTML = '';

  SCHEMA.forEach((cat) => {
    const items = cat.settings.filter((s) => !BATTERY_IDS.has(s.settingId));
    if (!items.length) return;

    const sec = document.createElement('section');
    const h = document.createElement('h2');
    h.textContent = catLabel(cat.categoryId);
    sec.appendChild(h);

    const group = document.createElement('div');
    group.className = 'group';

    items.forEach((s) => {
      if (s.type === 'equalizer') {
        group.appendChild(renderEqualizer(s));
        const note = document.createElement('div');
        note.className = 'note';
        note.textContent = tr('ui.eq_note', '', {
          got: (VALUES[s.settingId] || []).length,
          declared: (s.setting.bandHz || []).length,
        });
        group.appendChild(note);
        return;
      }

      const item = document.createElement('div');
      item.className = 'item';
      item.dataset.id = s.settingId;

      const name = document.createElement('div');
      name.className = 'name';
      name.textContent = label(s.settingId);
      item.appendChild(name);

      let ctl;
      if (s.type === 'select') ctl = ctlSelect(item, s);
      else if (s.type === 'optionalSelect') ctl = ctlOptionalSelect(item, s);
      else if (s.type === 'toggle') ctl = ctlToggle(item, s);
      else if (s.type === 'information') { ctl = ctlInfo(s); item.classList.add('ro'); }
      else if (UNSUPPORTED.has(s.type)) { ctl = ctlUnsupported(); item.classList.add('ro'); }
      else { ctl = ctlInfo(s); item.classList.add('ro'); }

      ctl.classList.add('ctl');
      item.appendChild(ctl);
      group.appendChild(item);
    });

    sec.appendChild(group);
    body.appendChild(sec);
  });
}

/* ---------- обмен с Python ---------- */

let toastTimer = null;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 4000);
}

function clearBusy(id) {
  const el = document.querySelector(`.item[data-id="${id}"]`);
  if (el) el.classList.remove('busy');
}

window.hpSettings = {
  onMessage(m) {
    if (m.type === 'init') {
      if (m.i18n) { I18N = m.i18n; applyStaticLabels(); }
      SCHEMA = m.schema;
      VALUES = m.values;
      render();
      bud.spinUp();
      setTimeout(() => bud.spinDown(), 2600);
    } else if (m.type === 'values') {
      VALUES = m.values;
      render();
      document.getElementById('refresh').disabled = false;
    } else if (m.type === 'setResult') {
      clearBusy(m.id);
      if (!m.ok) toast(tr('ui.apply_failed', 'Could not apply', { name: label(m.id) })
                                + ': ' + (m.error || ''));
    } else if (m.type === 'error') {
      document.getElementById('body').innerHTML =
        `<div id="loading">${m.error}</div>`;
      document.getElementById('refresh').disabled = false;
    }
  },
};

document.getElementById('refresh').onclick = () => {
  document.getElementById('refresh').disabled = true;
  send({ op: 'refresh' });
};

document.getElementById('gl').onclick = () => {
  bud.spinUp();
  setTimeout(() => bud.spinDown(), 2600);
};

send({ op: 'ready' });
