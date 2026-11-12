'use strict';
/*
 * adjust.js - MHD Live Adjustments for kingkong_cardata (Quiet Dials Adjust tab).
 * Logic from IterioDev/car-apps iteriodev_liveadjust 1.1.1 (maps 1-4, Max Cooling, exhaust flap);
 * UI lives in screens.json / main.js — this module only talks to the DME via uds().
 *
 *   Engine map 1..4 : 2F 01 <map-1>  -> 6F echo (MHD; any speed)
 *   Max Cooling     : 2F 03 01|00    -> 6F echo (On needs rpm > 500)
 *   Exhaust flap    : MHD 2F 02 nn first, else BMW jobs in flap.js
 *
 * uds(target, bytes) must return a Promise of the UDS reply bytes (or null), same shape as
 * main.js udsRead (service byte first: 62… / 6F… / 41… / 7F…).
 */
const flap = require('./flap.js');

const DME = 0x12;
const OVERRIDE_MS = 20000;
const FRESH_MS = 5000;
const MIN_COOLING_RPM = 500;
const MSG_MS = 8000;
const TEXT = '#f5ecd2', DIM = '#8b9099', FAINT = '#4a4f57', GOLD = '#d4af37', OK = '#5bd68a', CRIT = '#ff3b30';
const NOT_NOW = [0x21, 0x22, 0x78];
const NO_MHD = 'The DME has no MHD map. Flash one with MHD to use this.';
const hex = (n) => { let s = (n & 255).toString(16).toUpperCase(); return s.length < 2 ? `0${s}` : s; };
const NRC = {
    0x10: 'general reject', 0x11: 'service not supported', 0x12: 'sub-function not supported', 0x13: 'bad length',
    0x21: 'busy', 0x22: 'conditions not correct', 0x31: 'out of range', 0x33: 'security access denied',
    0x72: 'programming failure', 0x78: 'pending', 0x7E: 'not supported in session', 0x7F: 'not supported in session',
};
const nrcText = (u) => (u && u[0] === 0x7F ? (NRC[u[2]] || `NRC ${hex(u[2])}`) : 'no reply');
const errText = (e) => String(e && e.message || e).slice(0, 120);

/** True for the Live Adjust 2F writes that must work while driving (tasu-guard bypass in main.js). */
function isLiveAdjustWrite(sid, data) {
    return sid === 0x2F && (((data[0] === 0x01 || data[0] === 0x03) && data.length === 2) || flap.isFlapSet(data));
}

function createAdjust(opts) {
    const uds = opts.uds;
    const log = opts.log || (() => {});
    let dmeOk = null;
    let map = null;
    let cooling = 'OFF';
    let rpm = null, rpmAt = 0;
    let flapPct = null;
    let flapFound = null;
    let flapKind = null;
    let flapMhd = null;
    let mhd = null;
    let override = null;
    let overrideUntil = 0;
    let busy = null;
    let polling = false;
    const msgs = {};

    const rpmKnown = () => rpm !== null && Date.now() - rpmAt <= FRESH_MS;
    const engineStopped = () => rpmKnown() && rpm <= MIN_COOLING_RPM;

    function readRpm() {
        return uds(DME, [0x01, 0x0C]).then((u) => {
            if (u && u[0] === 0x41 && u[1] === 0x0C && u.length >= 4) {
                rpm = ((u[2] << 8) | u[3]) / 4;
                rpmAt = Date.now();
            }
            return !!u;
        }, () => false);
    }

    function readFlap() {
        const kind = flapKind || 'regulated';
        return uds(DME, [0x22].concat(flap.KINDS[kind].read)).then((u) => {
            const r = flap.onRead(kind, u);
            if (r.kind) {
                log(`flap: no regulated flap job (22 651E ${nrcText(u)}), using the plain one`);
                flapKind = r.kind;
                return readFlap();
            }
            if (r.none) { flapFound = false; flapPct = null; }
            if (r.pct !== undefined) {
                flapPct = r.pct; flapFound = true;
                if (!flapKind) log('flap: regulated (22 651E)');
                flapKind = kind;
            }
            return !!u;
        }, () => false);
    }

    function poll() {
        if (!uds || polling || busy) return Promise.resolve();
        polling = true;
        return Promise.all([readRpm(), readFlap()])
            .then((r) => { dmeOk = r[0] || r[1]; }, (e) => log(`adjust poll failed: ${errText(e)}`))
            .then(() => {
                polling = false;
                if (override && Date.now() > overrideUntil) override = null;
            });
    }

    function sendMhd(data) {
        return uds(DME, [0x2F].concat(data)).then((u) => {
            log(`MHD 2F ${data.map(hex).join(' ')} -> ${u ? u.map(hex).join(' ') : 'no reply'}`);
            if (u && u[0] === 0x6F && data.every((b, i) => u[i + 1] === b)) return;
            if (u && u[0] === 0x7F && NOT_NOW.indexOf(u[2]) < 0) mhd = false;
            throw new Error(u && u[0] === 0x7F ? 'Not available on this car (no MHD answer)' : 'No answer from the DME');
        });
    }

    function say(card, text, color) { msgs[card] = { text, color, at: Date.now() }; }

    function run(card, label, fn) {
        if (busy) return Promise.resolve();
        if (!uds) { say(card, 'No diagnostic link yet', GOLD); return Promise.resolve(); }
        busy = card;
        say(card, `Sending ${label}...`, DIM);
        return Promise.resolve().then(fn)
            .then((t) => say(card, t, OK), (e) => { log(`${label} failed: ${errText(e)}`); say(card, errText(e), GOLD); })
            .then(() => { busy = null; });
    }

    function setMap(n) {
        if (!(n >= 1 && n <= 4)) return Promise.resolve();
        return run('map', `map ${n}`, () => sendMhd([0x01, n - 1]).then(() => {
            map = n;
            return `Map ${n} · accepted by the DME`;
        }));
    }

    function setCooling(on) {
        return run('cool', `Max Cooling ${on ? 'on' : 'off'}`, () => (on ? readRpm() : Promise.resolve()).then(() => {
            if (on && !rpmKnown()) throw new Error('Engine speed unknown · nothing sent');
            if (on && engineStopped()) throw new Error('Start the engine first');
            return sendMhd([0x03, on ? 0x01 : 0x00]);
        }).then(() => {
            cooling = on ? 'ON' : 'OFF';
            return `Max Cooling ${on ? 'on' : 'off'} · accepted by the DME`;
        }));
    }

    function mhdFlap(k) {
        if (flapMhd === false) return Promise.resolve(null);
        return uds(DME, [0x2F].concat(flap.MHD[k])).then((u) => {
            log(`flap MHD ${k} -> ${u ? u.map(hex).join(' ') : 'no reply'}`);
            const r = flap.onMhd(k, u);
            if (r === 'busy') throw new Error(u ? `The DME refused: ${nrcText(u)}` : 'No answer from the DME');
            flapMhd = r === 'held';
            return flapMhd ? 'mhd' : null;
        });
    }

    function bmwFlap(k) {
        return (flapKind ? Promise.resolve() : readFlap()).then(() => {
            if (!flapKind) throw new Error('Flap not read yet · nothing sent');
            return uds(DME, [0x2F].concat(flap.command(flapKind, k)));
        }).then((u) => {
            log(`flap ${flapKind} ${k} -> ${u ? u.map(hex).join(' ') : 'no reply'}`);
            if (!u) throw new Error('No answer from the DME');
            if (u[0] === 0x7F) throw new Error(`The DME refused: ${nrcText(u)}`);
            return 'bmw';
        });
    }

    function setFlap(k) {
        return run('flap', `flap ${k}`, () => mhdFlap(k).then((via) => via || bmwFlap(k)).then((via) => {
            override = k === 'oem' ? null : k;
            overrideUntil = via === 'mhd' ? Infinity : Date.now() + OVERRIDE_MS;
            return readFlap().then(() => (k === 'oem' ? 'Handed back to the DME'
                : `${k === 'open' ? 'Open' : 'Closed'} · ${via === 'mhd' ? 'held by MHD' : 'accepted by the DME'}`));
        }));
    }

    const fresh = (card) => msgs[card] && Date.now() - msgs[card].at <= MSG_MS && msgs[card];
    const line = (card, text, color) => { const m = fresh(card); return m ? { text: m.text, color: m.color } : { text, color }; };

    /** Element opts for the Adjust screen (Quiet Dials). */
    function view(paused) {
        if (paused) {
            return {
                adjustMenu: { chips: [['Paused', 'warn']], sub: 'Paused · open a tab to resume' },
                mapValue: { text: '--', color: FAINT },
                mapSub: { text: '', color: DIM },
                mapNote: { hidden: true },
                mapSeg: { sel: -1, disabled: true },
                flapValue: { text: '--', color: FAINT },
                flapSub: { text: '', color: DIM },
                flapSeg: { sel: -1, disabled: true },
                coolValue: { text: '--', color: FAINT },
                coolSub: { text: '', color: DIM },
                coolNote: { hidden: true },
                coolSeg: { sel: -1, disabled: true },
            };
        }
        const noMhd = mhd === false;
        const out = {
            adjustMenu: {
                chips: noMhd ? [['MHD not found', 'crit']]
                    : [[dmeOk === null ? 'DME not asked yet' : dmeOk ? 'DME answers' : 'DME not answering', dmeOk ? 'ok' : 'warn']],
                sub: 'Maps · exhaust flap · Max Cooling · Quiet Dials',
            },
        };
        const mapWhy = noMhd ? NO_MHD : '';
        out.mapValue = { text: noMhd ? '--' : map ? `MAP ${map}` : 'MAP --', color: noMhd ? FAINT : map ? TEXT : DIM };
        out.mapSub = mapWhy ? { text: mapWhy, color: noMhd ? CRIT : GOLD }
            : line('map', map ? 'Accepted by the DME' : 'Tap a map: it switches at once', map ? OK : DIM);
        out.mapNote = { hidden: !!mapWhy };
        out.mapSeg = { sel: map && !noMhd ? map - 1 : -1, disabled: !!busy || !!mapWhy };

        const held = !!override && overrideUntil === Infinity;
        const left = override && !held ? Math.max(0, Math.ceil((overrideUntil - Date.now()) / 1000)) : 0;
        const pos = flap.state(flapPct), none = flapFound === false;
        out.flapValue = { text: none ? 'NONE' : pos || '--', color: pos === 'OPEN' ? GOLD : pos ? TEXT : DIM };
        out.flapSub = none ? { text: 'This DME has no electric exhaust flap', color: DIM }
            : line('flap', held ? `${override === 'open' ? 'Open' : 'Closed'} · MHD holds it until you change it`
                : left ? `${override === 'open' ? 'Open' : 'Closed'} for ${left} s more, then the DME decides`
                    : flapPct === null ? 'Flap position not read yet' : `The DME drives the flap: ${flapPct} %`, held || left ? OK : DIM);
        out.flapSeg = { sel: override === 'open' ? 0 : override === 'close' ? 1 : flapFound === true ? 2 : -1, disabled: !!busy || none };

        const stopped = engineStopped();
        out.coolValue = { text: noMhd ? '--' : cooling, color: noMhd ? FAINT : cooling === 'ON' ? GOLD : TEXT };
        out.coolSub = noMhd ? { text: NO_MHD, color: CRIT } : line('cool', stopped ? 'Engine stopped · On needs it running' : '', GOLD);
        out.coolNote = { hidden: noMhd };
        out.coolSeg = { sel: noMhd ? -1 : cooling === 'ON' ? 0 : 1, disabled: !!busy || noMhd };
        return out;
    }

    const CHOICES = {
        mapSeg: (i) => setMap(i + 1),
        flapSeg: (i) => setFlap(['open', 'close', 'oem'][i]),
        coolSeg: (i) => setCooling(i === 0),
    };

    function onChange(name, o) {
        const fn = CHOICES[name], sel = o && o.sel;
        if (fn && sel >= 0) Promise.resolve().then(() => fn(sel)).catch((e) => log(`${name} failed: ${errText(e)}`));
    }

    function onShow() { mhd = null; return poll(); }

    return { poll, view, onChange, onShow, isLiveAdjustWrite };
}

function test() {
    const assert = require('assert');
    // guard helper
    assert.strictEqual(isLiveAdjustWrite(0x2F, [0x01, 0x02]), true);
    assert.strictEqual(isLiveAdjustWrite(0x2F, [0x03, 0x01]), true);
    assert.strictEqual(isLiveAdjustWrite(0x2F, [0x02, 0x01]), true);
    assert.strictEqual(isLiveAdjustWrite(0x2F, [0x61, 0x1E, 0x00]), true);
    assert.strictEqual(isLiveAdjustWrite(0x22, [0x65, 0x1E]), false);
    assert.strictEqual(isLiveAdjustWrite(0x2F, [0x04, 0x01]), false);

    // map accept echo via stub uds
    const replies = [];
    const adj = createAdjust({
        log: () => {},
        uds: (target, bytes) => {
            assert.strictEqual(target, DME);
            if (bytes[0] === 0x01 && bytes[1] === 0x0C) return Promise.resolve([0x41, 0x0C, 0x0E, 0x10]); // 900 rpm
            if (bytes[0] === 0x22) return Promise.resolve([0x62, 0x65, 0x1E, 0x03, 0x33]); // open 10%
            if (bytes[0] === 0x2F && bytes[1] === 0x01) return Promise.resolve([0x6F, 0x01, bytes[2]]);
            if (bytes[0] === 0x2F && bytes[1] === 0x03) return Promise.resolve([0x6F, 0x03, bytes[2]]);
            if (bytes[0] === 0x2F && bytes[1] === 0x02) return Promise.resolve([0x6F, 0x02, bytes[2]]);
            return Promise.resolve(null);
        },
    });
    return adj.onShow().then(() => adj.onChange('mapSeg', { sel: 2 }))
        .then(() => new Promise((r) => setTimeout(r, 20)))
        .then(() => {
            const v = adj.view(false);
            assert.strictEqual(v.mapValue.text, 'MAP 3');
            assert.strictEqual(v.mapSeg.sel, 2);
            assert.strictEqual(v.flapValue.text, 'OPEN');
            assert.strictEqual(v.coolValue.text, 'OFF');
            console.log('adjust self-check ok');
        });
}

module.exports = { createAdjust, isLiveAdjustWrite, test };
if (require.main === module) test().catch((e) => { console.error(e); process.exit(1); });
