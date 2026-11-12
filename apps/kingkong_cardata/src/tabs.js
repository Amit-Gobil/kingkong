'use strict';
/*
 * tabs.js - kingkong_cardata 1.3.0: what the pages ported from cauliflowermossgrape/idrive7-apps show (Fuel,
 * Trips, Transmission, Details in groups), as element options for ScreenApp.set - each view returns
 * { <element name>: opts }, the names of scripts/oap-tools/make_cardash_project.js - and Transmission's two pictures as
 * RGBA pixels (renderer kit/record.js makeImage). Pure: no I/O, the time is passed in. Node 8. Self-check: node tabs.js
 *
 *   fuelView(series, now, paused)   Fuel. series: { iat, heat, hpfp, lpfp, timing, boost, boostT }: the values of
 *                               the last 5 minutes, oldest first; now: the same keys, the values now (undefined = none)
 *   tripsView(t)                Trips. t: { tc: trips.js Trips, now, period: 0 today | 1 7 days | 2 30 days, currency,
 *                               flow: { lph, per100 } or null, running, paused }
 *   transView(s)                Transmission. s: { id, live, adapt, hist, paused }: transmission.js identify / readLive /
 *                               readAdaptations / readHistory results, null = not read yet
 *   detailsView(res, asked, total, links, paused)   Details. res: engine-groups.js readAll() (null while its first pass
 *                               runs), asked / total: identifiers asked in it so far / in the catalog, links: Data links rows
 *   paused: polling paused - each page's frame says so (as Engine's) and shows no values
 *   clutchBars(adapt), oilBands(hist)          the pictures' values: 5 x bar or null, 5 x % or null
 *   clutchPixels(bars), bandPixels(percents)   -> { w, h, data } (RGBA)
 *   SLOTS                       Details: [group, column, rows] for each group's place on the page
 */
const isNum = (x) => typeof x === 'number' && isFinite(x);
const fx = (x, d) => (isNum(x) ? x.toFixed(d) : '--');
const p2 = (n) => (n < 10 ? '0' : '') + n;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const clock = (ms) => { const d = new Date(ms); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };
const day = (ms) => { const d = new Date(ms); return `${d.getDate()} ${MON[d.getMonth()]}`; };
const dur = (ms) => `${Math.floor(ms / 3600000)}:${p2(Math.floor(ms / 60000) % 60)}`;

// ---- Fuel: each tile a value with its last 5 minutes (features.js carFuel) -------------------------------------
const FUEL = [['iat', '°C', 0, 'last 5 min'], ['hpfp', 'bar', 0, 'last 5 min'], ['lpfp', 'bar', 1, 'last 5 min'],
    ['heat', '°C', 0, 'heat soak'], ['timing', '°', 1, 'before TDC']];
function span(v) {           // a trace's scale: its lowest to highest value with a little room around
    if (!v.length) return { lo: 0, hi: 1, min: null, max: null };
    const min = Math.min.apply(null, v), max = Math.max.apply(null, v);
    const pad = max > min ? (max - min) * 0.15 : Math.max(Math.abs(max) * 0.05, 0.05);
    return { lo: min - pad, hi: max + pad, min, max };
}
const pts = (v, d) => v.map((x) => +x.toFixed(d + 1));
// polling paused (main.js: 30 min after the last tab tap, or hidden): every page's frame says so, as Engine's
const PAUSED = () => ({ chips: [['Paused', 'warn']], sub: 'Paused · open a tab to resume' });
function fuelView(series, now, paused, ethanol) {
    if (paused) { series = {}; now = {}; ethanol = null; }       // no values from before the pause
    const out = { fuelMenu: paused ? PAUSED() : { chips: [], sub: 'From the DME · each with its last 5 minutes' } };
    // Always show etanol (UDS 550D) so G81 can be checked vs MHD even when the DME has not answered yet
    out.ethanolFuel = { value: isNum(ethanol) ? ethanol : null, label: 'Etanol (UDS 550D)', unit: '%' };
    FUEL.forEach(([k, unit, d, what], i) => {
        const v = series[k] || [], s = span(v);
        out[`fuel${i}`] = { value: fx(now[k], d), unit, points: pts(v, d), lo: s.lo, hi: s.hi,
            foot: v.length ? `${what} · min ${fx(s.min, d)} · max ${fx(s.max, d)}` : 'no value from the DME yet' };
    });
    const b = series.boost || [], t = series.boostT || [], s = span(b.concat(t));
    out.fuel5 = { value: fx(now.boost, 2), unit: 'bar', points: pts(b, 2), points2: t.length ? pts(t, 2) : '', lo: s.lo, hi: s.hi,
        legend: t.length ? 'Actual, Target' : '',
        foot: !isNum(now.boost) ? 'no value from the DME yet'
            : `actual ${fx(now.boost, 2)}${isNum(now.boostT) ? ` · target ${fx(now.boostT, 2)}` : ''} · last 5 min` };
    return out;
}

// ---- Trips (features.js carTrips; no trips yet: features3.js carTripsEmpty) -------------------------------------------
const TRIP_SHOWN = ['lastTitle', 'tl0', 'tl1', 'tl2', 'tl3', 'tl4', 'tl5', 'tv0', 'tv1', 'tv2', 'tv3', 'tv4', 'tv5', 'tripLine', 'tripTable',
    'tripPeriod', 'tripTotals'];
const TRIP_EMPTY = ['emptyTable', 'tripsEmpty', 'emptyPeriod', 'emptyTotals'];
const PERIODS = ['today', 'week', 'month'];
const per100 = (km, l) => (km >= 1 && isNum(l) ? l / km * 100 : null);
function tripsView(t) {
    const tc = t.tc, cur = tc.cur, tr = cur || tc.trips[tc.trips.length - 1], cu = t.currency, fl = t.flow, out = {};
    // the frame: the fuel flow now while the engine runs (once there is a figure)
    out.tripsMenu = t.paused ? PAUSED() : { chips: !t.running ? [['Engine off', 'dim']] : fl && isNum(fl.lph)
        ? [[`Now ${fx(fl.lph, 1)} l/h · ${isNum(fl.per100) ? `${fx(fl.per100, 1)} l/100 km` : 'standing'}`, 'accent']] : [['No fuel figure yet', 'dim']],
    sub: 'Counted while Kingkong runs, also with its screen closed' };
    TRIP_SHOWN.forEach((n) => { out[n] = { hidden: !tr }; });
    TRIP_EMPTY.forEach((n) => { out[n] = { hidden: !!tr }; });
    const tot = tc.total(PERIODS[t.period], t.now), avg = per100(tot.km, tot.l);
    const price = ['Fuel price', tc.price ? `${tc.price.toFixed(2)} ${cu}/l` : 'not set', 'accent'];
    if (!tr) {
        out.emptyTotals.rows = [['Trips', '0'], ['Distance', '--'], ['Fuel', '--'], ['Average', '--'], price];
        return out;
    }
    const sm = tc.summary(tr);
    out.lastTitle.text = (cur ? `This trip · since ${day(tr.start)}, ${clock(tr.start)}` : `Last trip · ${day(tr.start)}, ${clock(tr.start)} - ${clock(tr.end)}`).toUpperCase();
    [[fx(sm.km, 1), 'km'], [fx(sm.l, 2), 'l'], [fx(sm.per100, 1), 'l/100 km'], [fx(sm.cost, 2), cu], [dur(sm.driveMs + sm.idleMs), 'h'], [fx(sm.avgKmh, 0), 'km/h']]
        .forEach(([value, unit], i) => Object.assign(out[`tv${i}`], { value, unit }));
    const known = (x) => x !== null && x !== undefined;
    out.tripLine.text = [`standing ${fx(tr.lIdle, 2)} l`, `top speed ${fx(tr.vmax, 0)} km/h`,
        known(tr.odo0) ? `odometer ${tr.odo0} - ${tr.odo1} km` : null, known(tr.tank0) ? `tank ${tr.tank0} - ${tr.tank1} l` : null,
        tr.noFuelMs > 60000 ? `no fuel figure for ${dur(tr.noFuelMs)} h` : null].filter(Boolean).join(' · ');
    // the last 5 kept, newest first; their l/100 km green well under the period's average, amber well over it
    out.tripTable.rows = tc.trips.slice(-5).reverse().map((x) => {
        const s = tc.summary(x), c = !isNum(s.per100) || !isNum(avg) ? '' : s.per100 < avg * 0.9 ? 'ok' : s.per100 > avg * 1.2 ? 'warn' : '';
        return [`${day(x.start)}, ${clock(x.start)}`, `${dur(s.driveMs + s.idleMs)} h`, `${fx(s.km, 1)} km`, `${fx(s.l, 2)} l`, [fx(s.per100, 1), c],
            `${fx(s.cost, 2)} ${cu}`, `${fx(s.vmax, 0)} km/h`];
    });
    out.tripPeriod.sel = t.period;
    out.tripTotals.rows = [['Trips', String(tot.n)], ['Distance', `${fx(tot.km, 1)} km`], ['Fuel', `${fx(tot.l, 1)} l`],
        ['Average', isNum(avg) ? `${fx(avg, 1)} l/100 km` : '--'], price];
    return out;
}

// ---- Transmission (features2.js carTrans; unknown variant: features3.js carTransUnknown) -------------------------------
const FIVE = [0, 1, 2, 3, 4];
const KNOWN = ['liveTitle', 'transGear', 'oilTemp', 'oilCaption', 'liveKv', 'vline1', 'adaptTitle', 'adaptLine', 'clutchPic', 'vline2',
    'histTitle', 'histPic', 'histKv'].concat(FIVE.reduce((a, i) => a.concat([`clutch${i}`, `clutchVal${i}`, `clutchHair${i}`, `band${i}`, `bandPct${i}`]), []));
const UNKNOWN = ['transEmpty', 'transCode', 'transCaption', 'transHint'];
const rpm = (x) => (isNum(x) ? `${Math.round(x)} rpm` : '--');
const nice = (s) => (s ? s.charAt(0) + s.slice(1).toLowerCase() : '--');   // 'LOCKED HIGH' -> 'Locked high'
/** the clutch A-E fill pressure offsets (mbar) in bar */
const clutchBars = (a) => FIVE.map((i) => { const c = a && a.clutches && a.clutches[i]; return c && isNum(c.pressure) ? c.pressure / 1000 : null; });
// the kit's 23 bands (transmission.js RANGES) in five: < 40, 40-70, 70-100, 100-120, > 120 °C
const BANDS = [[0, 4], [4, 6], [6, 10], [10, 14], [14, 23]];
const oilBands = (h) => BANDS.map(([a, b]) => (h && h.oil ? h.oil.bands.slice(a, b).reduce((s, x) => s + (x.percent || 0), 0) : null));
function transView(s) {
    const id = s.id, ok = !!(id && id.supported), out = {};
    KNOWN.forEach((n) => { out[n] = { hidden: !ok }; });
    UNKNOWN.forEach((n) => { out[n] = { hidden: ok }; });
    out.transmissionMenu = s.paused ? PAUSED() : { chips: [['Experimental', 'warn'], ['Read-only', 'dim']],
        sub: ok ? 'ZF 8HP · read from the gearbox unit, nothing is written' : 'Read from the gearbox unit, nothing is written' };
    if (!ok) {     // not read yet, no answer, or a variant the kit's decoders were not checked on (nothing else is asked)
        const unknown = !!(id && id.variant);
        Object.assign(out.transEmpty, { icon: id ? 'info' : 'refresh',
            head: !id ? 'Reading the gearbox unit' : unknown ? 'This gearbox variant is not supported yet' : 'The gearbox unit does not answer' });
        out.transCode.text = unknown ? id.variant : '';
        out.transCaption.text = unknown ? 'VARIANT READ FROM THE GEARBOX UNIT' : '';
        out.transHint.text = !id ? '' : unknown ? 'Its values show here once this variant is added.' : 'It answers with the ignition on.';
        return out;
    }
    const l = (!s.paused && s.live) || {}, h = s.hist || {}, g = l.gear || null, prog = l.program || null;
    out.transGear.text = g && prog && /^[DM]$/.test(prog) && /^\d+$/.test(g) ? prog + g : g || prog || '-';
    out.oilTemp.value = fx(l.oilTemp, 0);
    out.liveKv.rows = [['Input speed', rpm(l.inputRpm)], ['Output speed', rpm(l.outputRpm)],
        ['Converter slip', id.converter === false ? 'none (no converter)' : rpm(l.slip)],
        ['Lock-up clutch', nice(l.lockup), /^LOCKED/.test(l.lockup || '') ? 'ok' : ''], ['Selector', prog || '--']];
    clutchBars(s.adapt).forEach((b, i) => Object.assign(out[`clutchVal${i}`], { text: isNum(b) ? `${b >= 0 ? '+' : ''}${b.toFixed(2)} bar` : '--',
        color: isNum(b) && Math.abs(b) > 0.25 ? '#ffb020' : '#f2f2f2' }));
    oilBands(h).forEach((p, i) => { out[`bandPct${i}`].text = isNum(p) ? `${Math.round(p)} %` : '--'; });
    out.histKv.rows = [['Operating hours', isNum(h.operatingHours) ? `${Math.round(h.operatingHours)} h` : '--'], ['Gearbox unit', `${id.name} · ${id.variant}`]];
    return out;
}
// the pictures (RGBA): at(x, y) -> [r, g, b, a] or null (see-through)
function pixels(w, h, at) {
    const data = Buffer.alloc(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const c = at(x, y); if (c) data.set(c, (y * w + x) * 4); }
    return { w, h, data };
}
const rgba = (hex, a) => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), a === undefined ? 255 : a];
const TRACK = rgba('#16191e'), AMBER = rgba('#ffb020'), WHITE = rgba('#f2f2f2'), RED = rgba('#ff3b30'), BAR = rgba('#ffb020', 217);
// five rows of 37 px (drawn 74 high): the track, the offset from the middle (0.4 bar = the whole half), the middle mark
function clutchPixels(bars) {
    return pixels(200, 185, (x, y) => {
        const r = y % 37, b = bars[Math.floor(y / 37)];
        if (r >= 6 && r < 22 && (x === 99 || x === 100)) return WHITE;
        if (r < 11 || r >= 17) return null;
        const f = isNum(b) ? Math.min(1, Math.abs(b) / 0.4) * 90 : 0;
        return (b >= 0 ? x >= 100 && x < 100 + f : x < 100 && x >= 100 - f) ? AMBER : TRACK;
    });
}
// five bands of 68 px (a 60 px bar between 4 px gaps; drawn 170 wide: the head unit stretches a picture smoothly, so
// not 10 x), the percent as rows from the bottom
function bandPixels(percents) {
    return pixels(340, 100, (x, y) => {
        const i = Math.floor(x / 68), k = x % 68, p = percents[i];
        if (k < 4 || k >= 64 || !isNum(p) || 100 - y > Math.round(p)) return null;
        return i === 4 ? RED : i === 3 ? AMBER : BAR;
    });
}

// ---- Details: the engine unit's groups in eight fixed places (features2.js carDetails, partial: features3.js) ---------
const SLOTS = [['Engine', 0, 6], ['Oil', 0, 4], ['Temperatures', 1, 6], ['Fuel', 1, 4], ['Ignition and knock', 2, 7], ['VANOS', 2, 3],
    ['Injector corrections', 3, 6], ['Data links', 3, 4]];
const bare = (v) => (v.unit && v.text.slice(-v.unit.length - 1) === ` ${v.unit}` ? v.text.slice(0, -v.unit.length - 1) : v.text);
/** "X, cylinder 1" + "X, cylinder 2" -> "X cyl 1 · 2", "X" + "X target" -> "X · target": two values on one row */
function pairRows(values) {
    const out = [], cyl = /^(.*), cylinder (\d)$/;
    for (let i = 0; i < values.length; i++) {
        const a = values[i], b = values[i + 1], m = cyl.exec(a.name), n = b && cyl.exec(b.name), u = a.unit ? ` ${a.unit}` : '';
        if (m && n && m[1] === n[1]) { out.push([`${m[1]} cyl ${m[2]} · ${n[2]}`, `${bare(a)} · ${bare(b)}${u}`]); i++; }
        else if (b && b.name === `${a.name} target`) { out.push([`${a.name} · target`, `${bare(a)} · ${bare(b)}${u}`]); i++; }
        else out.push([a.name, a.text]);
    }
    return out;
}
const fit = (rows, n) => (rows.length <= n ? rows : rows.slice(0, n - 1).concat([[`… ${rows.length - n + 1} more`, '']]));
function detailsView(res, asked, total, links, paused) {
    if (paused) res = null;                      // paused: only the Data links
    const out = {}, first = !res && !paused, none = !!res && !res.read;
    SLOTS.forEach(([group, , n], i) => {
        const g = res && res.groups.filter((x) => x.group === group)[0];
        const rows = group === 'Data links' ? links : first ? [['Reading…', '']] : g ? pairRows(g.values) : null;
        const hide = !rows || (none && group !== 'Data links');
        out[`grp${i}`] = { hidden: hide };
        out[`grpKv${i}`] = hide ? { hidden: true } : { hidden: false, rows: fit(rows, n) };
    });
    out.detailsMenu = paused ? PAUSED() : { chips: first ? [['Reading…', 'info']] : none ? [['No answer', 'crit']] : [['Reading', 'ok']],
        sub: first ? 'Engine unit values in groups · reading the engine unit' : `Engine unit values in groups · ${res.read} of ${res.of} values read` };
    out.detailsProgress = first ? { hidden: false, value: total ? asked / total : 0, right: `${asked} of ${total}` } : { hidden: true };
    out.detailsEmpty = { hidden: !none };
    return out;
}

function test() {
    const assert = require('assert');
    const { Trips } = require('./trips.js');
    // Fuel
    let v = fuelView({}, {});
    assert.deepStrictEqual([v.fuel0.value, v.fuel0.foot, v.fuel5.legend, v.fuel5.points2], ['--', 'no value from the DME yet', '', '']);
    v = fuelView({ iat: [25, 31, 37], boost: [0.2, 1.12], boostT: [0.3, 1.18] }, { iat: 37, boost: 1.12, boostT: 1.18 });
    assert.deepStrictEqual([v.fuel0.value, v.fuel0.foot, v.fuel0.points], ['37', 'last 5 min · min 25 · max 37', [25, 31, 37]]);
    assert(v.fuel0.lo < 25 && v.fuel0.hi > 37, 'room around the trace');
    assert.deepStrictEqual([v.fuel5.value, v.fuel5.legend, v.fuel5.foot], ['1.12', 'Actual, Target', 'actual 1.12 · target 1.18 · last 5 min']);
    // Trips: none yet; then one kept (10 min at 60 km/h, 6 l/h) and one going on
    const T0 = new Date(2026, 10, 4, 10, 31).getTime();
    const tc = new Trips();
    let t = tripsView({ tc, now: T0, period: 1, currency: 'EUR', flow: null, running: false });
    assert.deepStrictEqual([t.tripsEmpty.hidden, t.tripTable.hidden, t.lastTitle.hidden, t.tripsMenu.chips], [false, true, true, [['Engine off', 'dim']]]);
    assert.deepStrictEqual(t.emptyTotals.rows[4], ['Fuel price', '1.80 EUR/l', 'accent']);
    for (let i = 0; i <= 600; i++) tc.feed(T0 + i * 1000, { running: 'running', speed: 60, lph: 6, src: '5656' });
    tc.feed(T0 + 600e3 + 11 * 60e3, { running: 'off', speed: 0 });                    // off 11 min: over
    tc.feed(T0 + 30 * 60e3, { running: 'running', speed: 30, lph: 3 });               // the next one
    t = tripsView({ tc, now: T0 + 30 * 60e3, period: 1, currency: 'EUR', flow: { lph: 3, per100: 10 }, running: true });
    assert(t.tripsEmpty.hidden && !t.tripTable.hidden && !t.lastTitle.hidden);
    assert.strictEqual(t.lastTitle.text, 'THIS TRIP · SINCE 4 NOV, 11:01');
    assert.deepStrictEqual(t.tripsMenu.chips, [['Now 3.0 l/h · 10.0 l/100 km', 'accent']]);
    assert.deepStrictEqual(t.tripTable.rows, [['4 Nov, 10:31', '0:10 h', '10.0 km', '1.00 l', ['10.0', ''], '1.80 EUR', '60 km/h']]);
    assert.deepStrictEqual(t.tripTotals.rows.slice(0, 2), [['Trips', '2'], ['Distance', '10.0 km']]);
    assert.deepStrictEqual(tripsView({ tc, now: T0, period: 0, currency: 'EUR', flow: { lph: 0.9, per100: null }, running: true }).tripsMenu.chips,
        [['Now 0.9 l/h · standing', 'accent']]);
    // Transmission
    let x = transView({ id: null });
    assert.deepStrictEqual([x.liveKv.hidden, x.transEmpty.hidden, x.transEmpty.head], [true, false, 'Reading the gearbox unit']);
    x = transView({ id: { supported: false, variant: '0F2D60', error: 'Unknown gearbox variant 0F2D60' } });
    assert.deepStrictEqual([x.transCode.text, x.transEmpty.head, x.transmissionMenu.sub],
        ['0F2D60', 'This gearbox variant is not supported yet', 'Read from the gearbox unit, nothing is written']);
    assert.strictEqual(transView({ id: { supported: false, variant: null, error: 'No response' } }).transEmpty.head, 'The gearbox unit does not answer');
    const id = { supported: true, variant: '0F25D0', name: 'GSZFBCE', converter: true };
    const bands = Array.from({ length: 23 }, (_, i) => ({ range: '', hours: 0, percent: i === 4 ? 25 : i === 7 ? 75 : 0 }));
    x = transView({ id, live: { gear: '3', program: 'D', oilTemp: 60, inputRpm: 800, outputRpm: 1200, engineRpm: 1000, slip: 200, lockup: 'LOCKED HIGH' },
        adapt: { clutches: [-120, 15, 0, -260, 48].map((p) => ({ pressure: p })) }, hist: { operatingHours: 100, oil: { bands } } });
    assert.deepStrictEqual([x.transGear.text, x.oilTemp.value, x.liveKv.hidden, x.transEmpty.hidden], ['D3', '60', false, true]);
    assert.deepStrictEqual([x.liveKv.rows[2], x.liveKv.rows[3]], [['Converter slip', '200 rpm'], ['Lock-up clutch', 'Locked high', 'ok']]);
    assert.deepStrictEqual([x.clutchVal0.text, x.clutchVal3.text, x.clutchVal3.color, x.clutchVal0.color], ['-0.12 bar', '-0.26 bar', '#ffb020', '#f2f2f2']);
    assert.deepStrictEqual(FIVE.map((i) => x[`bandPct${i}`].text), ['0 %', '25 %', '75 %', '0 %', '0 %']);
    assert.deepStrictEqual(x.histKv.rows, [['Operating hours', '100 h'], ['Gearbox unit', 'GSZFBCE · 0F25D0']]);
    const px = (p, xx, yy) => Array.from(p.data.slice((yy * p.w + xx) * 4, (yy * p.w + xx) * 4 + 4));
    const cp = clutchPixels(clutchBars({ clutches: [{ pressure: 200 }, { pressure: -200 }, { pressure: null }, {}, {}] }));   // +-0.2 bar: half way
    assert.deepStrictEqual([cp.w, cp.h, px(cp, 120, 13), px(cp, 80, 13)], [200, 185, AMBER, TRACK], 'clutch A: amber right of the middle');
    assert.deepStrictEqual(px(cp, 80, 37 + 13), AMBER, 'clutch B: amber left of the middle');
    assert.deepStrictEqual([px(cp, 99, 74 + 8), px(cp, 10, 2)], [WHITE, [0, 0, 0, 0]], 'the middle mark; see-through around the bars');
    const bp = bandPixels([0, 25, 75, 50, 10]);
    assert.deepStrictEqual([bp.w, bp.h, px(bp, 88, 99)[3], px(bp, 88, 75)[3], px(bp, 88, 74)[3], px(bp, 292, 95), px(bp, 66, 99)[3]],
        [340, 100, 217, 217, 0, RED, 0], 'band 2 25 % high, band 5 red, a gap between bands');
    // Details: the first pass, groups with pairs and a cut, nothing answered
    const links = [['Sources', 'all ok', 'ok']];
    let d = detailsView(null, 12, 89, links);
    assert.deepStrictEqual([d.detailsMenu.chips, d.detailsProgress.hidden, d.detailsProgress.right, d.grpKv0.rows, d.grpKv7.rows],
        [[['Reading…', 'info']], false, '12 of 89', [['Reading…', '']], links]);
    const grp = (group, values) => ({ group, values: values.map(([name, text, unit]) => ({ name, text, value: 0, unit })) });
    const cyls = (name, f, unit) => [1, 2, 3, 4, 5, 6].map((n) => [`${name}, cylinder ${n}`, f(n), unit]);
    const res = { read: 46, of: 76, groups: [grp('Engine', [['Engine speed', '1571 rpm', 'rpm']]),
        grp('Ignition and knock', [['Ignition angle', '10.8 °', '°']].concat(cyls('Ignition angle', (n) => `${n}.0 °`, '°'), [['Knock detected', 'no', '']],
            cyls('Misfires', () => '0', ''))),
        grp('VANOS', [['Intake camshaft', '84.0 °', '°'], ['Intake camshaft target', '85.0 °', '°']])] };
    d = detailsView(res, 0, 89, links);
    assert.deepStrictEqual([d.detailsMenu.sub, d.detailsProgress.hidden, d.grp0.hidden, d.grp1.hidden],
        ['Engine unit values in groups · 46 of 76 values read', true, false, true]);
    assert.deepStrictEqual(d.grpKv4.rows, [['Ignition angle', '10.8 °'], ['Ignition angle cyl 1 · 2', '1.0 · 2.0 °'], ['Ignition angle cyl 3 · 4', '3.0 · 4.0 °'],
        ['Ignition angle cyl 5 · 6', '5.0 · 6.0 °'], ['Knock detected', 'no'], ['Misfires cyl 1 · 2', '0 · 0'], ['… 2 more', '']]);
    assert.deepStrictEqual(d.grpKv5.rows, [['Intake camshaft · target', '84.0 · 85.0 °']]);
    d = detailsView({ read: 0, of: 76, groups: [] }, 0, 89, links);
    assert.deepStrictEqual([d.detailsEmpty.hidden, d.grp0.hidden, d.grp7.hidden, d.detailsMenu.chips], [false, true, false, [['No answer', 'crit']]]);
    // polling paused: every page's frame says so, no values (the Data links stay); live again: the page's own frame
    const P = { chips: [['Paused', 'warn']], sub: 'Paused · open a tab to resume' };
    d = detailsView(res, 0, 89, links, true);
    assert.deepStrictEqual([d.detailsMenu, d.grp0.hidden, d.grpKv0.hidden, d.grp7.hidden, d.detailsProgress.hidden, d.detailsEmpty.hidden], [P, true, true, false, true, true]);
    v = fuelView({ iat: [25, 31, 37] }, { iat: 37 }, true);
    assert.deepStrictEqual([v.fuelMenu, v.fuel0.value, v.fuel0.points], [P, '--', []]);
    assert.deepStrictEqual(fuelView({}, {}).fuelMenu, { chips: [], sub: 'From the DME · each with its last 5 minutes' });
    assert.deepStrictEqual(tripsView({ tc, now: T0, period: 0, currency: 'EUR', flow: { lph: 3, per100: 10 }, running: true, paused: true }).tripsMenu, P);
    assert.strictEqual(t.tripsMenu.sub, 'Counted while Kingkong runs, also with its screen closed');
    x = transView({ id, live: { gear: '3', program: 'D', oilTemp: 60 }, paused: true });
    assert.deepStrictEqual([x.transmissionMenu, x.transGear.text, x.oilTemp.value], [P, '-', '--']);
    assert.deepStrictEqual(transView({ id }).transmissionMenu.chips, [['Experimental', 'warn'], ['Read-only', 'dim']]);
    console.log('tabs self-check ok');
}

module.exports = { fuelView, tripsView, transView, detailsView, clutchBars, oilBands, clutchPixels, bandPixels, pairRows, SLOTS, test };
if (require.main === module) test();
