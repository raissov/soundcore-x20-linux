import { mountEarbud } from './earbud.js';

const card = document.getElementById('card');
const bud = mountEarbud(document.getElementById('gl'));

/* ---------- данные ---------- */

function levelToPercent(v) {
  // openscq30 отдаёт заряд в шкале "N/5"; upower — уже проценты
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).trim();
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) {
    const n = Number(frac[1]), d = Number(frac[2]);
    return d ? Math.round((n / d) * 100) : null;
  }
  const num = s.match(/^(\d+)/);
  return num ? Number(num[1]) : null;
}

const cssVar = (n) => getComputedStyle(document.documentElement)
  .getPropertyValue(n).trim();

function colorFor(pct) {
  if (pct === null) return cssVar('--dim');
  if (pct >= 50) return cssVar('--ok');
  if (pct >= 20) return cssVar('--warn');
  return cssVar('--bad');
}

function setRow(id, raw) {
  const row = document.getElementById(id);
  const pct = levelToPercent(raw);
  const fillEl = row.querySelector('.fill');
  const pctEl = row.querySelector('.pct');
  if (pct === null) {
    row.classList.add('absent');
    pctEl.textContent = '—';
    return null;
  }
  row.classList.remove('absent');
  pctEl.textContent = pct + '%';
  fillEl.style.width = Math.max(2, pct) + '%';
  fillEl.style.background = colorFor(pct);
  return pct;
}

const ANC_LABEL = {
  NoiseCanceling: 'Шумоподавление',
  Transparency: 'Прозрачность',
  Normal: 'Обычный режим',
};

const ANC_COLOR = {
  NoiseCanceling: '#7fd7ff',
  Transparency: '#ffd166',
  Normal: 'rgba(242,242,244,.5)',
};

function setData(d) {
  if (d.name) document.getElementById('name').textContent = d.name;

  const l = setRow('rowL', d.left);
  const r = setRow('rowR', d.right);
  setRow('rowC', d.case);

  const known = [l, r].filter((v) => v !== null);
  if (known.length) {
    const m = Math.min(...known);
    bud.setLedColor(m >= 50 ? 0x6ee7a8 : m >= 20 ? 0xffd166 : 0xff6b6b);
  }

  const mode = d.anc || '';
  const text = ANC_LABEL[mode] || (mode || 'режим неизвестен');
  document.getElementById('ancText').textContent =
    text + (mode === 'NoiseCanceling' && d.strength ? ` · ${d.strength}` : '');
  document.querySelector('#anc .dot').style.background =
    ANC_COLOR[mode] || 'rgba(242,242,244,.35)';

  bud.pump();
}

/* ---------- показ/скрытие, мышь, клик ---------- */

const send = (msg) => {
  try { window.webkit.messageHandlers.hp.postMessage(msg); } catch (e) { /* вне WebKit */ }
};

function enter() {
  card.classList.remove('out');
  card.classList.add('in');
  bud.spinUp();
}

function leave() {
  card.classList.remove('in');
  card.classList.add('out');
  bud.spinDown();
  setTimeout(() => send('closed'), 460);   // чуть дольше CSS-перехода
}

card.addEventListener('mouseenter', () => { bud.spinUp(); send('hover'); });
card.addEventListener('mouseleave', () => { bud.spinDown(); send('unhover'); });

// Клик по карточке открывает панель настроек
card.addEventListener('click', () => {
  card.classList.add('clicked');
  send('open-settings');
});

window.hpWidget = { setData, enter, leave };

send('ready');
