import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays, diffDays, findCycleStarts, findTemperatureShift, findMucusPeak, analyze,
  dayStatus, predictedLabels, toCSV, fromCSV, cToF, fToC,
} from '../www/cycle.js';

const T = (date, t) => ({ date, t: Math.round(t * 100) });
const seq = (start, temps) => temps.map((t, i) => T(addDays(start, i), t));

// Build entries for a cycle: period days, temps array (null = missing).
function makeCycle(entries, start, { period = 5, temps = [], mucus = {} } = {}) {
  temps.forEach((t, i) => {
    const d = addDays(start, i);
    entries[d] = { ...(entries[d] || {}) };
    if (t !== null) entries[d].temp = t;
  });
  for (let i = 0; i < period; i++) {
    const d = addDays(start, i);
    entries[d] = { ...(entries[d] || {}), bleeding: i < 2 ? 'medium' : 'light' };
  }
  for (const [k, m] of Object.entries(mucus)) {
    const d = addDays(start, Number(k) - 1);
    entries[d] = { ...(entries[d] || {}), mucus: m };
  }
}

// 28-day cycle with a rise on cycle day 15 (index 14).
const LOW = [36.4, 36.5, 36.4, 36.3, 36.4, 36.5, 36.4, 36.3, 36.4, 36.5, 36.4, 36.3, 36.5, 36.4];
const HIGH = [36.7, 36.8, 36.8, 36.9, 36.8, 36.9, 36.8, 36.9, 36.8, 36.9, 36.8, 36.8, 36.7, 36.6];
const CYCLE28 = [...LOW, ...HIGH];

test('date helpers', () => {
  assert.equal(addDays('2026-02-27', 2), '2026-03-01');
  assert.equal(addDays('2024-02-28', 1), '2024-02-29');
  assert.equal(diffDays('2026-03-29', '2026-03-28'), 1); // across EU DST change
  assert.equal(diffDays('2027-01-01', '2026-12-31'), 1);
});

test('unit conversion', () => {
  assert.ok(Math.abs(cToF(37) - 98.6) < 1e-9);
  assert.ok(Math.abs(fToC(98.6) - 37) < 1e-9);
});

test('standard 3 over 6 rule', () => {
  const temps = seq('2026-01-01', [36.4, 36.5, 36.4, 36.3, 36.4, 36.5, 36.6, 36.7, 36.7]);
  const s = findTemperatureShift(temps);
  assert.equal(s.state, 'confirmed');
  assert.equal(s.rule, 'standard');
  assert.equal(s.coverline, 36.5);
  assert.equal(s.firstHigh, '2026-01-07');
  assert.equal(s.confirmDate, '2026-01-09');
});

test('third high exactly 0.2 above coverline counts (no float error)', () => {
  const temps = seq('2026-01-01', [36.1, 36.1, 36.1, 36.1, 36.1, 36.1, 36.15, 36.2, 36.3]);
  const s = findTemperatureShift(temps);
  assert.equal(s.state, 'confirmed');
  assert.equal(s.rule, 'standard');
});

test('exception 1: third high below +0.2 needs a fourth high', () => {
  const base = [36.4, 36.5, 36.4, 36.3, 36.4, 36.5, 36.6, 36.6, 36.6];
  assert.equal(findTemperatureShift(seq('2026-01-01', base)).state, 'pending');
  const s = findTemperatureShift(seq('2026-01-01', [...base, 36.6]));
  assert.equal(s.state, 'confirmed');
  assert.equal(s.rule, 'exception1');
  assert.equal(s.confirmDate, '2026-01-10');
});

test('exception 2: one dip on/below the coverline is skipped', () => {
  const s = findTemperatureShift(seq('2026-01-01', [36.4, 36.5, 36.4, 36.3, 36.4, 36.5, 36.6, 36.5, 36.7, 36.7]));
  assert.equal(s.state, 'confirmed');
  assert.equal(s.rule, 'exception2');
  assert.equal(s.firstHigh, '2026-01-07');
  assert.equal(s.confirmDate, '2026-01-10');
});

test('no shift for flat temperatures, pending for a lone high', () => {
  assert.equal(findTemperatureShift(seq('2026-01-01', [36.4, 36.5, 36.4, 36.5, 36.4, 36.5, 36.4, 36.5])), null);
  assert.equal(findTemperatureShift(seq('2026-01-01', [36.4, 36.5, 36.4, 36.5, 36.4, 36.5, 36.8])).state, 'pending');
  assert.equal(findTemperatureShift(seq('2026-01-01', [36.4, 36.4, 36.4])), null);
});

test('isolated high followed by low values does not confirm', () => {
  const s = findTemperatureShift(seq('2026-01-01', [36.4, 36.5, 36.4, 36.3, 36.4, 36.5, 36.8, 36.4, 36.4, 36.5, 36.4]));
  assert.equal(!!(s && s.state === 'confirmed'), false);
});

test('mucus peak needs 3 lower-quality days', () => {
  const days = ['dry', 'nothing', 'moist', 'creamy', 'eggwhite', 'eggwhite', 'creamy', 'moist', 'dry']
    .map((m, i) => ({ date: addDays('2026-01-01', i), rank: { dry: 1, nothing: 2, moist: 3, creamy: 4, eggwhite: 5 }[m] }));
  const p = findMucusPeak(days);
  assert.equal(p.date, '2026-01-06');
  assert.equal(p.confirmDate, '2026-01-09');
  assert.equal(findMucusPeak(days.slice(0, 8)), null);
});

test('cycle detection ignores short gaps and spotting', () => {
  const e = {};
  makeCycle(e, '2026-01-01', { period: 5 });
  e['2026-01-14'] = { bleeding: 'light' }; // mid-cycle bleed, < 10 days? no: 13 days -> new start
  e['2026-01-08'] = { bleeding: 'light' }; // 7 days after start -> ignored
  e['2026-01-20'] = { bleeding: 'spotting' };
  const starts = findCycleStarts(e);
  assert.deepEqual(starts, ['2026-01-01', '2026-01-14']);
});

test('full analysis over three cycles', () => {
  const e = {};
  makeCycle(e, '2026-01-01', { temps: CYCLE28 });
  makeCycle(e, '2026-01-29', { temps: [...LOW, ...HIGH, 36.7, 36.8] }); // 30 days
  makeCycle(e, '2026-02-28', { temps: LOW.slice(0, 10) });
  const a = analyze(e, {}, '2026-03-09');
  assert.equal(a.cycles.length, 3);
  assert.equal(a.cycles[0].length, 28);
  assert.equal(a.cycles[1].length, 30);
  assert.equal(a.cycles[0].periodLength, 5);
  assert.equal(a.cycles[0].shift.state, 'confirmed');
  assert.equal(a.cycles[0].firstHighCD, 15);
  assert.equal(a.cycles[0].ovulationEstimate, '2026-01-14');
  assert.equal(a.cycles[0].lutealLength, 14);
  assert.equal(a.cycles[1].lutealLength, 16);
  assert.equal(a.stats.cycleCount, 2);
  assert.equal(a.stats.avgCycle, 29);
  assert.equal(a.stats.minCycle, 28);
  assert.equal(a.stats.avgLuteal, 15);
  assert.equal(a.stats.avgOvulationDay, 14);
  assert.equal(a.stats.avgPeriod, 5);
  // current cycle: 29-day average -> next period on Feb 28 + 29
  const p = a.predictions;
  assert.equal(p.nextPeriod, '2026-03-29');
  assert.equal(p.ovulation, addDays('2026-03-29', -16));
  assert.equal(p.daysUntilPeriod, 20);
  // first cycle: 5-day rule; later cycles: min(5, 15-8=7) -> 5
  assert.equal(a.cycles[0].lastInfertileCD, 5);
  assert.equal(a.cycles[2].lastInfertileCD, 5);
});

test('day status through a cycle (temperature only)', () => {
  const e = {};
  makeCycle(e, '2026-01-01', { temps: CYCLE28 });
  makeCycle(e, '2026-01-29', { temps: [36.4] });
  const a = analyze(e, {}, '2026-01-29');
  const c = a.cycles[0];
  assert.equal(c.shift.confirmDate, '2026-01-17');
  assert.equal(dayStatus(a, '2026-01-02'), 'period');
  assert.equal(dayStatus(a, '2026-01-06'), 'fertile'); // CD6 > 5
  assert.equal(dayStatus(a, '2026-01-17'), 'fertile'); // infertile only from that evening
  assert.equal(dayStatus(a, '2026-01-18'), 'infertile-post');
  assert.equal(dayStatus(a, '2025-12-01'), 'unknown');
});

test('mucus delays post-ovulatory infertility and shortens pre-ovulatory phase', () => {
  const e = {};
  makeCycle(e, '2026-01-01', {
    period: 3,
    temps: CYCLE28,
    mucus: { 4: 'moist', 10: 'creamy', 15: 'eggwhite', 16: 'eggwhite', 17: 'creamy', 18: 'moist', 19: 'dry', 20: 'dry' },
  });
  const a = analyze(e, {}, '2026-01-25');
  const c = a.cycles[0];
  assert.equal(c.peak.date, '2026-01-16');
  assert.equal(c.postInfertileFrom, '2026-01-19'); // peak + 3 is later than temp confirmation
  assert.equal(c.lastInfertileCD, 3);
  assert.equal(dayStatus(a, '2026-01-19'), 'fertile');
  assert.equal(dayStatus(a, '2026-01-20'), 'infertile-post');
  assert.equal(dayStatus(a, '2026-01-04'), 'fertile');
});

test('minus-8 rule from previous early ovulation', () => {
  const e = {};
  // rise on CD 11 -> minus-8 gives CD 3
  const early = [36.4, 36.5, 36.4, 36.3, 36.4, 36.5, 36.4, 36.3, 36.4, 36.5, ...HIGH];
  makeCycle(e, '2026-01-01', { temps: early });
  makeCycle(e, '2026-01-25', { temps: [36.4, 36.4] });
  const a = analyze(e, {}, '2026-01-26');
  assert.equal(a.cycles[0].firstHighCD, 11);
  assert.equal(a.cycles[1].lastInfertileCD, 3);
  assert.equal(a.cycles[1].preRule, 'minus-8 rule');
});

test('late period and possible pregnancy flag', () => {
  const e = {};
  makeCycle(e, '2026-01-01', { temps: [...LOW, ...HIGH, 36.9, 36.9, 36.9, 36.9, 36.9, 36.9] });
  const a = analyze(e, {}, '2026-02-02');
  assert.equal(a.predictions.nextPeriod, '2026-01-29'); // first high Jan 15 + 14
  assert.equal(a.predictions.late, 4);
  assert.equal(a.predictions.highTempDays, 19);
  assert.equal(a.predictions.possiblePregnancy, true);
});

test('disturbed (excluded) temperatures are ignored', () => {
  const e = {};
  makeCycle(e, '2026-01-01', { temps: CYCLE28 });
  e['2026-01-10'] = { temp: 37.5, excluded: true };
  const a = analyze(e, {}, '2026-01-28');
  assert.equal(a.cycles[0].shift.firstHigh, '2026-01-15');
  assert.equal(a.cycles[0].shift.coverline, 36.5);
});

test('predicted calendar labels', () => {
  const e = {};
  makeCycle(e, '2026-01-01', { temps: [36.4, 36.4, 36.4] });
  const a = analyze(e, {}, '2026-01-03');
  assert.equal(a.predictions.nextPeriod, '2026-01-29');
  assert.equal(a.predictions.ovulation, '2026-01-14');
  assert.ok(predictedLabels(a, '2026-01-14').includes('ovulation'));
  assert.ok(predictedLabels(a, '2026-01-10').includes('fertile'));
  assert.ok(predictedLabels(a, '2026-01-30').includes('period'));
  assert.deepEqual(predictedLabels(a, '2026-01-20'), []);
});

test('empty data', () => {
  const a = analyze({}, {}, '2026-01-01');
  assert.equal(a.cycles.length, 0);
  assert.equal(a.predictions, null);
  assert.equal(dayStatus(a, '2026-01-01'), 'unknown');
});

test('CSV round trip', () => {
  const e = {
    '2026-01-01': { temp: 36.45, bleeding: 'heavy', time: '06:30' },
    '2026-01-02': { temp: 36.5, excluded: true, mucus: 'creamy', sex: true, note: 'cold, "fever"' },
  };
  assert.deepEqual(fromCSV(toCSV(e)), e);
});

test('a pending (unconfirmed) rise is not used for predictions', () => {
  const e = {};
  makeCycle(e, '2026-01-01', { temps: [...LOW.slice(0, 10), 36.8] });
  const a = analyze(e, {}, '2026-01-11');
  assert.equal(a.current.shift.state, 'pending');
  assert.equal(a.current.ovulationEstimate, undefined);
  assert.equal(a.predictions.ovulationConfirmed, false);
  assert.equal(a.predictions.nextPeriod, '2026-01-29');
});

test('readings are rounded to 0.05 so a +0.01 blip is not a rise', () => {
  const e = {};
  makeCycle(e, '2026-01-01', { temps: [36.31, 36.48, 36.36, 36.35, 36.44, 36.41, 36.37, 36.45, 36.45, 36.41,
    36.43, 36.42, 36.46, 36.35, 36.73, 36.79, 36.79, 36.67] });
  const c = analyze(e, {}, '2026-01-18').current;
  assert.equal(c.shift.firstHigh, '2026-01-15');
  assert.equal(c.shift.rule, 'standard');
  assert.equal(c.shift.confirmDate, '2026-01-17');
});
