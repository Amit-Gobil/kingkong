'use strict';
/*
 * dpf.js - kingkong_cardata 1.4.0: the DPF tab (diesel cars) - the particulate filter as the diesel engine unit (DDE,
 * 0x12, the DME's address) sees it, UDS 22 only. Ported from 2bhacker9's DPF Monitor (cauliflowermossgrape/idrive7-apps
 * issue #88, "Feel free to use it"); its identifiers and scalings checked against the D83BX7C0 (DDE 8.3: B47 / B57 in the
 * G series) and D75BX7A0 SGBDs in PRG FILES. The D75 has no oil ash, no 5th history entry and its own exhaust
 * temperatures (each key's second candidate). Never run on a diesel. Pure apart from the time passed in. Node 8.
 * Self-check: node dpf.js
 *
 *   new Filter(learned)   learned: soot masses (g) at which this car's regenerations started (settings.json dpfLearned)
 *   .due(now)             the keys to read now: the fast ones on every call, the slow ones every 10 s, the history once a visit
 *   .request(key)         its 22 request (the candidate in use), null = the unit refused every candidate
 *   .got(key, u, now)     the unit's answer (62 ... / 7F ... / null = none) -> true when a regeneration start was learned
 *   .visit()              the page opened: its history read again
 *   .sample(now)          every 5 s: the traces' next points (their last 5 minutes)
 *   view(f, now, paused)  the page's element options (scripts/oap-tools/make_cardash_project.js names)
 *   DIDS                  every identifier it may ask (the e2e's allowlist)
 *
 * A regeneration counts as running while the regeneration request (22 44BB, PFltRgn_numRgn) is not 0 (as the original);
 * it taught the threshold when the soot then fell below 40 % of where it started.
 */
const isNum = (x) => typeof x === 'number' && isFinite(x);
// key: [[DID, bytes, factor, offset]] - candidates, the first the unit does not refuse wins; [min, max] plausible
const VALUES = {
    soot: [[[0x44BE, 2, 0.01525902, 0]], 0, 200],               // Russmasse g
    regen: [[[0x44BB, 1, 1, 0]], 0, 255],                       // Regenerationsanforderung
    dp: [[[0x44F8, 2, 0.04577707, -1000]], -200, 2000],         // korrigierter Differenzdruck hPa (= mbar)
    tDpf: [[[0x434A, 2, 0.1, -3276.7], [0x44EF, 2, 0.031281, -50]], -50, 1100],   // exhaust temperature before the DPF
    tCat: [[[0x4347, 2, 0.1, -3276.7], [0x44F2, 2, 0.031281, -50]], -50, 1100],   // before the oxidation catalyst
    sootSim: [[[0x44C1, 2, 0.01, 0]], 0, 200],                  // simulierte Russmasse g
    ash: [[[0x44BD, 2, 0.01525902, 0]], 0, 500],                // Oelaschemasse g
    dist: [[[0x44BF, 4, 0.001, 0]], 0, 100000],                 // m since the last successful regeneration -> km
    fuel: [[[0x44BC, 2, 0.01, 0]], 0, 655],                     // l since then
    time: [[[0x44B7, 4, 1, 0]], 0, 1e8],                        // s (engine running) since then
    avg: [[[0x44C7, 2, 1, 0]], 0, 20000],                       // average regeneration interval km
    count: [[[0x44B8, 2, 1, 0]], 0, 65535],                     // successful regenerations (stored)
};
for (let i = 0; i < 5; i++) VALUES[`h${i}`] = [[[0x44D1 + i, 4, 0.001, 0]], 1, 2000000];   // odometer (m -> km) at the last 5
const FAST = ['soot', 'regen', 'dp', 'tDpf', 'tCat'];
const SLOW = ['sootSim', 'ash', 'dist', 'fuel', 'time', 'avg', 'count'];
const HIST = [0, 1, 2, 3, 4].map((i) => `h${i}`);
const DIDS = [].concat(...Object.keys(VALUES).map((k) => VALUES[k][0].map((c) => c[0].toString(16).toUpperCase())));
const SLOW_MS = 10e3, FRESH = { fast: 5e3, slow: 60e3 };
const TYPICAL = 24;          // g: the start of a regeneration until one is seen (the original's default)

class Filter {
    constructor(learned) {
        this.learned = (Array.isArray(learned) ? learned : []).filter((x) => isNum(x) && x > 5).slice(0, 5);
        this.v = {}; this.at = {}; this.pick = {}; this.refused = {};   // per key: value, when, candidate in use, refused all
        this.slowAt = -Infinity; this.histDue = true; this.regen = null;
        this.series = { tDpf: [], tCat: [], dp: [] };
    }
    due(now) {
        let keys = FAST.slice();
        if (now - this.slowAt >= SLOW_MS) { this.slowAt = now; keys = keys.concat(SLOW); }
        if (this.histDue) { this.histDue = false; keys = keys.concat(HIST); }
        return keys.filter((k) => !this.refused[k]);
    }
    visit() { this.histDue = true; HIST.forEach((k) => { delete this.at[k]; }); }   // (no history from an earlier visit)
    request(key) {
        const c = VALUES[key][0][this.pick[key] || 0];
        return this.refused[key] || !c ? null : [0x22, c[0] >> 8, c[0] & 255];
    }
    got(key, u, now) {
        const [cands, min, max] = VALUES[key], i = this.pick[key] || 0, c = cands[i];
        if (!u || !c) return false;
        if (u[0] === 0x7F) {                    // refused (31 / 12: not this unit's identifier): the next candidate
            if (u[2] === 0x31 || u[2] === 0x12) { if (i + 1 < cands.length) this.pick[key] = i + 1; else this.refused[key] = true; }
            return false;
        }
        if (u[0] !== 0x62 || u.length < 3 + c[1]) return false;
        let raw = 0;
        for (let b = 0; b < c[1]; b++) raw = raw * 256 + u[3 + b];
        const v = raw * c[2] + c[3];
        if (!(v >= min && v <= max)) return false;
        this.v[key] = v; this.at[key] = now;
        return key === 'regen' ? this._regen(v > 0, now) : false;
    }
    /** the value while fresh (fast ones 5 s, the slow ones 60 s, the history for the visit), else undefined */
    value(key, now) {
        const ttl = FAST.indexOf(key) >= 0 ? FRESH.fast : HIST.indexOf(key) >= 0 ? Infinity : FRESH.slow;
        return now - (this.at[key] || -Infinity) < ttl ? this.v[key] : undefined;
    }
    _regen(on, now) {
        const soot = this.value('soot', now);
        if (on && !this.regen) { this.regen = { t0: now, soot }; return false; }
        if (on || !this.regen) return false;
        const r = this.regen;
        this.regen = null; this.histDue = true;  // over: the engine unit's history read again
        if (!(r.soot > 5 && isNum(soot) && soot < r.soot * 0.4)) return false;
        this.learned = [r.soot].concat(this.learned).slice(0, 5);
        return true;
    }
    threshold() { return this.learned.length ? this.learned.reduce((a, b) => a + b, 0) / this.learned.length : TYPICAL; }
    /** every fast value refused: not a diesel engine unit (or it has none of these identifiers) */
    none() { return FAST.every((k) => this.refused[k]); }
    sample(now) {
        Object.keys(this.series).forEach((k) => {
            const v = this.value(k, now), s = this.series[k];
            if (!isNum(v)) return;
            s.push(v);
            if (s.length > 60) s.shift();
        });
    }
}

// ---- the page (features: the original's Overview + Live + History on one page; its Diagnostics in the app log) --------
const fx = (x, d) => (isNum(x) ? x.toFixed(d) : '--');
const p2 = (n) => (n < 10 ? '0' : '') + n;
const hm = (s) => (isNum(s) ? `${Math.floor(s / 3600)}:${p2(Math.floor(s / 60) % 60)}` : '--');
const ms = (s) => `${Math.floor(s / 60)}:${p2(Math.floor(s % 60))}`;
const km = (x) => (isNum(x) ? `${String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} km` : '--');
function span(v) {
    if (!v.length) return { lo: 0, hi: 1, min: null, max: null };
    const min = Math.min.apply(null, v), max = Math.max.apply(null, v), pad = max > min ? (max - min) * 0.15 : Math.max(Math.abs(max) * 0.05, 1);
    return { lo: min - pad, hi: max + pad, min, max };
}
const BODY = ['dpfSoot', 'dpfKv', 'dpfVline1', 'dpfTemp', 'dpfDp', 'dpfVline2', 'dpfHistTitle', 'dpfHist', 'dpfMore'];
const PAUSED = () => ({ chips: [['Paused', 'warn']], sub: 'Paused · open a tab to resume' });
function view(f, now, paused) {
    const out = {}, none = !paused && f.none(), v = (k) => (paused ? undefined : f.value(k, now));
    BODY.forEach((n) => { out[n] = { hidden: none }; });
    out.dpfEmpty = { hidden: !none };
    // running: by a fresh request (one seen before the page was left may have ended since)
    const thr = f.threshold(), soot = v('soot'), dist = v('dist'), on = !!f.regen && v('regen') > 0;
    const due = isNum(soot) && soot >= thr * 0.9;
    out.dpfMenu = paused ? PAUSED() : on ? { chips: [[`Regenerating · ${ms((now - f.regen.t0) / 1000)}`, 'warn'], ['Read-only', 'dim']], sub: 'Keep driving: don\'t switch the engine off now' }
        : { chips: [isNum(soot) ? (due ? ['Regeneration due', 'warn'] : ['Filter OK', 'ok']) : null, ['Experimental', 'warn'], ['Read-only', 'dim']].filter(Boolean),
            sub: 'From the diesel engine unit · nothing is written' };
    if (none) return out;
    // the soot against the start of a regeneration (learned from this car's, else typical); its last 10 % red
    const max = Math.max(10, Math.ceil(thr * 1.25 / 5) * 5);
    Object.assign(out.dpfSoot, { value: isNum(soot) ? +soot.toFixed(1) : null, max, limit: +thr.toFixed(1), ticks: max / 5,
        label: `Soot · regeneration at ~${fx(thr, 0)} g (${f.learned.length ? 'learned' : 'typical'})` });
    // km to go at the soot gathered per km since the last one (needs 10 km and 0.5 g of it)
    const left = isNum(soot) && isNum(dist) && dist >= 10 && soot >= 0.5 && !on ? Math.max(0, (thr - soot) / (soot / dist)) : null;
    out.dpfKv.rows = [['Since the last regeneration', km(dist)], ['Next one in about', isNum(left) ? km(Math.round(left / 10) * 10) : '--', due ? 'warn' : ''],
        ['Fuel since then', isNum(v('fuel')) ? `${fx(v('fuel'), 1)} l` : '--'], ['Engine running since then', isNum(v('time')) ? `${hm(v('time'))} h` : '--'],
        ['Regenerations so far', isNum(v('count')) ? String(Math.round(v('count'))) : '--']];
    const S = paused ? { tDpf: [], tCat: [], dp: [] } : f.series, tS = span(S.tDpf.concat(S.tCat)), dS = span(S.dp);
    Object.assign(out.dpfTemp, { value: fx(v('tDpf'), 0), points: S.tDpf.map(Math.round), points2: S.tCat.length ? S.tCat.map(Math.round) : '', lo: tS.lo, hi: tS.hi,
        legend: S.tCat.length ? 'Before DPF, Before cat' : '',
        foot: !isNum(v('tDpf')) ? 'no value from the engine unit yet' : `before the cat ${fx(v('tCat'), 0)} °C · last 5 min · a regeneration runs at ~600 °C` });
    Object.assign(out.dpfDp, { value: fx(v('dp'), 0), points: S.dp.map(Math.round), lo: dS.lo, hi: dS.hi,
        foot: !isNum(v('dp')) ? 'no value from the engine unit yet' : `across the filter · last 5 min · min ${fx(dS.min, 0)} · max ${fx(dS.max, 0)}` });
    // the engine unit's own memory: the odometer at its last five regenerations, newest first, and the km between them
    const h = HIST.map((k) => v(k)).filter(isNum);
    out.dpfHist.rows = h.length ? h.map((x, i) => [String(i + 1), km(x), isNum(h[i + 1]) ? km(x - h[i + 1]) : '--'])
        : [['--', f.refused.h0 ? 'not kept by this engine unit' : 'reading…', '']];
    out.dpfMore.rows = [['Average interval', isNum(v('avg')) ? km(v('avg')) : '--'], ['Oil ash', isNum(v('ash')) ? `${fx(v('ash'), 1)} g` : '--'],
        ['Soot, calculated', isNum(v('sootSim')) ? `${fx(v('sootSim'), 1)} g` : '--']];
    return out;
}

function test() {
    const assert = require('assert');
    const ans = (did, bytes) => [0x62, did >> 8, did & 255].concat(bytes);
    const f = new Filter([30, 'x', 2]);
    assert.deepStrictEqual(f.learned, [30], 'only plausible learned values');
    let k = f.due(0);
    assert.deepStrictEqual(k, FAST.concat(SLOW, HIST), 'the first call: everything');
    assert.deepStrictEqual(f.due(1000), FAST, 'then the fast ones');
    assert.deepStrictEqual(f.request('tDpf'), [0x22, 0x43, 0x4A]);
    // soot 0x060B * 0.01525902 = 23.6 g; dp raw 22700 -> 39.1 mbar; 434A refused (a D75): 44EF next
    f.got('soot', ans(0x44BE, [0x06, 0x0B]), 1000);
    f.got('dp', ans(0x44F8, [0x58, 0xAC]), 1000);
    f.got('tDpf', [0x7F, 0x22, 0x31], 1000);
    assert.deepStrictEqual(f.request('tDpf'), [0x22, 0x44, 0xEF], 'the second candidate');
    f.got('tDpf', ans(0x44EF, [0x2B, 0x00]), 1000);               // 11008 * 0.031281 - 50 = 294 °C
    f.got('dist', ans(0x44BF, [0x00, 0x02, 0x90, 0x40]), 1000);   // 168 000 m
    f.got('h0', ans(0x44D1, [0x02, 0xDF, 0x8C, 0xC8]), 1000);     // 48 205 km
    f.got('h1', ans(0x44D2, [0x02, 0xD9, 0x62, 0xA8]), 1000);     // 47 801 km
    f.got('h4', [0x7F, 0x22, 0x31], 1000);
    assert.deepStrictEqual([+f.value('soot', 1000).toFixed(1), +f.value('dp', 1000).toFixed(1), Math.round(f.value('tDpf', 1000)), f.value('dist', 1000)],
        [23.6, 39.1, 294, 168]);
    assert(f.refused.h4 && f.due(20000).indexOf('h4') < 0, 'a refused key is not asked again');
    assert.strictEqual(f.value('soot', 7000), undefined, 'a fast value 6 s old: not shown');
    assert.strictEqual(f.got('soot', ans(0x44BE, [0xFF, 0xFF]), 1000), false, 'implausible (1000 g): dropped');
    assert(+f.value('soot', 1000).toFixed(1) === 23.6);
    // the page: soot 23.6 of ~30 learned: due; 168 km at 0.14 g/km: ~45 km to go
    let o = view(f, 1000);
    assert.deepStrictEqual([o.dpfSoot.value, o.dpfSoot.max, o.dpfSoot.limit, o.dpfSoot.label], [23.6, 40, 30, 'Soot · regeneration at ~30 g (learned)']);
    assert.deepStrictEqual(o.dpfMenu.chips, [['Filter OK', 'ok'], ['Experimental', 'warn'], ['Read-only', 'dim']]);
    assert.deepStrictEqual(o.dpfKv.rows.slice(0, 2), [['Since the last regeneration', '168 km'], ['Next one in about', '50 km', '']]);
    assert.deepStrictEqual(o.dpfHist.rows, [['1', '48 205 km', '404 km'], ['2', '47 801 km', '--']]);
    assert.deepStrictEqual([o.dpfTemp.value, o.dpfEmpty.hidden, o.dpfSoot.hidden], ['294', true, false]);
    // a regeneration: request on, the soot burns off to 4 g, request off: 23.6 g learned, the history read again
    assert.strictEqual(f.got('regen', ans(0x44BB, [2]), 2000), false);
    assert.strictEqual(view(f, 9000).dpfMenu.chips[0][0], 'Experimental', 'the request 7 s old: not shown as running');
    f.got('regen', ans(0x44BB, [2]), 61000);
    o = view(f, 62000);
    assert.deepStrictEqual(o.dpfMenu.chips[0], ['Regenerating · 1:00', 'warn']);
    f.got('soot', ans(0x44BE, [0x01, 0x00]), 63000);              // 3.9 g
    assert.strictEqual(f.got('regen', ans(0x44BB, [0]), 63000), true, 'learned');
    assert.deepStrictEqual([f.learned.map((x) => +x.toFixed(1)), f.due(63000).indexOf('h0') >= 0], [[23.6, 30], true]);
    // an interrupted one (the soot stays): nothing learned
    f.got('regen', ans(0x44BB, [1]), 64000); f.got('soot', ans(0x44BE, [0x05, 0x00]), 64000); f.got('regen', ans(0x44BB, [0]), 65000);
    assert.strictEqual(f.learned.length, 2);
    // traces, the pause, not a diesel engine unit
    f.sample(65000); f.sample(65000);
    assert.deepStrictEqual(f.series.dp.length, 0, 'dp 64 s old: no point');
    f.got('dp', ans(0x44F8, [0x58, 0xAC]), 65000); f.sample(65000);
    assert.strictEqual(f.series.dp.length, 1);
    o = view(f, 65000, true);
    assert.deepStrictEqual([o.dpfMenu, o.dpfSoot.value, o.dpfDp.points], [PAUSED(), null, []]);
    const g = new Filter();
    FAST.forEach((x) => { g.got(x, [0x7F, 0x22, 0x31], 0); g.got(x, [0x7F, 0x22, 0x31], 0); });
    o = view(g, 0);
    assert.deepStrictEqual([g.none(), o.dpfEmpty.hidden, o.dpfSoot.hidden, g.threshold()], [true, false, true, 24]);
    assert.strictEqual(DIDS.length, 19);
    console.log('dpf self-check ok');
}

module.exports = { Filter, view, DIDS, BODY, test };
if (require.main === module) test();
