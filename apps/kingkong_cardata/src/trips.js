// Ported from cauliflowermossgrape/idrive7-apps (MIT License, Copyright (c) 2026 cauliflowermossgrape): apps/live_data/trips.js, signals.js, main.js @ c67ea17.
'use strict';
/*
 * trips.js - kingkong_cardata: the trip computer and the live fuel flow. Pure: no I/O, no timers, the time is
 * passed in (ms). Node 8.
 *
 * Trips: a trip runs from the engine's start until the engine has been off and the car standing END_MS (a stop to
 * refuel, auto start-stop at the lights: the same trip). It adds up the distance (the speed over time), the fuel
 * (l/h over time), the time driving and standing and the top speed; the cost is the litres x the fuel price (a
 * litre, in the UI's currency). A gap longer than MAX_DT between two samples is not counted. Kept (toJSON, a few kB
 * that never grow): the open trip, the last KEEP trips, a total a day for the last DAYS days and one over
 * everything. A finished trip keeps the price it had; one that had none takes the price once it is set.
 *
 *   const tc = Trips.fromJSON(saved, now);             // an open trip quiet for END_MS before now is closed
 *   tc.feed(now, { speed, lph, src, running, odo, tank }) -> { started, ended }   // ~2 a second; null = not known
 *   tc.cur, tc.trips (oldest first), tc.summary(trip), tc.total('today' | 'week' | 'month' | 'last' | 'all', now)
 *   tc.setPrice(1.799); tc.cost(trip); JSON.stringify(tc)
 *
 * FuelFlow: CDS2 statusInjectionVolume.injectionVolumeFuelEngine taken as a counter of injected fuel (UInt16, it
 * wraps): its rate in counts a second over at least 1 s; l/h = rate x k. k is learned per car from the engine
 * unit's own figure (refLph: UDS 22 5656 ml/s, OBD 01 5E l/h, UDS 22 4521 kg/h): the median of the last ratios
 * once they agree.
 *
 *   const flow = new FuelFlow(savedK); flow.feed(raw, t);
 *   if (flow.learn(refLph('5656', bytes), t)) save(flow.k);
 *   flow.lph(now), flow.per100(now, kmh)               // null without a learned k (no guess)
 *
 * UNVERIFIED on iDrive 8 (spec O3): that the signal is such a counter, and its scale. Read on mgu-m4 first.
 */
const END_MS = 10 * 60000;          // engine off and standing this long: the trip is over
const KEEP = 5, DAYS = 31;
const PRICE = 1.8;                  // the fuel price a new install starts with (a litre)
const MAX_DT = 5000;                // a longer gap between two samples isn't counted (the app was held up)
const DAY = 86400000;
const PETROL = 0.745;               // kg a litre (kit main.js; both our cars run on petrol)

const pad = (n) => (n < 10 ? '0' : '') + n;
const dayKey = (t) => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
const isNum = (x) => typeof x === 'number' && isFinite(x);
const num = (x) => (isNum(x) ? x : null);
const round = (x, d) => Math.round(x * Math.pow(10, d)) / Math.pow(10, d);
/** a total: its trips, km, litres, the cost of the litres that had a price, the litres that had none (lNp) */
const SUMS = ['n', 'km', 'l', 'cost', 'lNp'];
const blank = () => ({ n: 0, km: 0, l: 0, cost: 0, lNp: 0 });
const sums = (o) => { const a = blank(); SUMS.forEach((k) => { if (o && isNum(o[k])) a[k] = o[k]; }); return a; };
const valid = (tr) => !!tr && isNum(tr.start) && isNum(tr.end) && isNum(tr.km) && isNum(tr.l);
function add(a, tr) {
    a.n++; a.km += tr.km; a.l += tr.l;
    if (tr.price) a.cost += tr.l * tr.price; else a.lNp += tr.l;
}
const newTrip = (now, x) => ({ start: now, end: now, km: 0, l: 0, lIdle: 0, driveMs: 0, idleMs: 0, noFuelMs: 0, vmax: 0,
    odo0: num(x.odo), odo1: num(x.odo), tank0: num(x.tank), tank1: num(x.tank), src: {} });

/** l/100 km of a distance and its fuel, null below 1 km */
const per100 = (km, l) => (km >= 1 ? l / km * 100 : null);

class Trips {
    constructor(saved) {
        const s = saved && typeof saved === 'object' ? saved : {};
        this.cur = valid(s.cur) ? Object.assign(newTrip(s.cur.start, {}), s.cur, { src: s.cur.src && typeof s.cur.src === 'object' ? s.cur.src : {} }) : null;
        this.trips = Array.isArray(s.trips) ? s.trips.filter(valid).slice(-KEEP) : [];
        this.days = {};
        const days = s.days && typeof s.days === 'object' ? s.days : {};
        Object.keys(days).filter((k) => /^\d{4}-\d\d-\d\d$/.test(k)).sort().slice(-DAYS).forEach((k) => { this.days[k] = sums(days[k]); });
        this.all = Object.assign(sums(s.all), { since: s.all && isNum(s.all.since) ? s.all.since : null });
        this.price = isNum(s.price) ? Math.max(0, s.price) : PRICE;      // (none saved yet: the default)
        this.last = null;           // when the last sample came (not saved: after a restart nothing is counted over the gap)
        this.ver = 0;               // changes with every sample counted
    }

    /** the saved file at the app's start: an open trip whose last sign of life is END_MS before now is closed with it */
    static fromJSON(saved, now) {
        const tc = new Trips(saved);
        if (tc.cur && isNum(now) && now - tc.cur.end > END_MS) tc.finish();
        return tc;
    }

    /** running: 'running' | 'starting' | 'off' or true / false */
    feed(now, x) {
        x = x || {};
        const on = x.running === true || x.running === 'running' || x.running === 'starting';
        const v = isNum(x.speed) && x.speed > 0 ? x.speed : 0, moving = v > 2;
        let ended = null;
        // a trip whose last sign of life is END_MS old is over (the engine was off, or the head unit asleep)
        if (this.cur && now - this.cur.end > END_MS) ended = this.finish();
        if (!this.cur) {
            this.last = now;
            if (!on && !moving) return { started: false, ended };
            this.cur = newTrip(now, x);
            this.ver++;
            return { started: true, ended };
        }
        const c = this.cur, dt = this.last === null ? 0 : now - this.last;
        this.last = now;
        if (on || moving) c.end = now;
        if (isNum(x.odo)) { if (c.odo0 === null) c.odo0 = x.odo; c.odo1 = x.odo; }
        if (isNum(x.tank)) { if (c.tank0 === null) c.tank0 = x.tank; c.tank1 = x.tank; }
        if (dt <= 0 || dt > MAX_DT) return { started: false, ended };
        c.km += v * dt / 3600000;
        if (v > c.vmax) c.vmax = v;
        if (moving) c.driveMs += dt; else if (on) c.idleMs += dt;
        if (isNum(x.lph) && x.lph >= 0) {
            const l = x.lph * dt / 3600000;
            c.l += l;
            if (!moving) c.lIdle += l;
            if (x.src) c.src[x.src] = 1;
        } else if (on) c.noFuelMs += dt;
        this.ver++;
        return { started: false, ended };
    }

    /** ends the trip going on; returns it as kept, or null (started and stopped without going anywhere) */
    finish() {
        const c = this.cur;
        this.cur = null; this.ver++;
        if (!c || (c.km < 0.1 && c.l < 0.05)) return null;
        const tr = {
            start: c.start, end: c.end, km: round(c.km, 3), l: round(c.l, 4), lIdle: round(c.lIdle, 4),
            driveMs: c.driveMs, idleMs: c.idleMs, noFuelMs: c.noFuelMs, vmax: round(c.vmax, 1),
            odo0: c.odo0, odo1: c.odo1, tank0: c.tank0, tank1: c.tank1, price: this.price || null, src: Object.keys(c.src || {}).join('+') || null,
        };
        this.trips.push(tr);
        while (this.trips.length > KEEP) this.trips.shift();
        const k = dayKey(tr.start);
        add(this.days[k] || (this.days[k] = blank()), tr);
        const oldest = dayKey(tr.end - (DAYS - 1) * DAY);
        Object.keys(this.days).forEach((d) => { if (d < oldest) delete this.days[d]; });
        add(this.all, tr);
        if (!this.all.since) this.all.since = tr.start;
        return tr;
    }

    /** the price of a litre; 0 / not a number = none (costs then null). 3 decimals (kit: 2; pumps show 1.799) */
    setPrice(p) { this.price = isNum(p) && p > 0 ? round(p, 3) : 0; this.ver++; }
    /** what a trip cost: its own price, else the price now; null without either */
    cost(tr) {
        const p = tr && (tr.price || this.price);
        return p ? tr.l * p : null;
    }

    /**
     * A trip (kept or the open one) for the screen: { start, end, km, l, per100, cost, driveMs, idleMs, noFuelMs,
     * avgKmh, vmax }. avgKmh over the time driving + standing with the engine on. No fuel figure at all (no learned
     * scale, no engine unit): l, per100 and cost null; some missing: noFuelMs > 0.
     */
    summary(tr) {
        if (!valid(tr)) return null;
        const ms = tr.driveMs + tr.idleMs, noFuel = tr.l === 0 && tr.noFuelMs > 0;
        return { start: tr.start, end: tr.end, km: tr.km, l: noFuel ? null : tr.l, per100: noFuel ? null : per100(tr.km, tr.l),
            cost: noFuel ? null : this.cost(tr), driveMs: tr.driveMs, idleMs: tr.idleMs, noFuelMs: tr.noFuelMs,
            avgKmh: ms > 0 ? tr.km / ms * 3600000 : null, vmax: tr.vmax };
    }

    /**
     * A total: { n, km, l, cost } (cost null when there is fuel without a price). kind: 'last' (the last KEEP trips),
     * 'today', 'week' (7 days), 'month' (30 days), 'all'; all but 'last' with the trip going on.
     */
    total(kind, now) {
        const out = blank(), days = { today: 1, week: 7, month: 30 }[kind], from = days ? dayKey(now - (days - 1) * DAY) : null;
        if (kind === 'last') this.trips.forEach((tr) => add(out, tr));
        else if (kind === 'all') SUMS.forEach((k) => { out[k] = this.all[k] || 0; });
        else Object.keys(this.days).forEach((d) => { if (d >= from) SUMS.forEach((k) => { out[k] += this.days[d][k] || 0; }); });
        const c = this.cur;
        if (c && kind !== 'last' && (kind === 'all' || dayKey(c.start) >= from)) {
            out.n++; out.km += c.km; out.l += c.l; out.lNp += c.l;      // the trip going on: at the price now
        }
        const cost = out.cost + (this.price ? out.lNp * this.price : 0);
        return { n: out.n, km: out.km, l: out.l, cost: out.lNp > 1e-9 && !this.price ? null : cost };
    }

    toJSON() {
        return { v: 1, price: this.price, cur: this.cur, trips: this.trips, days: this.days, all: this.all };
    }
}

/**
 * Fuel flow from the fuel injection signal (kit signals.js Flow), taken as a counter of injected fuel (16 bit, it
 * wraps): its rate in counts a second, over at least one second; l/h = rate x k. k is learned from the engine unit's
 * own consumption: learn(l/h) while both are known, the middle of the last ratios once they agree.
 */
class FuelFlow {
    constructor(k) { this.k = isNum(k) && k > 0 ? k : null; this.last = null; this.acc = 0; this.accT = 0; this.rate = null; this.rateT = null; this.ratios = []; this.spread = null; }
    /** a value of the counter and when it came */
    feed(raw, t) {
        if (!isNum(raw) || !isNum(t)) return;
        if (this.last && t > this.last.t) {
            const d = (raw - this.last.raw + 65536) % 65536, dt = t - this.last.t;
            if (dt > MAX_DT || d > 40000) { this.acc = 0; this.accT = 0; }              // a gap or a reset: start again
            else {
                this.acc += d; this.accT += dt;
                if (this.accT >= 1000) { this.rate = this.acc / this.accT * 1000; this.rateT = t; this.acc = 0; this.accT = 0; }
            }
        }
        this.last = { raw, t };
    }
    /** counts a second now (0 once the signal stopped coming for 3 s: engine off) */
    rateAt(now) {
        if (!this.last) return null;
        if (now - this.last.t > 3000) return 0;
        return this.rate;
    }
    /** l/h now; null without a learned k or a rate */
    lph(now) { const r = this.rateAt(now); return r === null || !this.k ? null : r * this.k; }
    /** l/100 km now at kmh; null without l/h or below 5 km/h (standing: the screen says so from the speed) */
    per100(now, kmh) { const f = this.lph(now); return f === null || !isNum(kmh) || kmh < 5 ? null : f / kmh * 100; }
    /** the engine unit's l/h read at now: true when k changed by more than 2 % (time to save it) */
    learn(lph, now) {
        const r = this.rateAt(now);
        if (!(r > 0) || !(lph > 0.5) || now - (this.rateT || 0) > 1500) return false;
        this.ratios.push(lph / r);
        if (this.ratios.length > 30) this.ratios.shift();
        if (this.ratios.length < 10) return false;
        const s = this.ratios.slice().sort((a, b) => a - b), q1 = s[Math.floor(s.length / 4)], q3 = s[Math.floor(s.length * 3 / 4)];
        this.spread = q3 / q1;
        if (this.spread > 1.3) return false;                                                // they don't agree (yet): not a counter?
        const k = s[Math.floor(s.length / 2)], old = this.k;
        this.k = k;
        return !old || Math.abs(k - old) / old > 0.02;
    }
}

/**
 * The engine unit's own fuel figure, in the order to try (kit useful.js 'Fuel consumption' 5656 / OBD 5E, then
 * 'Fuel mass flow' 4521; scales from the kit's DME8FF_R catalog and std.js): k = l/h a count.
 */
const REFS = [
    { src: '5656', req: '22 5656', k: 0.00119209 * 3.6 },     // VOLUM_STROM_KRAFTST_MLS_LOKAL, ml/s
    { src: 'OBD 5E', req: '01 5E', k: 0.05 },                 // SAE J1979 engine fuel rate, l/h
    { src: '4521', req: '22 4521', k: 0.1 / PETROL },         // MASSENSTROM_KRAFTSTOFF, kg/h (petrol)
];
/** l/h from the answer's data bytes after the DID / PID echo (u16 big-endian); null when not a value */
function refLph(src, d) {
    const r = REFS.find((x) => x.src === src);
    if (!r || !d || d.length < 2) return null;
    const raw = d[0] * 256 + d[1];
    return raw === 0xFFFF ? null : raw * r.k;
}

function test() {
    const assert = require('assert');
    const near = (a, b, e) => assert(typeof a === 'number' && Math.abs(a - b) <= (e || 1e-6), a + ' != ' + b);
    const T0 = new Date(2026, 10, 4, 8, 0, 0).getTime();
    // a sample a second for s seconds after t; returns the last sample's time
    const drive = (tc, t, s, speed, lph, running) => {
        for (let i = 1; i <= s; i++) tc.feed(t + i * 1000, { speed, lph, running: running === undefined ? 'running' : running });
        return t + s * 1000;
    };
    // a whole trip from t: mins at speed / lph, then 10 min off; returns the trip kept
    const trip = (tc, t, mins, speed, lph) => { tc.feed(t, { running: 'running', speed }); return tc.feed(drive(tc, t, mins * 60, speed, lph) + END_MS + 1, { running: 'off', speed: 0 }).ended; };

    // start / end rules
    let tc = new Trips();
    assert.deepStrictEqual(tc.feed(T0, { running: 'off', speed: 0 }), { started: false, ended: null });
    assert.strictEqual(tc.cur, null);
    assert.strictEqual(tc.feed(T0 + 1000, { running: 'starting', speed: 0 }).started, true);
    let t = drive(tc, T0 + 1000, 3600, 60, 6);                       // 1 h at 60 km/h, 6 l/h
    near(tc.cur.km, 60); near(tc.cur.l, 6); assert.strictEqual(tc.cur.driveMs, 3600000);
    t = drive(tc, t, 60, 0, 0, 'off');                               // auto start-stop at the lights: the same trip
    assert.strictEqual(tc.cur.end, T0 + 1000 + 3600000);
    t = drive(tc, t, 60, 0, 0.8);                                    // idling: standing time, idle fuel
    assert.strictEqual(tc.cur.idleMs, 60000); near(tc.cur.lIdle, 0.8 / 60);
    assert.strictEqual(tc.feed(t + 9 * 60000, { running: 'off', speed: 0 }).ended, null);       // off 9 min: still on
    let r = tc.feed(t + END_MS + 1000, { running: 'off', speed: 0 });
    assert(r.ended && !r.started && tc.cur === null);
    assert.strictEqual(r.ended.end, t);                              // ends when the engine went off
    const sm = tc.summary(r.ended);
    near(sm.km, 60, 1e-3); near(sm.l, 6 + 0.8 / 60, 1e-3); near(sm.per100, (6 + 0.8 / 60) / 60 * 100, 1e-3);
    near(sm.avgKmh, 60 / 3660 * 3600, 1e-2); assert.strictEqual(sm.vmax, 60); near(sm.cost, sm.l * PRICE);
    tc = new Trips(); tc.feed(T0, { running: 'running' }); drive(tc, T0, 10, 0, 1);              // went nowhere: not kept
    assert.strictEqual(tc.feed(T0 + 10000 + END_MS + 1, { running: 'off' }).ended, null); assert.strictEqual(tc.trips.length, 0);

    // MAX_DT: a gap over 5 s is not counted; no fuel figure: counted as such
    tc = new Trips();
    tc.feed(T0, { running: 'running', speed: 100 });
    tc.feed(T0 + 6000, { running: 'running', speed: 100, lph: 10 });
    assert.strictEqual(tc.cur.km, 0); assert.strictEqual(tc.cur.l, 0);
    tc.feed(T0 + 7000, { running: 'running', speed: 100, lph: 10 });
    near(tc.cur.km, 100 / 3600); near(tc.cur.l, 10 / 3600);
    tc = new Trips(); tc.feed(T0, { running: true, speed: 60 }); drive(tc, T0, 600, 60, null);
    const nf = tc.summary(tc.cur);
    near(nf.km, 10); assert.deepStrictEqual([nf.l, nf.per100, nf.cost, nf.noFuelMs], [null, null, null, 600000]);

    // the 10-min close at start; nothing counted over a restart
    tc = new Trips(); tc.feed(T0, { running: 'running', speed: 50 });
    const tEnd = drive(tc, T0, 600, 50, 5);
    const saved = JSON.parse(JSON.stringify(tc));
    let back = Trips.fromJSON(saved, tEnd + 5 * 60000);
    assert(back.cur && back.cur.end === tEnd && back.trips.length === 0);
    back = Trips.fromJSON(saved, tEnd + END_MS + 1);
    assert.strictEqual(back.cur, null); assert.strictEqual(back.trips.length, 1); assert.strictEqual(back.trips[0].end, tEnd);
    near(back.trips[0].km, 50 * 600 / 3600, 1e-3); assert.strictEqual(back.all.n, 1);
    back = Trips.fromJSON(saved, tEnd + 1000); back.feed(tEnd + 2000, { running: 'running', speed: 50 });
    near(back.cur.km, saved.cur.km);
    assert.strictEqual(new Trips({ cur: { start: 'x' }, trips: [{}], days: { bad: {} } }).cur, null);

    // totals: trips 40, 10 and 2 days ago and today (30 km, 3 l each) + the open one (10 km, 1 l)
    tc = new Trips();
    [40, 10, 2, 0].forEach((d) => trip(tc, T0 - d * DAY, 30, 60, 6));
    tc.feed(T0 + 2 * 3600000, { running: 'running', speed: 60 });
    const now = drive(tc, T0 + 2 * 3600000, 600, 60, 6);
    const tot = (k) => { const x = tc.total(k, now); return [x.n, Math.round(x.km), Math.round(x.l)]; };
    assert.deepStrictEqual([tot('today'), tot('week'), tot('month'), tot('all'), tot('last')],
        [[2, 40, 4], [3, 70, 7], [4, 100, 10], [5, 130, 13], [4, 120, 12]]);
    assert.deepStrictEqual(Object.keys(tc.days).length, 3);          // the day 40 days ago: out of the 31 kept
    // cost: kept trips keep their price, the open one takes the price now; no price: null
    near(tc.total('today', now).cost, 3 * PRICE + 1 * PRICE, 1e-3);
    tc.setPrice(2);
    near(tc.total('today', now).cost, 3 * PRICE + 1 * 2, 1e-3); near(tc.cost(tc.trips[3]), 3 * PRICE, 1e-3);
    tc.setPrice(1.7994); assert.strictEqual(tc.price, 1.799);
    tc.setPrice(0);
    assert.strictEqual(tc.total('today', now).cost, null); assert.strictEqual(tc.cost(tc.cur), null);
    tc = new Trips({ price: 0 }); const np = trip(tc, T0, 30, 60, 6);
    assert.strictEqual(np.price, null); assert.strictEqual(tc.cost(np), null);
    tc.setPrice(1.5); near(tc.cost(np), 3 * 1.5, 1e-3); near(tc.total('last', T0).cost, 3 * 1.5, 1e-3);

    // fixed size: 60 days of trips
    tc = new Trips();
    for (let i = 0; i < 60; i++) trip(tc, T0 + i * DAY, 5, 60, 6);
    assert.strictEqual(tc.trips.length, KEEP); assert(Object.keys(tc.days).length <= DAYS); assert.strictEqual(tc.all.n, 60);
    assert(JSON.stringify(tc).length < 8000);

    // FuelFlow: 100 counts each 100 ms (1000 a second) from raw0; returns the last time
    const count = (fl, t0, t1, raw0) => { let raw = raw0; for (let ti = t0; ti <= t1; ti += 100) { fl.feed(raw, ti); raw = (raw + 100) % 65536; } return t1; };
    let fl = new FuelFlow();
    count(fl, 0, 1000, 65000);                                       // wraps at 65535 within this first second
    near(fl.rate, 1000);
    t = count(fl, 1100, 3000, (65000 + 1100) % 65536);
    assert.strictEqual(fl.lph(t), null); assert.strictEqual(fl.per100(t, 100), null);           // no scale: no guess
    assert.strictEqual(fl.learn(10, t + 2000), false);               // reference not at the same time
    for (let i = 0; i < 9; i++) assert.strictEqual(fl.learn(10, t), false);                     // fewer than 10 yet
    assert.strictEqual(fl.learn(10, t), true);
    near(fl.k, 0.01); near(fl.lph(t), 10); near(fl.per100(t, 100), 10);
    assert.strictEqual(fl.per100(t, 2), null);                       // standing
    assert.strictEqual(fl.learn(10.1, t), false);                    // < 2 %: nothing to save
    assert.strictEqual(fl.lph(t + 3001), 0);                         // signal stopped: engine off
    fl.feed(30000, t + 6000);                                        // after a gap: start again, no jump
    assert.strictEqual(fl.acc, 0); near(fl.rate, 1000);
    fl = new FuelFlow();
    t = count(fl, 0, 2000, 0);
    for (let i = 0; i < 20; i++) fl.learn(i % 2 ? 5 : 20, t);        // ratios that disagree: no scale
    assert.strictEqual(fl.k, null); assert(fl.spread > 1.3);
    fl = new FuelFlow(0.02); count(fl, 0, 1500, 0); near(fl.lph(1500), 20);                     // saved scale
    assert.strictEqual(new FuelFlow(-1).k, null);

    // the engine unit's figure
    near(refLph('OBD 5E', [0x00, 0xC8]), 10);
    near(refLph('4521', [0x00, 75]), 7.5 / 0.745);
    near(refLph('5656', [0x09, 0x1A]), 2330 * 0.00119209 * 3.6);
    assert.deepStrictEqual([refLph('5656', [0xFF, 0xFF]), refLph('5656', [1]), refLph('9999', [0, 1])], [null, null, null]);
    console.log('trips self-check ok');
}

module.exports = { Trips, FuelFlow, REFS, refLph, per100, dayKey, END_MS, MAX_DT, KEEP, DAYS, PRICE, test };
if (require.main === module) test();
