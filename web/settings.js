import { mountEarbud } from './earbud.js';

const bud = mountEarbud(document.getElementById('gl'), { distance: 4.1, speed: 0.55 });

const send = (obj) => {
  try { window.webkit.messageHandlers.hp.postMessage(JSON.stringify(obj)); } catch (e) {}
};

let SCHEMA = [];
let VALUES = {};

/* ---------- словари ---------- */

const CAT_RU = {
  soundModes: 'Режимы звука',
  equalizer: 'Эквалайзер',
  equalizerImportExport: 'Профили эквалайзера',
  buttonConfiguration: 'Кнопки на наушниках',
  dualConnections: 'Подключение к двум устройствам',
  miscellaneous: 'Прочее',
  deviceInformation: 'Об устройстве',
};

const NAME_RU = {
  ambientSoundMode: 'Режим',
  transparencyMode: 'Тип прозрачности',
  noiseCancelingMode: 'Тип шумоподавления',
  adaptiveNoiseCanceling: 'Адаптивное сейчас',
  manualNoiseCanceling: 'Сила шумоподавления',
  windNoiseSuppression: 'Подавление ветра',
  windNoiseDetected: 'Ветер обнаружен',
  presetEqualizerProfile: 'Пресет',
  importCustomEqualizerProfiles: 'Импорт профилей',
  exportCustomEqualizerProfiles: 'Экспорт профилей',
  exportCustomEqualizerProfilesOutput: 'Результат экспорта',
  customEqualizerProfile: 'Свой профиль',
  volumeAdjustments: 'Полосы',
  leftSinglePress: 'Левый — одно нажатие',
  rightSinglePress: 'Правый — одно нажатие',
  leftDoublePress: 'Левый — двойное',
  rightDoublePress: 'Правый — двойное',
  leftLongPress: 'Левый — долгое',
  rightLongPress: 'Правый — долгое',
  normalModeInCycle: 'Обычный режим в цикле',
  transparencyModeInCycle: 'Прозрачность в цикле',
  noiseCancelingModeInCycle: 'Шумоподавление в цикле',
  dualConnections: 'Два устройства',
  dualConnectionsDevices: 'Сопряжённые устройства',
  autoPowerOff: 'Автовыключение',
  surroundSound: 'Объёмный звук',
  touchTone: 'Звук касания',
  twsStatus: 'Связь между вкладышами',
  hostDevice: 'Ведущий вкладыш',
  isChargingLeft: 'Левый заряжается',
  isChargingRight: 'Правый заряжается',
  batteryLevelLeft: 'Заряд левого',
  batteryLevelRight: 'Заряд правого',
  caseBatteryLevel: 'Заряд кейса',
  serialNumber: 'Серийный номер',
  firmwareVersionLeft: 'Прошивка левого',
  firmwareVersionRight: 'Прошивка правого',
};

const OPT_RU = {
  NoiseCanceling: 'Шумоподавление', Transparency: 'Прозрачность', Normal: 'Обычный',
  FullyTransparent: 'Полная', VocalMode: 'Голос',
  Manual: 'Ручное', Adaptive: 'Адаптивное',
  Weak: 'Слабое', Moderate: 'Среднее', Strong: 'Сильное',
  VolumeUp: 'Громче', VolumeDown: 'Тише', PreviousSong: 'Предыдущий',
  NextSong: 'Следующий', PlayPause: 'Пуск/пауза',
  AmbientSoundMode: 'Смена режима', VoiceAssistant: 'Голосовой помощник',
  disabled: 'выключено', Yes: 'да', No: 'нет', Connected: 'установлена',
  '10m': '10 мин', '20m': '20 мин', '30m': '30 мин', '60m': '60 мин',
  Disconnected: 'нет связи', HighNoise: 'сильный шум', MidNoise: 'средний шум',
  LowNoise: 'слабый шум',
};

// Типы, которые эта панель не редактирует
const UNSUPPORTED = new Set([
  'modifiableSelect', 'importString', 'multiSelect', 'multiSelectWithRemove',
]);

const label = (id) => NAME_RU[id] || id;
const optLabel = (v, i, s) => OPT_RU[v] || (s.localizedOptions && s.localizedOptions[i]) || v;

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
    ['Левый', VALUES.batteryLevelLeft, VALUES.isChargingLeft],
    ['Правый', VALUES.batteryLevelRight, VALUES.isChargingRight],
    ['Кейс', VALUES.caseBatteryLevel, null],
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
      ${charging ? '<div class="chg">заряжается</div>' : ''}
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
  let t = OPT_RU[mode] || mode || 'режим неизвестен';
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
  none.value = ''; none.textContent = '— не задано —';
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
  d.textContent = str === '' ? '—' : (OPT_RU[str] || str);
  return d;
}

function ctlUnsupported() {
  const d = document.createElement('div');
  d.className = 'info';
  d.textContent = 'в OpenSCQ30';
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
    h.textContent = CAT_RU[cat.categoryId] || cat.categoryId;
    sec.appendChild(h);

    const group = document.createElement('div');
    group.className = 'group';

    items.forEach((s) => {
      if (s.type === 'equalizer') {
        group.appendChild(renderEqualizer(s));
        const note = document.createElement('div');
        note.className = 'note';
        note.textContent =
          `Полосы показаны только для чтения. Устройство отдаёт ${(VALUES[s.settingId] || []).length} ` +
          `значений при заявленных ${(s.setting.bandHz || []).length} полосах, поэтому записывать их ` +
          `отсюда небезопасно — для тонкой настройки откройте OpenSCQ30.`;
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
      if (!m.ok) toast('Не удалось применить «' + label(m.id) + '»: ' + (m.error || ''));
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
