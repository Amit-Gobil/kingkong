'use strict';
/*
 * kingkong_race — KingKong Race for BMW iDrive 8 (MGU).
 * Separate app from kingkong_cardata. No DME / TASU — speed (+ optional g) only.
 *
 * Reuses RunTimer + Race from Amit-Gobil/kingkong-idrive-app@67311b4 (timer.js, race.js).
 * SOME/IP: Vehicle2 statusCarSpeed2 → km/h; CDS2 longitudinal accel → g (peak during run).
 * Tabs: Drag | Race (christmas tree practice) | Online (stub) | Settings.
 */
const fs = require('fs');
const path = require('path');
const someipBuilders = require('oap-sdk/src/someip/someipBuilders');
const { createHost } = require('./online-host.js');
const { RunTimer } = require('./timer.js');
const { Race } = require('./race.js');
const qrcodegen = require('./qrcodegen.js');

const LOG = '[kingkong_race]';
const PAGES = ['drag', 'race', 'online', 'settings'];
// Linked bundle is javascript/app.js (or src/main.js): package root is one up — same as cardata.
const SOURCE = typeof __dirname === 'string' ? path.join(__dirname, '..') : `/var/opt/public/oap/oap_${process.getuid()}/source`;
const RENDERER = path.join(SOURCE, 'renderer');
const DATA_DIR = path.join(SOURCE, '..', 'data');
const BEST_FILE = path.join(DATA_DIR, 'kingkong_race_best.json');
const SETTINGS_FILE = path.join(DATA_DIR, 'kingkong_race_settings.json');
const SHARE_URL = 'https://inspect.kingkongtuning.se/car-time';
const INVALID = 65535;
const ACTIVE_WINDOW_MS = 30 * 60e3;
const RENDER_MS = 100;
const TICK_MS = 50;

const SPLITS = [
    { key: 'ft60', label: '60 ft', dist: 18.288 },
    { key: 'kmh100', label: '0-100', from: 0, to: 100 },
    { key: 'kmh200', label: '100-200', from: 100, to: 200 },
    { key: 'm201', label: '201 m', dist: 201.168 },
];

function mono() { const t = process.hrtime(); return t[0] * 1000 + t[1] / 1e6; }
const errText = (e) => String(e && e.message || e).slice(0, 80);
const log = (m) => console.error(LOG, m);

const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } };
function writeJson(file, value) {
    try { fs.mkdirSync(DATA_DIR); } catch (e) { /* exists */ }
    try { fs.writeFileSync(file, JSON.stringify(value)); } catch (e) { log('save: ' + e.message); }
}

const secs = (x) => (typeof x === 'number' && isFinite(x) ? x.toFixed(2) + ' s' : '--');
const kmh = (x) => (typeof x === 'number' && isFinite(x) ? x.toFixed(1) : '--');

// ---- state ----
let screens = null, app = null, runtime = null;
let activeUntil = 0, activeSince = 0;
let speed = 0, signal = false, peakG = 0;
let best = readJson(BEST_FILE, {});
let settings = Object.assign({ rollout: false }, readJson(SETTINGS_FILE, {}));
let lastRun = null, newBest = {}, qrImg = null, qrNote = '';

const timer = new RunTimer(SPLITS, {
    rollout: !!settings.rollout,
    onDone: (run) => runDone(run),
    onLaunch: () => { peakG = 0; newBest = {}; clearQr(); },
});
const race = new Race(SPLITS, { now: mono });

function runDone(run) {
    const fresh = {};
    Object.keys(run.result).forEach((k) => {
        const b = best[k];
        if (!b || run.result[k] < b.s) {
            best[k] = { s: run.result[k], at: run.at, trap: run.trap[k] };
            fresh[k] = true;
        }
    });
    newBest = fresh;
    lastRun = run;
    writeJson(BEST_FILE, best);
    log('run ' + JSON.stringify(run.result));
}

function shareUrl() {
    if (!lastRun) return '';
    const r = lastRun, p = [];
    const add = (name, v) => { if (typeof v === 'number') p.push(name + '=' + v.toFixed(2)); };
    add('k100', r.result.kmh100);
    add('k200', r.result.kmh200);
    add('e', r.result.m201);
    add('f', r.result.ft60);
    if (typeof r.trap.m201 === 'number') p.push('t=' + r.trap.m201.toFixed(1));
    p.push('d=' + new Date(r.at).toISOString().slice(0, 10));
    return SHARE_URL + '?' + p.join('&');
}

function clearQr() {
    if (qrImg && runtime) {
        try { runtime('kit/record.js').dropImage(qrImg); } catch (e) { /* */ }
    }
    qrImg = null;
    qrNote = '';
}

function showQr() {
    if (!lastRun || !screens) { qrNote = 'No run to share yet'; return; }
    clearQr();
    const url = shareUrl();
    const q = qrcodegen.QrCode.encodeText(url, qrcodegen.QrCode.Ecc.MEDIUM);
    const n = q.size, scale = 8, pad = 2, dim = (n + pad * 2) * scale;
    const data = Buffer.alloc(dim * dim * 4, 255);
    for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
            if (!q.getModule(x, y)) continue;
            for (let dy = 0; dy < scale; dy++) {
                for (let dx = 0; dx < scale; dx++) {
                    const px = (pad * scale + x * scale + dx);
                    const py = (pad * scale + y * scale + dy);
                    const i = (py * dim + px) * 4;
                    data[i] = data[i + 1] = data[i + 2] = 0; data[i + 3] = 255;
                }
            }
        }
    }
    const { makeImage } = runtime('kit/record.js');
    qrImg = makeImage(dim, dim, data);
    screens.setImage('qrImage', qrImg);
    qrNote = url;
}

// ---- SOME/IP: speed + accel only ----
function watch(ifName, attr, fn, intervalMs) {
    return someipBuilders.buildAndInitTypedProxy(ifName, '1', { timeoutMs: 10000 })
        .then((p) => p.waitUntilAvailable().then(() => {
            if (typeof p[attr].subscribe === 'function') {
                return p[attr].subscribe(fn).catch(() => {});
            }
            return null;
        }).then(() => {
            // also poll — BMW notifiers are unreliable (same lesson as cardata)
            const pull = () => {
                if (Date.now() > activeUntil) return;
                Promise.resolve(p[attr].getValue()).then(fn).catch(() => {});
            };
            pull();
            setInterval(pull, intervalMs || 100);
        }))
        .catch((e) => log(`${ifName}.${attr}: ${errText(e)}`));
}

function onSpeed(v) {
    const raw = v && v.speedVehicleCentreOfGravity;
    if (typeof raw !== 'number' || raw === INVALID) { signal = false; return; }
    signal = true;
    speed = raw / 64;
    const t = mono();
    timer.feed(t, speed);
    race.feed(t, speed);
}

function onAccel(v) {
    const raw = v && v.longitudinalAccelerationCentreOfGravity;
    if (typeof raw !== 'number' || raw === INVALID) return;
    if (timer.state === 'run' || race.phase === 'run') {
        peakG = Math.max(peakG, (raw * 0.002 - 65) / 9.80665);
    }
}

function startBus() {
    watch('de.bmw.infotainment.vehicle.Vehicle2', 'statusCarSpeed2', onSpeed, 100);
    watch('de.bmw.infotainment.vehicle.CDS2', 'statusLongitudinalAccelerationMassCenter', onAccel, 100);
}

// ---- UI model / render ----
function statusLine() {
    if (!signal) return 'NO SPEED SIGNAL';
    if (timer.state === 'ready') return 'READY · hold still ≥1 s, then go';
    if (timer.state === 'run') return 'TIMING';
    if (timer.state === 'wait') return 'STOP THE CAR to arm';
    return timer.state.toUpperCase();
}

function splitTableRows(result, trap, fresh) {
    return SPLITS.map((s) => {
        const v = result && result[s.key];
        const mark = fresh && fresh[s.key] ? ' ★' : '';
        const time = typeof v === 'number' ? v.toFixed(2) + ' s' + mark : '--';
        let spd = '--';
        if (trap && typeof trap[s.key] === 'number') spd = trap[s.key].toFixed(0);
        else if (s.to) spd = String(s.to);
        return [s.label, time, spd];
    });
}

function bestRows() {
    return ['ft60', 'kmh100', 'm201'].map((k) => {
        const s = SPLITS.find((x) => x.key === k);
        const b = best[k];
        return [s.label, b ? b.s.toFixed(2) + ' s' : '--'];
    });
}

function racePhaseText(m) {
    if (m.phase === 'idle') return m.canStart ? 'TAP START TREE' : 'STOP THE CAR';
    if (m.phase === 'ready') return 'GET READY';
    if (m.phase === 'count') return 'WATCH THE TREE';
    if (m.phase === 'armed') return 'GO!';
    if (m.phase === 'run') return 'RUN';
    if (m.phase === 'foul') return 'FOUL — EARLY';
    if (m.phase === 'result') return 'RESULT';
    return String(m.phase || '').toUpperCase();
}

/** Huge center readout: countdown digits, then GO / FOUL. */
function raceCountdownText(m) {
    if (m.phase === 'ready' && m.ready != null) return String(Math.max(0, m.ready | 0));
    if (m.phase === 'count') {
        const a = (m.lights && m.lights.amber) || [];
        const n = (a[0] ? 1 : 0) + (a[1] ? 1 : 0) + (a[2] ? 1 : 0);
        return n ? String(n) : '•';
    }
    if (m.phase === 'armed') return 'GO';
    if (m.phase === 'foul') return 'FOUL';
    if (m.phase === 'run') return 'RUN';
    if (m.phase === 'result') return 'DONE';
    if (m.phase === 'idle') return m.canStart ? '—' : 'STOP';
    return '—';
}

function raceCountdownColor(m) {
    if (m.phase === 'armed') return '#2fd27a';
    if (m.phase === 'foul') return '#e23b2f';
    if (m.phase === 'count') return '#ffb000';
    return '#d4af37';
}

function syncTabs() {
    if (!screens || !screens.st) return;
    const cur = screens.st.name;
    const sel = Math.max(0, PAGES.indexOf(cur));
    PAGES.forEach((p) => screens.set(`${p}Tabs`, { sel }));
}

function render() {
    if (!screens || !screens.st) return;
    const now = mono();
    const elapsed = timer.elapsed(now);
    const rm = Object.assign(race.model(), { canStart: race.canStart(signal, speed) });
    const lights = rm.lights || { amber: [false, false, false], green: false, staged: false };

    screens.set('speedVal', {
        value: signal ? String(Math.round(speed)) : '--',
        unit: 'km/h',
        size: 72,
        color: signal ? '' : 'dim',
    });
    screens.set('timerVal', {
        value: elapsed ? elapsed.toFixed(3) : '0.000',
        unit: 's',
        size: 140,
        color: timer.state === 'run' ? '#d4af37' : 'dim',
    });
    screens.set('statusText', { text: statusLine() });
    screens.set('peakGText', { text: peakG > 0 ? peakG.toFixed(2) + ' g' : '-- g' });
    screens.set('splitTable', { rows: splitTableRows(timer.result, timer.trapSpeed, newBest) });
    screens.set('bestKv', { rows: bestRows() });

    // Race tree page — visual christmas tree (not cardata gauges, not text ○ rows)
    screens.set('raceTree', {
        amber: lights.amber || [false, false, false],
        green: !!lights.green,
        foul: rm.phase === 'foul',
        staged: lights.staged !== false,
    });
    screens.set('racePhase', { text: racePhaseText(rm), align: 'left', size: 36 });
    screens.set('raceCountdown', {
        text: raceCountdownText(rm),
        size: 180,
        font: 'bold',
        spacing: 4,
        align: 'left',
        color: raceCountdownColor(rm),
    });
    screens.set('raceCode', { text: 'Room ' + (rm.code || '----') + ' · solo practice' });
    screens.set('raceReaction', {
        value: rm.reaction != null ? rm.reaction.toFixed(3) : (rm.phase === 'foul' ? 'FOUL' : '--'),
        unit: rm.reaction != null ? 's' : '',
        size: 72,
        color: rm.phase === 'foul' ? '#e23b2f' : '#d4af37',
    });
    screens.set('raceTimer', {
        value: (rm.elapsed || 0).toFixed(3),
        unit: 's',
        size: 72,
        color: '#d4af37',
    });
    screens.set('raceSplits', { rows: splitTableRows(rm.result, rm.trap, {}) });
    screens.set('raceStartBtn', {
        text: 'Start tree',
        kind: 'primary',
        disabled: !rm.canStart && rm.phase === 'idle',
    });
    screens.set('raceAgainBtn', { text: 'Race again', kind: 'outline', disabled: false });

    screens.set('onlineNote', {
        text: 'Coming later: room code, shared start, local timing, upload. No server in this version.',
    });
    screens.set('onlineCode', { text: 'Your code (prepared): ' + rm.code });

    screens.set('rolloutRow', { on: !!settings.rollout, label: '1-ft rollout', sub: 'Clock starts after 0.30 m' });
    screens.set('qrNote', { text: qrNote || (lastRun ? 'Tap Show QR for last run' : 'Run a drag first') });
    screens.set('shareUrl', { text: lastRun ? shareUrl() : '--' });

    syncTabs();
}

function goTo(page) {
    const cur = screens.st && screens.st.name;
    if (!page || page === cur) return;
    if (cur && cur !== 'drag') closeScreen(cur);
    if (page !== 'drag') showScreen(page);
}

function onChange(name, o) {
    if (name === 'rolloutRow') {
        settings.rollout = !!o.on;
        writeJson(SETTINGS_FILE, settings);
        timer.rollout = !!settings.rollout;
        render();
        return;
    }
    const from = name.replace(/Tabs$/, '');
    if (from === name || PAGES.indexOf(from) < 0) return;
    const to = PAGES[o.sel];
    screens.set(`${from}Tabs`, { sel: PAGES.indexOf(from) });
    goTo(to);
}

function onEvent(e) {
    if (e === 'dragReset') {
        timer.reset(); peakG = 0; newBest = {}; lastRun = null; clearQr();
    }
    if (e === 'dragQr') showQr();
    if (e === 'qrClose') clearQr();
    if (e === 'raceStart') {
        if (race.canStart(signal, speed)) race.start();
    }
    if (e === 'raceAgain') race.reset();
    if (e === 'clearBests') { best = {}; writeJson(BEST_FILE, best); newBest = {}; }
    render();
}

const showScreen = (name) => app.getByName(name).updateResources().then(() => app.openState(name))
    .catch((e) => log(`open ${name}: ${errText(e)}`));
const closeScreen = (name) => app.closeState(name).catch((e) => log(`close ${name}: ${errText(e)}`));

function activate() {
    activeUntil = Date.now() + ACTIVE_WINDOW_MS;
    if (!activeSince) activeSince = Date.now();
}

function startScreens(rhmiApp, hosts) {
    app = rhmiApp;
    const design = JSON.parse(fs.readFileSync(path.join(RENDERER, 'screens.json'), 'utf8'));
    const { RenderClient } = runtime('kit/renderd.js');
    const { ScreenApp } = runtime('screenapp.js');
    const rlog = { info: log, warn: log, error: log };
    const gpu = new RenderClient('kingkong_race', rlog);
    screens = new ScreenApp(gpu, design, { view: 'id8', log: rlog });
    screens.bindHosts(hosts, { open: (name) => showScreen(name), close: closeScreen });
    screens.on('show', () => { activate(); render(); });
    PAGES.forEach((s) => hosts[s].on('visible', (ev) => {
        if (ev && (ev.visible === true || ev.visible === 'true' || ev.visible === 1)) activate();
    }));
    screens.on('change', onChange);
    screens.on('event', onEvent);
    screens.on('closed', (why) => { activeUntil = 0; if (why !== 'hmi') PAGES.slice().reverse().forEach(closeScreen); });
    gpu.connect();
}

createHost({
    states: PAGES,
    log,
    onReady: (rhmiApp, hosts) => {
        try {
            runtime = (rel) => require(path.join(RENDERER, rel));
            startScreens(rhmiApp, hosts);
            startBus();
            setInterval(() => {
                if (Date.now() > activeUntil) return;
                const t = mono();
                timer.idle(t);
                race.tick(t);
            }, TICK_MS);
            setInterval(() => { if (Date.now() <= activeUntil) render(); }, RENDER_MS);
        } catch (e) {
            log('onReady failed: ' + errText(e));
            throw e;
        }
    },
    onHidden: () => { activeUntil = 0; },
});

module.exports = { SPLITS, mono, shareUrl, secs, kmh };
