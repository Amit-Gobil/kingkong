'use strict';
/*
 * kingkong_cluster — thin Quiet Dials status strip on ID8 KOMBI via cluster-render.
 * Separate from kingkong_cardata (1.2.8 CID chips stay as-is) and kingkong_race.
 *
 * Draws Boost / Power% / Torque% on the instrument-cluster widget (or map) slot.
 * Soft-fails when Cluster renderer is not installed. G81: optional hide in M Mode.
 */
const fs = require('fs');
const path = require('path');
const someipBuilders = require('oap-sdk/src/someip/someipBuilders');
const { createHost } = require('./online-host.js');
const { ClusterRender, DEFAULT_PATH } = require('./cluster_render_client.js');
const { paintStrip } = require('./strip.js');

/** cluster-render image buffers max 1920x720 (PROTOCOL + JS client). */
const MAX_IW = 1920;
const MAX_IH = 720;

const LOG = '[kingkong_cluster]';
const HOST_STATES = ['drag', 'race', 'online', 'settings'];
const TAB_PAGES = ['drag', 'settings'];
const SOURCE = typeof __dirname === 'string' ? path.join(__dirname, '..') : `/var/opt/public/oap/oap_${process.getuid()}/source`;
const RENDERER = path.join(SOURCE, 'renderer');
const DATA_DIR = path.join(SOURCE, '..', 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'kingkong_cluster_settings.json');
const FRESH_MS = 1500;
const RENDER_MS = 200;
const STRIP_FPS = 5;

const log = (m) => console.error(LOG, m);
const errText = (e) => String((e && e.message) || e).slice(0, 100);
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return fallback; } };
function writeJson(file, value) {
  try { fs.mkdirSync(DATA_DIR); } catch (e) { /* exists */ }
  try { fs.writeFileSync(file, JSON.stringify(value)); } catch (e) { log('save: ' + e.message); }
}

const settings = Object.assign({
  enabled: true,
  yieldMMode: true,
  target: 'widget', // widget | map
}, readJson(SETTINGS_FILE, {}));
if (settings.target !== 'map' && settings.target !== 'widget') settings.target = 'widget';

let screens = null, app = null, runtime = null;
let cr = null, layerRef = 0;
let connText = 'Cluster renderer: looking…';
let layerText = 'Layer: —';
let backend = '';
let targetSizes = { widget: [2240, 896], map: [874, 749] };
let lastPaintKey = '';
let stripVisible = true;

// ---- FES / MDrive telemetry (read-only; same family as cardata sport chips) ----
const raw = {};
const seen = {};
const valid = (r, invalid) => typeof r === 'number' && r !== invalid;

function set(k, v) { raw[k] = v; }

function watch(ifName, attr, fn, intervalMs) {
  return someipBuilders.buildAndInitTypedProxy(ifName, '1', { timeoutMs: 10000 })
    .then((p) => p.waitUntilAvailable().then(() => {
      if (typeof p[attr].subscribe === 'function') {
        return p[attr].subscribe(fn).catch(() => {});
      }
      return null;
    }).then(() => {
      const pull = () => {
        Promise.resolve(p[attr].getValue()).then(fn).catch(() => {});
      };
      pull();
      setInterval(pull, intervalMs || 200);
    }))
    .catch((e) => log(`${ifName}.${attr}: ${errText(e)}`));
}

function startBus() {
  watch('de.bmw.infotainment.drivingexcitement.FES', 'statusVehicleDynamicEngine', (x) => {
    seen.dyn = Date.now();
    set('powerPct', x && x.displaySportEnginePower);
    set('torquePct', x && x.displaySportEngineTorque);
  }, 150);
  watch('de.bmw.infotainment.drivingexcitement.FES', 'statusSwitchDriveDynamicSport2', (x) => {
    seen.boost = Date.now();
    set('sportBoost', x && x.displayBoostPressure);
  }, 150);
  watch('de.bmw.infotainment.drivingexcitement.FES', 'dataGearBox2', (x) => {
    set('gearMode', x && x.driveModusGearbox);
  }, 1000);
  watch('de.bmw.infotainment.misc.MDrive', 'dataDisplayGearbox', (x) => {
    seen.mdrive = Date.now();
    set('program', x && x.displayProgramGearbox);
    set('driveLogic', x && x.displayDriveLogicGearbox);
  }, 1000);
}

function fesBoostBar() {
  if (!(Date.now() - (seen.boost || 0) < FRESH_MS)) return undefined;
  return valid(raw.sportBoost, 255) ? raw.sportBoost * 0.01 : undefined;
}
function sportPowerPct() {
  if (!(Date.now() - (seen.dyn || 0) < FRESH_MS)) return undefined;
  return valid(raw.powerPct, 255) ? raw.powerPct : undefined;
}
function sportTorquePct() {
  if (!(Date.now() - (seen.dyn || 0) < FRESH_MS)) return undefined;
  return valid(raw.torquePct, 255) ? raw.torquePct : undefined;
}

/** Heuristic G81 M Mode / aggressive cluster content — hide strip rather than fight shift lights. */
function mModeLikely() {
  const p = raw.program;
  if (typeof p === 'string' && /M\b|SPORT\s*PLUS|TRACK|RACE/i.test(p)) return true;
  if (typeof p === 'number' && p >= 3) return true;
  const dl = raw.driveLogic;
  if (typeof dl === 'number' && dl >= 3) return true;
  const gm = raw.gearMode;
  if (typeof gm === 'string' && /M|SPORT/i.test(gm)) return true;
  if (typeof gm === 'number' && gm >= 3) return true;
  return false;
}

function liveVals() {
  const b = fesBoostBar();
  const pp = sportPowerPct();
  const tp = sportTorquePct();
  return {
    boost: b === undefined ? '--' : b.toFixed(2),
    power: pp === undefined ? '--' : Math.round(pp),
    torque: tp === undefined ? '--' : Math.round(tp),
  };
}

function parseTargets(helloTargets) {
  // "map:874x749,hud:353x203,guide:702x213,widget:2240x896,popup:2240x896"
  String(helloTargets || '').split(',').forEach((part) => {
    const m = /^([a-z]+):(\d+)x(\d+)$/i.exec(part.trim());
    if (!m) return;
    targetSizes[m[1]] = [Number(m[2]), Number(m[3])];
  });
}

function placeFor(target, tw, th) {
  // Strip-sized layer (not full target canvas): iw/ih must be ≤1920x720.
  // ID8 widget visible band ~x400–1720,y143–765; 1140@x550 is the documented sweet spot.
  let stripW = target === 'map' ? Math.min(760, Math.max(120, tw - 40)) : 1140;
  let stripH = target === 'map' ? 56 : 72;
  stripW = Math.min(stripW, MAX_IW, tw);
  stripH = Math.min(stripH, MAX_IH, th);
  const x = Math.max(0, Math.min(tw - stripW, Math.floor((tw - stripW) / 2)));
  const y = target === 'map'
    ? Math.max(0, th - stripH - 36)
    : Math.max(0, Math.min(th - stripH, Math.floor(th * 0.52)));
  return { x, y, w: stripW, h: stripH };
}

function ensureLayer() {
  if (!cr || !cr.ready) return;
  const target = settings.target === 'map' ? 'map' : 'widget';
  const size = targetSizes[target] || (target === 'map' ? [874, 749] : [2240, 896]);
  const place = placeFor(target, size[0], size[1]);
  if (layerRef) {
    try { cr.drop(layerRef); } catch (e) { /* */ }
    layerRef = 0;
  }
  // Draw only the strip rect on the target — full widget/map canvases exceed image max.
  layerRef = cr.image({
    target,
    klass: 'overlay',
    z: 10,
    x: place.x,
    y: place.y,
    w: place.w,
    h: place.h,
    iw: place.w,
    ih: place.h,
    fps: STRIP_FPS,
    sampling: 'nearest',
    visible: true,
    contend: 0, // do not fight stock HMI for the slot
    yield: 1,
    opacity: 1,
  });
  lastPaintKey = '';
  if (!layerRef) {
    layerText = `Layer: create refused (${place.w}x${place.h} on ${target} — check size ≤${MAX_IW}x${MAX_IH})`;
    log(layerText);
    renderUi();
    return;
  }
  layerText = `Layer: ref ${layerRef} → ${target} @${place.x},${place.y} ${place.w}x${place.h}`;
  log(layerText);
  pushPixels(true);
}

function pushPixels(force) {
  if (!cr || !cr.ready || !layerRef) return;
  const wantShow = !!settings.enabled && !(settings.yieldMMode && mModeLikely());
  if (wantShow !== stripVisible) {
    stripVisible = wantShow;
    try { cr.set(layerRef, { visible: wantShow }); } catch (e) { /* */ }
  }
  if (!wantShow && !force) return;

  const target = settings.target === 'map' ? 'map' : 'widget';
  const size = targetSizes[target] || (target === 'map' ? [874, 749] : [2240, 896]);
  const place = placeFor(target, size[0], size[1]);
  const vals = liveVals();
  const key = [target, place.x, place.y, place.w, place.h, vals.boost, vals.power, vals.torque, wantShow].join('|');
  if (!force && key === lastPaintKey) return;
  lastPaintKey = key;

  const strip = paintStrip(vals, { w: place.w, h: place.h });
  if (!cr.pixels(layerRef, null, strip.rgba)) {
    log('pixels rejected for layer ' + layerRef);
  }
}

function startCluster() {
  if (cr) return;
  cr = new ClusterRender('kingkong_cluster', DEFAULT_PATH);
  cr.on('ready', () => {
    backend = cr.backend || '';
    parseTargets(cr.targets);
    connText = `Cluster renderer: connected (${backend || '?'})`;
    log(connText + ' targets=' + cr.targets);
    if (settings.enabled) ensureLayer();
    else layerText = 'Layer: disabled in settings';
    renderUi();
  });
  cr.on('disconnected', () => {
    connText = 'Cluster renderer: disconnected — retrying…';
    layerText = 'Layer: —';
    layerRef = 0;
    renderUi();
  });
  cr.on('layer', (ref, state, reason) => {
    if (ref !== layerRef) return;
    // ID8 widget: parked/waiting until picked in the cluster widget menu.
    const tip = (state === 'waiting' || state === 'parked') && settings.target === 'widget'
      ? ' · pick Kingkong in cluster widget menu'
      : '';
    layerText = `Layer: ${state}${reason ? ' · ' + reason : ''}${tip}`;
    // If parked / waiting behind stock, stay soft — no contend retries.
    renderUi();
  });
  cr.on('target', (name, state, holder, reason) => {
    if (name !== settings.target && name !== 'widget' && name !== 'map') return;
    log(`target ${name} ${state}${holder ? ' holder=' + holder : ''}${reason ? ' ' + reason : ''}`);
    if (name === settings.target && (state === 'parked' || state === 'waiting')) {
      layerText = settings.target === 'widget'
        ? `Layer: ${state} — pick Kingkong Cluster in the cluster widget menu`
        : `Layer: ${state}${reason ? ' · ' + reason : ''}`;
      renderUi();
    } else if (name === settings.target && state === 'shown' && layerRef) {
      layerText = `Layer: shown on ${name}`;
      renderUi();
    }
  });
  cr.on('refused', (op, ref, reason) => {
    log(`refused ${op} ${ref}: ${reason}`);
    if (String(reason || '').indexOf('not supported') >= 0) {
      connText = 'Cluster renderer: not supported on this head unit';
    }
    renderUi();
  });
  cr.connect();
  // Soft status while socket missing
  setTimeout(() => {
    if (cr && !cr.ready) {
      connText = 'Cluster renderer: not found — install “Cluster renderer” from Store';
      renderUi();
    }
  }, 2500);
}

function stopCluster() {
  if (!cr) return;
  try { cr.close(); } catch (e) { /* */ }
  cr = null;
  layerRef = 0;
}

// ---- CID UI ----
function syncTabs() {
  if (!screens || !screens.st) return;
  const cur = screens.st.name;
  const sel = cur === 'settings' ? 1 : 0;
  TAB_PAGES.forEach((p) => screens.set(`${p}Tabs`, { sel }));
  // keep unused host tabs pointing at Status
  screens.set('raceTabs', { sel: 0 });
  screens.set('onlineTabs', { sel: 0 });
}

function renderUi() {
  if (!screens || !screens.st) return;
  const vals = liveVals();
  const hide = settings.yieldMMode && mModeLikely();
  screens.set('connStatus', {
    text: connText,
    color: /connected/i.test(connText) ? '#2fd27a' : /not found|not supported/i.test(connText) ? '#e23b2f' : '#d4af37',
  });
  screens.set('layerStatus', {
    text: layerText + (hide ? ' · hidden (M Mode)' : ''),
  });
  screens.set('liveKv', {
    rows: [
      ['Boost', vals.boost],
      ['Power', vals.power === '--' ? '--' : vals.power + '%'],
      ['Torque', vals.torque === '--' ? '--' : vals.torque + '%'],
      ['Target', settings.target + (settings.enabled ? '' : ' · off')],
    ],
  });
  screens.set('enableRow', {
    on: !!settings.enabled,
    label: 'Show strip on KOMBI',
    sub: 'Needs Cluster renderer + widget pick',
    control: 'toggle',
  });
  screens.set('yieldRow', {
    on: !!settings.yieldMMode,
    label: 'Hide in M Mode',
    sub: 'G81: yield when M Mode looks active',
    control: 'toggle',
  });
  screens.set('targetRow', {
    rows: [
      ['Target', settings.target],
      ['Tip', settings.target === 'widget'
        ? 'Open cluster widget menu → pick Kingkong'
        : 'Map slot — may sit under stock map / media'],
    ],
  });
  syncTabs();
}

function goTo(page) {
  const cur = screens.st && screens.st.name;
  if (!page || page === cur) return;
  if (page !== 'drag' && page !== 'settings') page = 'drag';
  if (cur && cur !== 'drag') closeScreen(cur);
  if (page !== 'drag') showScreen(page);
}

function onChange(name, o) {
  if (name === 'enableRow') {
    settings.enabled = !!o.on;
    writeJson(SETTINGS_FILE, settings);
    if (!settings.enabled && cr && layerRef) {
      try { cr.set(layerRef, { visible: false }); } catch (e) { /* */ }
      stripVisible = false;
      layerText = 'Layer: hidden (disabled)';
    } else if (settings.enabled && cr && cr.ready) {
      ensureLayer();
    }
    renderUi();
    return;
  }
  if (name === 'yieldRow') {
    settings.yieldMMode = !!o.on;
    writeJson(SETTINGS_FILE, settings);
    lastPaintKey = '';
    pushPixels(true);
    renderUi();
    return;
  }
  const from = name.replace(/Tabs$/, '');
  if (from === name) return;
  if (from === 'race' || from === 'online') {
    screens.set(`${from}Tabs`, { sel: 0 });
    goTo('drag');
    return;
  }
  if (TAB_PAGES.indexOf(from) < 0) return;
  const to = TAB_PAGES[o.sel] || 'drag';
  screens.set(`${from}Tabs`, { sel: TAB_PAGES.indexOf(from) });
  goTo(to);
}

function onEvent(e) {
  if (e === 'cycleTarget') {
    settings.target = settings.target === 'widget' ? 'map' : 'widget';
    writeJson(SETTINGS_FILE, settings);
    if (cr && cr.ready && settings.enabled) ensureLayer();
    renderUi();
  }
}

const showScreen = (name) => app.getByName(name).updateResources().then(() => app.openState(name))
  .catch((e) => log(`open ${name}: ${errText(e)}`));
const closeScreen = (name) => app.closeState(name).catch((e) => log(`close ${name}: ${errText(e)}`));

function startScreens(rhmiApp, hosts) {
  app = rhmiApp;
  const design = JSON.parse(fs.readFileSync(path.join(RENDERER, 'screens.json'), 'utf8'));
  const { RenderClient } = runtime('kit/renderd.js');
  const { ScreenApp } = runtime('screenapp.js');
  const rlog = { info: log, warn: log, error: log };
  const gpu = new RenderClient('kingkong_cluster', rlog);
  screens = new ScreenApp(gpu, design, { view: 'id8', log: rlog });
  screens.bindHosts(hosts, { open: (name) => showScreen(name), close: closeScreen });
  screens.on('show', () => renderUi());
  screens.on('change', onChange);
  screens.on('event', onEvent);
  screens.on('closed', (why) => {
    // Keep cluster strip alive while the OAP process runs; only drop on real HMI teardown.
    if (why === 'hmi') { /* process will shut down */ }
  });
  gpu.connect();
}

createHost({
  states: HOST_STATES,
  log,
  onReady: (rhmiApp, hosts) => {
    try {
      runtime = (rel) => require(path.join(RENDERER, rel));
      startScreens(rhmiApp, hosts);
      startBus();
      startCluster();
      setInterval(() => {
        pushPixels(false);
        if (screens && screens.st) renderUi();
      }, Math.max(RENDER_MS, Math.floor(1000 / STRIP_FPS)));
    } catch (e) {
      log('onReady failed: ' + errText(e));
      throw e;
    }
  },
  // Do not tear down the strip when CID is hidden — strip is the product.
  onHidden: () => {},
  onShutdown: () => { stopCluster(); },
});

module.exports = { liveVals, mModeLikely, paintStrip, settings };
