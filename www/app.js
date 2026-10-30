import {
  analyze, dayStatus, cycleFor, predictedLabels, addDays, diffDays, dayNum, localToday,
  cToF, fToC, toCSV, fromCSV, DEFAULT_SETTINGS,
} from './cycle.js';

const STORE_KEY = 'cyclsius.v1';
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

// ---------- state ----------

let state = load();
let A = null; // current analysis
let chartIndex = null; // null = latest cycle
let calMonth = null; // [year, monthIndex]

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw);
      return { entries: s.entries || {}, settings: { ...DEFAULT_SETTINGS, ...(s.settings || {}) } };
    }
  } catch (e) { console.warn('load failed', e); }
  return { entries: {}, settings: { ...DEFAULT_SETTINGS } };
}

function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
  } catch (e) {
    alert('Could not save data on this device: ' + e.message);
  }
}

function recompute() {
  A = analyze(state.entries, state.settings, localToday());
}

// ---------- formatting ----------

const unit = () => state.settings.unit;
const fmtTemp = (c, digits = 2) =>
  c == null ? '–' : (unit() === 'F' ? cToF(c) : c).toFixed(digits) + ' °' + unit();
const toDisplay = (c) => (unit() === 'F' ? +cToF(c).toFixed(2) : +c.toFixed(2));
const fmtDate = (s, opts = { day: 'numeric', month: 'short' }) =>
  new Date(s + 'T00:00:00Z').toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
const fmtNum = (x, d = 1) => (x == null ? '–' : (Math.round(x * 10 ** d) / 10 ** d).toString());
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- navigation ----------

const TITLES = { today: 'Today', chart: 'Chart', calendar: 'Calendar', stats: 'Statistics', settings: 'Settings' };

function show(view) {
  $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + view));
  $$('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  $('#title').textContent = TITLES[view];
  window.scrollTo(0, 0);
  renderView(view);
}

function currentView() {
  return $('.view.active').id.replace('view-', '');
}

function renderView(view = currentView()) {
  ({ today: renderToday, chart: renderChart, calendar: renderCalendar, stats: renderStats, settings: renderSettings })[view]();
}

function refresh() {
  recompute();
  renderView();
}

// ---------- today ----------

function renderToday() {
  renderStatus();
  const f = $('#entry-form');
  if (!f.date.value) loadEntry(A.today);
  $$('.unit-label').forEach((el) => (el.textContent = '°' + unit()));
  f.temp.placeholder = unit() === 'F' ? 'e.g. 97.70' : 'e.g. 36.45';
}

function renderStatus() {
  const el = $('#status-card');
  const today = A.today;
  const c = A.current;
  if (!c) {
    el.className = 'card status';
    el.innerHTML = `<div class="cd">No cycle yet</div><div class="big">Welcome</div>
      <p class="small">Log the first day of your period (bleeding: light, medium or heavy) to start a cycle,
      then enter your waking temperature every morning. Or load demo data in Settings to explore.</p>`;
    return;
  }
  const st = dayStatus(A, today);
  const cd = diffDays(today, c.start) + 1;
  const p = A.predictions;
  const labels = {
    'period': 'Period',
    'infertile-pre': 'Low fertility',
    'fertile': 'Fertile',
    'infertile-post': 'Infertile',
    'unknown': '–',
  };
  let sub = '';
  if (st === 'infertile-pre') sub = `Pre-ovulatory infertile phase until cycle day ${c.lastInfertileCD} (${c.preRule}).`;
  else if (st === 'infertile-post') sub = 'Ovulation confirmed by temperature' + (c.mucusRecorded ? ' and mucus.' : '.');
  else if (st === 'fertile' || st === 'period') {
    if (c.shift && c.shift.state === 'pending') sub = 'Temperature rise detected, waiting for confirmation.';
    else if (c.shift && c.shift.state === 'confirmed' && !c.postInfertileFrom) sub = 'Temperature shift confirmed; waiting for mucus peak + 3 days.';
    else if (c.shift && c.shift.state === 'confirmed') sub = `Infertile from the evening of ${fmtDate(c.postInfertileFrom)}.`;
    else if (st === 'fertile') sub = 'Fertile until a temperature shift is confirmed.';
  }

  const items = [];
  if (p.late) items.push(`<li class="alert">Period late by ${plural(p.late, 'day')} (expected ${fmtDate(p.nextPeriod)}).</li>`);
  else items.push(`<li>Next period: <b>${fmtDate(p.nextPeriod)}</b> (${p.daysUntilPeriod === 0 ? 'today' : 'in ' + plural(p.daysUntilPeriod, 'day')})</li>`);
  if (p.ovulationConfirmed) items.push(`<li>Ovulation (estimated from temperature): <b>${fmtDate(p.ovulation)}</b></li>`);
  else if (dayNum(p.ovulation) >= dayNum(today)) {
    items.push(`<li>Predicted ovulation: <b>${fmtDate(p.ovulation)}</b></li>`);
    items.push(`<li>Predicted fertile window: ${fmtDate(p.fertileWindow[0])} – ${fmtDate(p.fertileWindow[1])}</li>`);
  }
  if (c.shift) items.push(`<li>Coverline: ${fmtTemp(c.shift.coverline)}${c.shift.state === 'pending' ? ' (provisional)' : ''}</li>`);
  if (p.possiblePregnancy) items.push(`<li class="alert">${p.highTempDays} high temperature days: a pregnancy is possible. Consider a test.</li>`);
  if (A.stats.shortLuteal) items.push('<li class="alert">A luteal phase shorter than 10 days was recorded.</li>');
  const todayEntry = state.entries[today];
  if (!todayEntry || todayEntry.temp == null) items.push('<li>No temperature logged today yet.</li>');

  el.className = 'card status s-' + st;
  el.innerHTML = `<div class="cd">Cycle day ${cd} · started ${fmtDate(c.start)}</div>
    <div class="big" id="status-label">${labels[st]}</div>
    ${sub ? `<div class="small">${sub}</div>` : ''}
    <ul>${items.join('')}</ul>`;
}

function setChip(name, value) {
  $$(`.chips[data-name=${name}] button`).forEach((b) => b.classList.toggle('on', b.dataset.v === value));
}
function getChip(name) {
  const b = $(`.chips[data-name=${name}] button.on`);
  return b ? b.dataset.v : '';
}

function loadEntry(date) {
  const f = $('#entry-form');
  const e = state.entries[date] || {};
  f.date.value = date;
  f.temp.value = e.temp != null ? toDisplay(e.temp) : '';
  f.time.value = e.time || '';
  f.excluded.checked = !!e.excluded;
  f.sex.checked = !!e.sex;
  f.note.value = e.note || '';
  setChip('bleeding', e.bleeding || '');
  setChip('mucus', e.mucus || '');
  $('#delete-entry').hidden = !state.entries[date];
  msg('#form-msg', '');
}

export function openEntry(date) {
  show('today');
  loadEntry(date);
  $('#entry-form').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function msg(sel, text, err = false) {
  const el = $(sel);
  el.textContent = text;
  el.classList.toggle('err', err);
}

function saveEntry(ev) {
  ev.preventDefault();
  const f = $('#entry-form');
  const date = f.date.value;
  if (!date) return msg('#form-msg', 'Pick a date.', true);
  if (dayNum(date) > dayNum(localToday())) return msg('#form-msg', 'Cannot log a future date.', true);
  const e = {};
  const raw = f.temp.value.trim().replace(',', '.');
  if (raw) {
    let t = parseFloat(raw);
    if (Number.isNaN(t)) return msg('#form-msg', 'Temperature is not a number.', true);
    if (unit() === 'F') t = fToC(t);
    if (t < 34 || t > 40) return msg('#form-msg', 'Temperature out of range (34–40 °C / 93–104 °F).', true);
    e.temp = Math.round(t * 1000) / 1000;
  }
  if (f.time.value) e.time = f.time.value;
  if (f.excluded.checked) e.excluded = true;
  const bleeding = getChip('bleeding');
  if (bleeding) e.bleeding = bleeding;
  const mucus = getChip('mucus');
  if (mucus) e.mucus = mucus;
  if (f.sex.checked) e.sex = true;
  if (f.note.value.trim()) e.note = f.note.value.trim();
  if (Object.keys(e).length === 0) return msg('#form-msg', 'Nothing to save.', true);
  state.entries[date] = e;
  save();
  recompute();
  renderStatus();
  $('#delete-entry').hidden = false;
  msg('#form-msg', `Saved ${fmtDate(date, { day: 'numeric', month: 'short', year: 'numeric' })}.`);
}

function deleteEntry() {
  const date = $('#entry-form').date.value;
  if (!state.entries[date] || !confirm(`Delete all data for ${date}?`)) return;
  delete state.entries[date];
  save();
  recompute();
  loadEntry(date);
  renderStatus();
  msg('#form-msg', 'Deleted.');
}

// ---------- chart ----------

function renderChart() {
  const wrap = $('#chart-wrap');
  const cycles = A.cycles;
  if (!cycles.length) {
    wrap.innerHTML = '<div class="empty">No cycles yet. Log a period day to start.</div>';
    $('#cycle-label').textContent = 'Cycle';
    $('#cycle-summary').innerHTML = '';
    $('#cycle-prev').disabled = $('#cycle-next').disabled = true;
    return;
  }
  if (chartIndex == null || chartIndex >= cycles.length) chartIndex = cycles.length - 1;
  const c = cycles[chartIndex];
  $('#cycle-prev').disabled = chartIndex === 0;
  $('#cycle-next').disabled = chartIndex === cycles.length - 1;
  $('#cycle-label').textContent = `Cycle ${chartIndex + 1}/${cycles.length} · ${fmtDate(c.start)}` +
    (c.end ? ` – ${fmtDate(c.end)}` : ' – now');
  wrap.innerHTML = chartSVG(c);
  const today = $('svg .today', wrap);
  wrap.scrollLeft = today ? Math.max(0, +today.getAttribute('x1') - wrap.clientWidth + 60) : 0;
  renderCycleSummary(c);
}

function chartSVG(c) {
  const n = Math.max(c.days.length, c.complete ? 0 : A.stats.usedCycle, 21);
  const colW = 24, left = 40, top = 12, plotH = 220, rowH = 16;
  const rows = ['day', 'date', 'bleed', 'mucus', 'sex'];
  const W = left + n * colW + 8;
  const H = top + plotH + 8 + rows.length * rowH + 4;
  const isF = unit() === 'F';
  const conv = (t) => (isF ? cToF(t) : t);
  const step = isF ? 0.2 : 0.1;

  const temps = c.days.filter((d) => d.entry && typeof d.entry.temp === 'number').map((d) => conv(d.entry.temp));
  let lo, hi;
  if (temps.length) {
    lo = Math.floor((Math.min(...temps) - step) / step) * step;
    hi = Math.ceil((Math.max(...temps) + step) / step) * step;
  } else {
    lo = conv(36.0); hi = conv(37.0);
  }
  const minSpan = 8 * step;
  if (hi - lo < minSpan) { const m = (hi + lo) / 2; lo = m - minSpan / 2; hi = m + minSpan / 2; lo = Math.floor(lo / step) * step; hi = Math.ceil(hi / step) * step; }
  const y = (t) => top + plotH - ((conv(t) - lo) / (hi - lo)) * plotH;
  const x = (i) => left + i * colW + colW / 2;
  const out = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Temperature chart">`);

  // phase backgrounds
  for (let i = 0; i < n; i++) {
    const date = addDays(c.start, i);
    let cls = '';
    if (i < c.days.length && dayNum(date) <= dayNum(A.today)) {
      const st = dayStatus(A, date);
      cls = { period: 'bg-period', fertile: 'bg-fertile', 'infertile-pre': 'bg-infertile', 'infertile-post': 'bg-infertile' }[st] || '';
    }
    if (cls) out.push(`<rect class="${cls}" x="${left + i * colW}" y="${top}" width="${colW}" height="${plotH}"/>`);
  }
  // grid
  const nSteps = Math.round((hi - lo) / step);
  for (let k = 0; k <= nSteps; k++) {
    const v = lo + k * step;
    const yy = top + plotH - (k / nSteps) * plotH;
    const major = Math.abs(v * 2 - Math.round(v * 2)) < 1e-6 || (isF && Math.abs(v - Math.round(v)) < 1e-6);
    out.push(`<line class="grid${major ? ' major' : ''}" x1="${left}" x2="${W - 8}" y1="${yy}" y2="${yy}"/>`);
    out.push(`<text x="${left - 4}" y="${yy + 3}" text-anchor="end">${v.toFixed(isF ? 1 : 1)}</text>`);
  }
  for (let i = 0; i <= n; i++) {
    out.push(`<line class="grid" x1="${left + i * colW}" x2="${left + i * colW}" y1="${top}" y2="${top + plotH}"/>`);
  }
  // coverline
  if (c.shift) {
    const i0 = diffDays(c.shift.lowDates[0], c.start);
    const yy = y(c.shift.coverline);
    out.push(`<line class="cover" x1="${left + i0 * colW}" x2="${left + n * colW}" y1="${yy}" y2="${yy}"/>`);
  }
  // ovulation estimate
  if (c.ovulationEstimate) {
    const i = diffDays(c.ovulationEstimate, c.start);
    out.push(`<line class="ovmark" x1="${x(i) + colW / 2}" x2="${x(i) + colW / 2}" y1="${top}" y2="${top + plotH}"/>`);
  }
  // today
  const ti = diffDays(A.today, c.start);
  if (ti >= 0 && ti < n) out.push(`<line class="today" x1="${x(ti)}" x2="${x(ti)}" y1="${top}" y2="${top + plotH}"/>`);
  // temperature line + points
  const pts = c.days.map((d, i) => ({ d, i })).filter(({ d }) => d.entry && typeof d.entry.temp === 'number');
  const valid = pts.filter(({ d }) => !d.entry.excluded);
  if (valid.length > 1) out.push(`<polyline class="tline" points="${valid.map(({ d, i }) => `${x(i)},${y(d.entry.temp)}`).join(' ')}"/>`);
  const highFrom = c.shift ? dayNum(c.shift.firstHigh) : Infinity;
  for (const { d, i } of pts) {
    const cls = d.entry.excluded ? 'tpt excl' : dayNum(d.date) >= highFrom ? 'tpt high' : 'tpt';
    out.push(`<circle class="${cls}" cx="${x(i)}" cy="${y(d.entry.temp)}" r="4"><title>${d.date}: ${fmtTemp(d.entry.temp)}</title></circle>`);
  }
  // bottom rows
  const by = top + plotH + 8;
  const MUC = { dry: 't', nothing: 'Ø', moist: 'f', creamy: 'S', eggwhite: 'S+' };
  const BL = { spotting: 0.3, light: 0.55, medium: 0.8, heavy: 1 };
  rows.forEach((r, k) => out.push(`<text x="${left - 4}" y="${by + k * rowH + 11}" text-anchor="end">${['CD', 'Date', 'Blood', 'Mucus', '♥'][k]}</text>`));
  for (let i = 0; i < n; i++) {
    const date = addDays(c.start, i);
    const e = state.entries[date];
    const cx = x(i);
    out.push(`<text class="lab" x="${cx}" y="${by + 11}" text-anchor="middle">${i + 1}</text>`);
    out.push(`<text x="${cx}" y="${by + rowH + 11}" text-anchor="middle">${+date.slice(8)}</text>`);
    if (e && BL[e.bleeding]) out.push(`<rect class="bleed" x="${cx - 6}" y="${by + 2 * rowH + 2}" width="12" height="12" rx="2" opacity="${BL[e.bleeding]}"/>`);
    if (e && e.mucus) out.push(`<text class="lab" x="${cx}" y="${by + 3 * rowH + 11}" text-anchor="middle">${MUC[e.mucus]}</text>`);
    if (e && e.sex) out.push(`<text class="lab" x="${cx}" y="${by + 4 * rowH + 11}" text-anchor="middle">♥</text>`);
    out.push(`<rect class="clickable" data-date="${date}" x="${left + i * colW}" y="0" width="${colW}" height="${H}" fill="transparent"/>`);
  }
  out.push('</svg>');
  return out.join('');
}

function renderCycleSummary(c) {
  const rows = [];
  const add = (k, v) => rows.push(`<dt>${k}</dt><dd>${v}</dd>`);
  add('Length', c.complete ? plural(c.length, 'day') : `${plural(c.days.length, 'day')} so far`);
  add('Period', plural(c.periodLength, 'day'));
  add('Temperatures', `${c.tempCount} valid`);
  if (c.shift) {
    const ruleName = { standard: '3 over 6', exception1: 'exception 1', exception2: 'exception 2' }[c.shift.rule];
    add('Temperature shift', c.shift.state === 'confirmed' ? `confirmed ${fmtDate(c.shift.confirmDate)} (${ruleName})` : 'awaiting confirmation');
    add('Coverline', fmtTemp(c.shift.coverline));
    if (c.firstHighCD) {
      add('First high temperature', `CD ${c.firstHighCD} · ${fmtDate(c.shift.firstHigh)}`);
      add('Estimated ovulation', `CD ${c.firstHighCD - 1} · ${fmtDate(c.ovulationEstimate)}`);
    }
  } else {
    add('Temperature shift', 'not detected');
  }
  if (c.lutealLength) add('Luteal phase', plural(c.lutealLength, 'day'));
  if (c.mucusRecorded) add('Mucus peak', c.peak ? fmtDate(c.peak.date) : 'not identified');
  add('Pre-ovulatory infertile', c.lastInfertileCD > 0 ? `CD 1–${c.lastInfertileCD} (${c.preRule})` : 'none');
  if (c.postInfertileFrom) add('Post-ovulatory infertile', `from evening of ${fmtDate(c.postInfertileFrom)}`);
  $('#cycle-summary').innerHTML = rows.join('');
}

// ---------- calendar ----------

function renderCalendar() {
  if (!calMonth) { const t = A.today; calMonth = [+t.slice(0, 4), +t.slice(5, 7) - 1]; }
  const [Y, M] = calMonth;
  const first = `${Y}-${String(M + 1).padStart(2, '0')}-01`;
  $('#month-label').textContent = new Date(Date.UTC(Y, M, 1)).toLocaleDateString(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const dow = (new Date(first + 'T00:00:00Z').getUTCDay() + 6) % 7; // Monday = 0
  const gridStart = addDays(first, -dow);
  const today = A.today;
  const ovDates = new Set(A.cycles.filter((c) => c.ovulationEstimate).map((c) => c.ovulationEstimate));
  const html = [];
  for (let i = 0; i < 42; i++) {
    const d = addDays(gridStart, i);
    const e = state.entries[d];
    const cls = [];
    if (+d.slice(5, 7) - 1 !== M) cls.push('out');
    if (d === today) cls.push('today');
    if (e && ['light', 'medium', 'heavy'].includes(e.bleeding)) cls.push('period');
    if (e && typeof e.temp === 'number') cls.push('temp');
    if (dayNum(d) <= dayNum(today)) {
      if (cycleFor(A, d) && dayStatus(A, d) === 'fertile') cls.push('fertile');
      if (ovDates.has(d)) cls.push('ov');
    }
    for (const l of predictedLabels(A, d)) {
      if (l === 'period' && !cls.includes('period')) cls.push('pred-period');
      if (l === 'fertile' && !cls.includes('fertile') && dayNum(d) > dayNum(today)) cls.push('fertile');
      if (l === 'ovulation') cls.push('ov');
    }
    html.push(`<button type="button" data-date="${d}" class="${[...new Set(cls)].join(' ')}" aria-label="${d}">${+d.slice(8)}</button>`);
  }
  $('#calendar').innerHTML = html.join('');
}

// ---------- stats ----------

function renderStats() {
  const s = A.stats;
  const rows = [];
  const add = (k, v) => rows.push(`<dt>${k}</dt><dd>${v}</dd>`);
  add('Completed cycles', s.cycleCount);
  add('Average cycle length', s.avgCycle == null ? '–' : `${fmtNum(s.avgCycle)} d` + (s.sdCycle != null ? ` ± ${fmtNum(s.sdCycle)}` : ''));
  add('Shortest / longest', s.minCycle == null ? '–' : `${s.minCycle} / ${s.maxCycle} d`);
  add('Average period', s.avgPeriod == null ? '–' : `${fmtNum(s.avgPeriod)} d`);
  add('Average luteal phase', s.avgLuteal == null ? '–' : `${fmtNum(s.avgLuteal)} d (min ${s.minLuteal})`);
  add('Average ovulation day', s.avgOvulationDay == null ? '–' : `CD ${fmtNum(s.avgOvulationDay)}`);
  add('Used for predictions', `cycle ${s.usedCycle} d, luteal ${s.usedLuteal} d, period ${s.usedPeriod} d`);
  add('Days logged', Object.keys(state.entries).length);
  $('#stats').innerHTML = rows.join('');

  const head = `<tr><th>Start</th><th>Days</th><th>Period</th><th>Ovul.</th><th>Luteal</th><th>CL °${unit()}</th></tr>`;
  const body = A.cycles.slice().reverse().map((c) => `<tr>
    <td>${fmtDate(c.start, { day: 'numeric', month: 'short' })}</td>
    <td>${c.complete ? c.length : c.days.length + '…'}</td>
    <td>${c.periodLength}</td>
    <td>${c.firstHighCD ? 'CD ' + (c.firstHighCD - 1) : '–'}</td>
    <td>${c.lutealLength || '–'}</td>
    <td>${c.shift ? fmtTemp(c.shift.coverline).split(' ')[0] : '–'}</td></tr>`).join('');
  $('#history').innerHTML = head + (body || '<tr><td colspan="6">No cycles yet</td></tr>');
}

// ---------- settings & data ----------

function renderSettings() {
  const f = $('#settings-form');
  for (const k of ['unit', 'cycleLength', 'lutealLength', 'periodLength']) f[k].value = state.settings[k];
}

function saveSettings() {
  const f = $('#settings-form');
  const num = (k, lo, hi) => {
    const v = parseInt(f[k].value, 10);
    return Number.isFinite(v) && v >= lo && v <= hi ? v : state.settings[k];
  };
  state.settings = {
    unit: f.unit.value === 'F' ? 'F' : 'C',
    cycleLength: num('cycleLength', 15, 60),
    lutealLength: num('lutealLength', 7, 20),
    periodLength: num('periodLength', 1, 12),
  };
  save();
  recompute();
  renderSettings();
  // keep the entry form in the new unit
  const d = $('#entry-form').date.value;
  if (d) loadEntry(d);
  msg('#data-msg', 'Settings saved.');
}

async function exportFile(name, text, mime) {
  const cap = window.Capacitor;
  try {
    if (cap && cap.isNativePlatform && cap.isNativePlatform()) {
      const { Filesystem, Share } = cap.Plugins || {};
      if (Filesystem && Share) {
        const r = await Filesystem.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
        await Share.share({ title: name, url: r.uri });
        return msg('#data-msg', 'Exported.');
      }
      throw new Error('no native share');
    }
    const file = new File([text], name, { type: mime });
    if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/.test(navigator.userAgent)) {
      await navigator.share({ files: [file], title: name });
      return msg('#data-msg', 'Exported.');
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(file);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    msg('#data-msg', `Downloaded ${name}.`);
  } catch (e) {
    if (e && e.name === 'AbortError') return;
    // Fallback: show the text so it can be copied.
    const ta = $('#export-text');
    ta.hidden = false;
    ta.value = text;
    ta.select();
    try { await navigator.clipboard.writeText(text); msg('#data-msg', 'Copied to clipboard (also shown above).'); }
    catch { msg('#data-msg', 'Copy the text above and keep it somewhere safe.'); }
  }
}

function stamp() {
  return localToday();
}

async function importFile(ev) {
  const file = ev.target.files[0];
  ev.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    let entries, settings;
    if (/^\s*\{/.test(text)) {
      const j = JSON.parse(text);
      entries = j.entries || {};
      settings = j.settings;
    } else {
      entries = fromCSV(text);
    }
    const n = Object.keys(entries).length;
    if (!n) throw new Error('no entries found');
    const replace = confirm(`Import ${n} days.\nOK = replace current data, Cancel = merge into current data.`);
    state.entries = replace ? entries : { ...state.entries, ...entries };
    if (settings) state.settings = { ...DEFAULT_SETTINGS, ...settings };
    save();
    refresh();
    msg('#data-msg', `Imported ${n} days.`);
  } catch (e) {
    msg('#data-msg', 'Import failed: ' + e.message, true);
  }
}

// Deterministic demo data: 4 cycles ending today.
export function demoEntries(today = localToday()) {
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const lengths = [28, 30, 27];
  const total = lengths.reduce((a, b) => a + b, 0) + 12;
  let start = addDays(today, -total + 1);
  const entries = {};
  const mk = (len, cd0Rise, upTo) => {
    for (let i = 0; i < Math.min(len, upTo); i++) {
      const d = addDays(start, i);
      const cd = i + 1;
      const high = cd >= cd0Rise;
      const e = { temp: Math.round(((high ? 36.75 : 36.4) + (rnd() - 0.5) * 0.18) * 100) / 100, time: '06:30' };
      if (cd <= 5) e.bleeding = cd <= 2 ? 'heavy' : cd <= 4 ? 'medium' : 'light';
      const r = cd - cd0Rise;
      if (cd > 5) e.mucus = r < -7 ? 'dry' : r < -5 ? 'moist' : r < -3 ? 'creamy' : r < 0 ? 'eggwhite' : r < 2 ? 'creamy' : 'dry';
      if (cd === 9 || cd === 20) e.sex = true;
      entries[d] = e;
    }
  };
  lengths.forEach((len, k) => { mk(len, len - 13 + (k % 2), len); start = addDays(start, len); });
  mk(28, 15, 12);
  const sick = addDays(today, -20);
  if (entries[sick]) { entries[sick].temp = 37.3; entries[sick].excluded = true; entries[sick].note = 'cold'; }
  return entries;
}

// ---------- events ----------

function bind() {
  $$('.tabbar button').forEach((b) => b.addEventListener('click', () => show(b.dataset.view)));
  $('#entry-form').addEventListener('submit', saveEntry);
  $('#entry-form').date.addEventListener('change', (e) => e.target.value && loadEntry(e.target.value));
  $('#delete-entry').addEventListener('click', deleteEntry);
  $$('.chips').forEach((g) => g.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const on = b.classList.contains('on');
    $$('button', g).forEach((x) => x.classList.remove('on'));
    if (!on) b.classList.add('on');
  }));
  $('#cycle-prev').addEventListener('click', () => { chartIndex--; renderChart(); });
  $('#cycle-next').addEventListener('click', () => { chartIndex++; renderChart(); });
  $('#chart-wrap').addEventListener('click', (e) => {
    const r = e.target.closest('[data-date]');
    if (r && dayNum(r.dataset.date) <= dayNum(localToday())) openEntry(r.dataset.date);
  });
  $('#month-prev').addEventListener('click', () => { calMonth = calMonth[1] ? [calMonth[0], calMonth[1] - 1] : [calMonth[0] - 1, 11]; renderCalendar(); });
  $('#month-next').addEventListener('click', () => { calMonth = calMonth[1] < 11 ? [calMonth[0], calMonth[1] + 1] : [calMonth[0] + 1, 0]; renderCalendar(); });
  $('#calendar').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-date]');
    if (!b) return;
    if (dayNum(b.dataset.date) > dayNum(localToday())) return;
    openEntry(b.dataset.date);
  });
  $('#settings-form').addEventListener('change', saveSettings);
  $('#export-json').addEventListener('click', () =>
    exportFile(`cyclsius-${stamp()}.json`, JSON.stringify({ app: 'cyclsius', version: 1, ...state }, null, 1), 'application/json'));
  $('#export-csv').addEventListener('click', () => exportFile(`cyclsius-${stamp()}.csv`, toCSV(state.entries), 'text/csv'));
  $('#import-file').addEventListener('change', importFile);
  $('#load-demo').addEventListener('click', () => {
    if (Object.keys(state.entries).length && !confirm('Replace your data with demo data?')) return;
    state.entries = demoEntries();
    save();
    chartIndex = null;
    $('#entry-form').date.value = '';
    refresh();
    msg('#data-msg', 'Demo data loaded.');
  });
  $('#clear-all').addEventListener('click', () => {
    if (!confirm('Delete ALL data permanently?')) return;
    state.entries = {};
    save();
    chartIndex = null;
    $('#entry-form').date.value = '';
    refresh();
    msg('#data-msg', 'All data deleted.');
  });
  // Refresh "today" when the app comes back after midnight.
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && A && A.today !== localToday()) {
      $('#entry-form').date.value = '';
      refresh();
    }
  });
}

function init() {
  recompute();
  bind();
  show('today');
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  const native = window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform();
  if ('serviceWorker' in navigator && !native && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW failed', e));
  }
  window.__app = { get state() { return state; }, get analysis() { return A; } };
}

init();
