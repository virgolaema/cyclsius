// Pure cycle / basal body temperature calculations (no DOM).
// Temperatures are stored in °C. Internally they are compared as integer
// hundredths of a degree to avoid floating point issues.
//
// Rules follow the symptothermal method (Sensiplan style):
//  - temperature shift: "3 over 6" with exceptions 1 and 2
//  - cervical mucus peak + 3 days
//  - pre-ovulatory infertile days: 5-day rule / minus-8 rule
// Calendar predictions use averages of past cycles.

export const BLEEDING = ['none', 'spotting', 'light', 'medium', 'heavy'];
export const MUCUS = ['dry', 'nothing', 'moist', 'creamy', 'eggwhite'];
const MUCUS_RANK = { dry: 1, nothing: 2, moist: 3, creamy: 4, eggwhite: 5 };
const FERTILE_MUCUS_RANK = 3;

export const DEFAULT_SETTINGS = {
  unit: 'C',
  lutealLength: 14,
  cycleLength: 28,
  periodLength: 5,
};

// ---------- dates (UTC day numbers, no DST problems) ----------

export function dayNum(s) {
  const [y, m, d] = s.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 864e5);
}

export function fromDayNum(n) {
  return new Date(n * 864e5).toISOString().slice(0, 10);
}

export function addDays(s, k) {
  return fromDayNum(dayNum(s) + k);
}

export function diffDays(a, b) {
  return dayNum(a) - dayNum(b);
}

export function localToday() {
  const d = new Date();
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// ---------- units ----------

export const cToF = (c) => c * 9 / 5 + 32;
export const fToC = (f) => (f - 32) * 5 / 9;

// ---------- helpers ----------

const isPeriodBleeding = (e) => !!e && ['light', 'medium', 'heavy'].includes(e.bleeding);
const anyBleeding = (e) => !!e && !!e.bleeding && e.bleeding !== 'none';
const mucusRank = (e) => (e && e.mucus ? MUCUS_RANK[e.mucus] || 0 : 0);

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
}

function sd(xs) {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

// ---------- cycle detection ----------

// A cycle starts on the first day of period bleeding (light/medium/heavy)
// that follows a day without period bleeding, and at least MIN_GAP days
// after the previous start (shorter gaps are treated as irregular bleeding).
const MIN_GAP = 10;

export function findCycleStarts(entries) {
  const dates = Object.keys(entries).filter((d) => isPeriodBleeding(entries[d])).sort();
  const starts = [];
  for (const d of dates) {
    if (isPeriodBleeding(entries[addDays(d, -1)])) continue;
    if (starts.length && diffDays(d, starts[starts.length - 1]) < MIN_GAP) continue;
    starts.push(d);
  }
  return starts;
}

// ---------- temperature shift ----------

// temps: [{ date, t }] sorted by date, t = hundredths of °C, disturbed values removed.
// Returns null, { state: 'pending', ... } or { state: 'confirmed', ... }.
export function findTemperatureShift(temps) {
  const n = temps.length;
  for (let i = 6; i < n; i++) {
    const cl = Math.max(...temps.slice(i - 6, i).map((x) => x.t));
    if (temps[i].t <= cl) continue;
    const r = evalShiftAt(temps, i, cl);
    if (r.state === 'fail') continue;
    const out = {
      state: r.state,
      firstHigh: temps[i].date,
      coverline: cl / 100,
      lowDates: temps.slice(i - 6, i).map((x) => x.date),
    };
    if (r.state === 'confirmed') {
      out.confirmDate = temps[r.at].date;
      out.rule = r.rule;
    }
    return out;
  }
  return null;
}

function evalShiftAt(T, i, cl) {
  const thr = cl + 20;
  const v = (k) => (i + k < T.length ? T[i + k].t : undefined);
  const pending = { state: 'pending' };
  const fail = { state: 'fail' };
  const a = v(1), b = v(2), c = v(3);
  if (a === undefined) return pending;
  if (a > cl) {
    if (b === undefined) return pending;
    if (b >= thr) return { state: 'confirmed', at: i + 2, rule: 'standard' };
    if (b > cl) {
      // Exception 1: third high is not 0.2 above the coverline -> a 4th high is needed.
      if (c === undefined) return pending;
      return c > cl ? { state: 'confirmed', at: i + 3, rule: 'exception1' } : fail;
    }
    // Exception 2: H1 H2 dip H3, H3 must be >= coverline + 0.2
    if (c === undefined) return pending;
    return c >= thr ? { state: 'confirmed', at: i + 3, rule: 'exception2' } : fail;
  }
  // Exception 2: H1 dip H2 H3
  if (b === undefined) return pending;
  if (b <= cl) return fail;
  if (c === undefined) return pending;
  return c >= thr ? { state: 'confirmed', at: i + 3, rule: 'exception2' } : fail;
}

// ---------- cervical mucus peak ----------

// Peak day: last day of the best mucus quality so far (rank >= moist),
// followed by 3 recorded days of lower quality.
export function findMucusPeak(days) {
  // days: [{ date, rank }] for consecutive calendar days of the cycle (rank 0 = not recorded)
  let best = 0;
  for (let i = 0; i < days.length; i++) {
    const r = days[i].rank;
    if (r >= FERTILE_MUCUS_RANK && r >= best) {
      const next = days.slice(i + 1, i + 4);
      if (next.length === 3 && next.every((d) => d.rank > 0 && d.rank < r)) {
        return { date: days[i].date, confirmDate: next[2].date };
      }
    }
    best = Math.max(best, r);
  }
  return null;
}

// ---------- per-cycle analysis ----------

function analyzeCycle(entries, start, end, lastDataDate) {
  const last = end || lastDataDate;
  const days = [];
  for (let n = dayNum(start); n <= dayNum(last); n++) {
    const date = fromDayNum(n);
    days.push({ date, cd: n - dayNum(start) + 1, entry: entries[date] || null });
  }
  const temps = days
    .filter((d) => d.entry && typeof d.entry.temp === 'number' && !d.entry.excluded)
    // Rounded to 0.05 °C (Sensiplan practice) so tiny noise does not count as a rise.
    .map((d) => ({ date: d.date, t: Math.round(d.entry.temp * 20) * 5 }));

  let periodLength = 0;
  for (const d of days) {
    if (anyBleeding(d.entry)) periodLength++;
    else break;
  }

  const shift = findTemperatureShift(temps);
  const mucusRecorded = days.some((d) => mucusRank(d.entry) > 0);
  const peak = mucusRecorded
    ? findMucusPeak(days.map((d) => ({ date: d.date, rank: mucusRank(d.entry) })))
    : null;
  const firstMucusDay = days.find((d) => mucusRank(d.entry) >= FERTILE_MUCUS_RANK);

  const c = {
    start,
    end,
    complete: !!end,
    length: end ? diffDays(end, start) + 1 : null,
    days,
    periodLength,
    shift,
    peak,
    mucusRecorded,
    firstMucusDate: firstMucusDay ? firstMucusDay.date : null,
    tempCount: temps.length,
  };

  // Only a confirmed shift is used for ovulation estimates and predictions.
  if (shift && shift.state === 'confirmed') {
    c.firstHighCD = diffDays(shift.firstHigh, start) + 1;
    c.ovulationEstimate = addDays(shift.firstHigh, -1);
    if (end) c.lutealLength = diffDays(end, shift.firstHigh) + 1;
  }

  // Start of post-ovulatory infertility (from the evening of this date).
  if (shift && shift.state === 'confirmed') {
    if (!mucusRecorded) c.postInfertileFrom = shift.confirmDate;
    else if (peak) {
      c.postInfertileFrom = dayNum(peak.confirmDate) > dayNum(shift.confirmDate)
        ? peak.confirmDate : shift.confirmDate;
    }
  }
  return c;
}

// ---------- full analysis ----------

export function analyze(entries, settings = {}, today = localToday()) {
  settings = { ...DEFAULT_SETTINGS, ...settings };
  const dates = Object.keys(entries).sort();
  const starts = findCycleStarts(entries);
  const lastDataDate = [dates[dates.length - 1], today].filter(Boolean).sort().pop();

  const cycles = starts.map((s, i) =>
    analyzeCycle(entries, s, i + 1 < starts.length ? addDays(starts[i + 1], -1) : null, lastDataDate));

  // Pre-ovulatory infertile days per cycle, using only the history before it.
  cycles.forEach((c, i) => {
    const prevHighs = cycles.slice(0, i).filter((p) => p.shift && p.shift.state === 'confirmed')
      .map((p) => p.firstHighCD);
    let lastInfertileCD = 5;
    let rule = '5-day rule';
    if (prevHighs.length) {
      const minus8 = Math.min(...prevHighs) - 8;
      if (prevHighs.length >= 12 || minus8 < 5) {
        lastInfertileCD = minus8;
        rule = 'minus-8 rule';
      }
    }
    lastInfertileCD = Math.max(0, lastInfertileCD);
    if (c.firstMucusDate) {
      const mcd = diffDays(c.firstMucusDate, c.start) + 1;
      if (mcd <= lastInfertileCD) {
        lastInfertileCD = mcd - 1;
        rule = 'mucus observed';
      }
    }
    c.lastInfertileCD = lastInfertileCD;
    c.preRule = rule;
  });

  const completed = cycles.filter((c) => c.complete);
  const recent = completed.slice(-6);
  const lengths = completed.map((c) => c.length);
  const luteals = completed.filter((c) => c.lutealLength).map((c) => c.lutealLength);
  const periods = cycles.filter((c) => c.complete || c.periodLength < c.days.length)
    .map((c) => c.periodLength).filter((x) => x > 0);
  const ovDays = cycles.filter((c) => c.shift && c.shift.state === 'confirmed').map((c) => c.firstHighCD - 1);

  const avgCycle = recent.length ? mean(recent.map((c) => c.length)) : settings.cycleLength;
  const avgLuteal = luteals.length ? mean(luteals.slice(-6)) : settings.lutealLength;
  const avgPeriod = periods.length ? mean(periods.slice(-6)) : settings.periodLength;

  const stats = {
    cycleCount: completed.length,
    avgCycle: lengths.length ? mean(lengths) : null,
    sdCycle: sd(lengths),
    minCycle: lengths.length ? Math.min(...lengths) : null,
    maxCycle: lengths.length ? Math.max(...lengths) : null,
    avgPeriod: periods.length ? mean(periods) : null,
    avgLuteal: luteals.length ? mean(luteals) : null,
    minLuteal: luteals.length ? Math.min(...luteals) : null,
    avgOvulationDay: ovDays.length ? mean(ovDays) : null,
    shortLuteal: luteals.some((l) => l < 10),
    usedCycle: Math.round(avgCycle),
    usedLuteal: Math.round(avgLuteal),
    usedPeriod: Math.round(avgPeriod),
  };

  const current = cycles.length ? cycles[cycles.length - 1] : null;
  const predictions = predict(current, stats, today);
  return { cycles, current, stats, predictions, settings, today };
}

function predict(current, stats, today) {
  if (!current) return null;
  const L = stats.usedLuteal, C = stats.usedCycle, P = stats.usedPeriod;
  const confirmed = !!(current.shift && current.shift.state === 'confirmed');
  let nextPeriod, basis;
  if (confirmed) {
    nextPeriod = addDays(current.shift.firstHigh, L);
    basis = 'temperature shift + luteal length';
  } else {
    nextPeriod = addDays(current.start, C);
    basis = 'average cycle length';
  }
  const ovulation = confirmed ? current.ovulationEstimate : addDays(nextPeriod, -L - 1);
  const p = {
    nextPeriod,
    basis,
    ovulation,
    ovulationConfirmed: confirmed,
    fertileWindow: [addDays(ovulation, -5), addDays(ovulation, 1)],
    daysUntilPeriod: diffDays(nextPeriod, today),
    future: [],
  };
  p.late = p.daysUntilPeriod < 0 ? -p.daysUntilPeriod : 0;
  if (confirmed) {
    p.highTempDays = diffDays(today, current.shift.firstHigh) + 1;
    p.possiblePregnancy = p.highTempDays >= 18;
  }
  // Project upcoming cycles for the calendar.
  let s = dayNum(nextPeriod) < dayNum(today) ? today : nextPeriod;
  for (let k = 0; k < 6; k++) {
    const ov = addDays(s, C - L - 1);
    p.future.push({ start: s, periodEnd: addDays(s, P - 1), ovulation: ov,
      fertileWindow: [addDays(ov, -5), addDays(ov, 1)] });
    s = addDays(s, C);
  }
  return p;
}

// ---------- day status ----------

// Returns one of: 'period', 'infertile-pre', 'fertile', 'infertile-post', 'unknown'
export function dayStatus(analysis, date) {
  const c = cycleFor(analysis, date);
  if (!c) return 'unknown';
  const d = c.days.find((x) => x.date === date);
  const cd = diffDays(date, c.start) + 1;
  if (d && isPeriodBleeding(d.entry)) return 'period';
  if (c.postInfertileFrom && dayNum(date) > dayNum(c.postInfertileFrom)) return 'infertile-post';
  if (cd <= c.lastInfertileCD) return 'infertile-pre';
  return 'fertile';
}

export function cycleFor(analysis, date) {
  const n = dayNum(date);
  for (let i = analysis.cycles.length - 1; i >= 0; i--) {
    const c = analysis.cycles[i];
    if (n >= dayNum(c.start) && (!c.end || n <= dayNum(c.end))) return c;
  }
  return null;
}

// Prediction labels for a calendar day outside recorded data.
export function predictedLabels(analysis, date) {
  const p = analysis.predictions;
  const out = [];
  if (!p) return out;
  const n = dayNum(date);
  const inRange = (a, b) => n >= dayNum(a) && n <= dayNum(b);
  if (dayNum(date) > dayNum(analysis.today)) {
    for (const f of p.future) {
      if (inRange(f.start, f.periodEnd)) out.push('period');
      if (inRange(f.fertileWindow[0], f.fertileWindow[1])) out.push('fertile');
      if (date === f.ovulation) out.push('ovulation');
    }
  }
  if (!p.ovulationConfirmed && inRange(p.fertileWindow[0], p.fertileWindow[1])) out.push('fertile');
  if (!p.ovulationConfirmed && date === p.ovulation) out.push('ovulation');
  return [...new Set(out)];
}

// ---------- import / export ----------

export function toCSV(entries) {
  const head = 'date,temp_c,excluded,time,bleeding,mucus,sex,note';
  const rows = Object.keys(entries).sort().map((d) => {
    const e = entries[d];
    const note = (e.note || '').replace(/"/g, '""');
    return [d, e.temp ?? '', e.excluded ? 1 : 0, e.time || '', e.bleeding || '', e.mucus || '',
      e.sex ? 1 : 0, `"${note}"`].join(',');
  });
  return [head, ...rows].join('\n') + '\n';
}

export function fromCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  const head = lines.shift().split(',').map((h) => h.trim());
  const idx = (k) => head.indexOf(k);
  const out = {};
  for (const line of lines) {
    const cols = parseCSVLine(line);
    const date = cols[idx('date')];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) continue;
    const t = parseFloat(cols[idx('temp_c')]);
    const e = {};
    if (!Number.isNaN(t)) e.temp = t;
    if (cols[idx('excluded')] === '1') e.excluded = true;
    if (idx('time') >= 0 && cols[idx('time')]) e.time = cols[idx('time')];
    if (BLEEDING.includes(cols[idx('bleeding')])) e.bleeding = cols[idx('bleeding')];
    if (MUCUS.includes(cols[idx('mucus')])) e.mucus = cols[idx('mucus')];
    if (cols[idx('sex')] === '1') e.sex = true;
    if (idx('note') >= 0 && cols[idx('note')]) e.note = cols[idx('note')];
    out[date] = e;
  }
  return out;
}

function parseCSVLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') q = false;
      else cur += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
