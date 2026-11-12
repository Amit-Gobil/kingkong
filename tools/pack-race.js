#!/usr/bin/env node
/**
 * Rebuild apps/kingkong_race/kingkong_race@VERSION.tgz with Race's own RHMI identity.
 * Source of truth for IDs: apps/kingkong_race/rhmi-identity.json
 * Does not copy cardata appletId / entryPoint / bundle UUIDs / icon name.
 *
 * Also ensures OnlineApp lifecycle SOME/IP proxies are present (OAPController,
 * AppStatus, NSM, …). Race 1.0.0–1.0.2 shipped a stripped manifest that let the
 * tile install but OnlineApp.start() fail silently on open.
 *
 * Overwrites renderer/screens.json from apps/kingkong_race/renderer/ (Drag +
 * Race tree — never cardata Engine/Fuel). Injects raceTree/raceBrand into the
 * packaged tele-widgets + gpu-elements. Ensures kind:"gpu" (+ Quiet Dials
 * bg/theme). Without kind, ScreenApp._find fails → title bar only / blank blue.
 *
 * Usage: node tools/pack-race.js [version]
 * Default version: apps/kingkong_race/app.json → version
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const APP = path.join(REPO, 'apps', 'kingkong_race');
const IDENTITY = JSON.parse(
  fs.readFileSync(path.join(APP, 'rhmi-identity.json'), 'utf8')
);

/** Proxies OnlineApp / MainApp need to start + open the entry state (from working cardata). */
const OAP_LIFECYCLE_PROXIES = {
  'de.bmw.infotainment.personalization.SessionManager': '*',
  'de.bmw.infotainment.personalization.UserAccountManager': '*',
  'de.bmw.infotainment.telematic.oap.AppBookmarks': {
    instances: ['${userId}'],
    methods: ['registerBookmark']
  },
  'de.bmw.infotainment.telematic.oap.AppStatus': '*',
  'de.bmw.infotainment.telematic.oap.WakeUpOnDemand': {
    instances: ['${userId}'],
    methods: ['registerParticipant', 'unregisterParticipant']
  },
  'de.bmw.infotainment.telematic.oap.WodControl': {
    instances: '${userId}',
    methods: ['offerService', 'stopOfferingService']
  },
  'de.bmw.infotainment.telematic.oapcontroller.OAPController': '*',
  'de.bmw.infotainment.telematic.provisioning.Provisioning': {
    instances: '1',
    broadcasts: ['provisioningDataJSON'],
    methods: ['getValueJSON', 'setFilterForProvisioningData']
  },
  'org.genivi.nodestatemanager.Consumer': {
    instances: 'NSMConsumer',
    broadcasts: ['ShutdownEvents', 'SessionStateChanged'],
    methods: [
      'LifecycleRequestComplete',
      'RegisterShutdownClient',
      'UnRegisterShutdownClient'
    ]
  }
};

/** Race vehicle signals (speed + longitudinal accel). Declared only — main.js never uses TASU/DME. */
const RACE_VEHICLE_PROXIES = {
  'de.bmw.infotainment.vehicle.CDS2': '*',
  'de.bmw.infotainment.vehicle.Vehicle2': '*'
};

function die(msg) {
  console.error(msg);
  process.exit(1);
}

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function writeJson(p, obj) {
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n');
}

const appMeta = readJson(path.join(APP, 'app.json'));
const version = process.argv[2] || appMeta.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) die(`bad version: ${version}`);

const existing = fs
  .readdirSync(APP)
  .filter((f) => /^kingkong_race@\d+\.\d+\.\d+\.tgz$/.test(f))
  .sort();
if (!existing.length) die('no existing kingkong_race@*.tgz to base on');

const baseTgz = path.join(APP, existing[existing.length - 1]);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-pack-race-'));
const extract = path.join(work, 'extract');
fs.mkdirSync(extract);
execFileSync('tar', ['-xzf', baseTgz, '-C', extract]);

const oldDir = fs
  .readdirSync(extract)
  .find((n) => /^kingkong_race@\d+\.\d+\.\d+$/.test(n));
if (!oldDir) die('package dir missing inside tgz');
const pkgDir = path.join(extract, `kingkong_race@${version}`);
if (oldDir !== `kingkong_race@${version}`) {
  fs.renameSync(path.join(extract, oldDir), pkgDir);
}

const appJsonPath = path.join(pkgDir, 'rhmiData', 'application.json');
const appj = readJson(appJsonPath);
const app = appj.application;
const forbidden = IDENTITY.forbiddenCardataCollisions;

app.uuid = IDENTITY.applicationUuid;
app.version = version;
app.stringBundleUuid = IDENTITY.stringBundleUuid;
app.resourceBundleUuid = IDENTITY.resourceBundleUuid;
app.appletId = IDENTITY.appletId;
const ep = app.entryPoints[0];
ep.uuid = IDENTITY.entryPointUuid;
ep.textId = IDENTITY.entryPointTextId;
ep.icon = IDENTITY.icon;
writeJson(appJsonPath, appj);

const strings = {
  SID_0: 'KingKong Race',
  SID_1: 'Race',
  SID_2: 'Online',
  SID_3: 'Settings',
  SID_4: 'KingKong Race',
  SID_7: 'KingKong Race'
};
for (const lang of ['en_US', 'en_GB']) {
  writeJson(path.join(pkgDir, 'rhmiData', 'strings', `${lang}.json`), strings);
  writeJson(
    path.join(pkgDir, 'rhmiData', 'variantGroups', 'Common', 'texts', `${lang}.json`),
    strings
  );
}

const iconPath = path.join(pkgDir, 'rhmiData', 'resources', IDENTITY.icon);
if (!fs.existsSync(iconPath)) die(`missing resource icon ${IDENTITY.icon}`);

// SOME/IP: keep HMI/RHMI proxies already in the base package; force OAP lifecycle + Race vehicle.
const manifestPath = path.join(pkgDir, 'manifest.json');
const manifest = readJson(manifestPath);
manifest.proxies = Object.assign({}, manifest.proxies, OAP_LIFECYCLE_PROXIES, RACE_VEHICLE_PROXIES);
if (!manifest.services) manifest.services = {};
manifest.services['de.bmw.infotainment.telematic.oap.AppStatus'] = {
  instances: ['${userId}']
};
writeJson(manifestPath, manifest);
for (const key of Object.keys(OAP_LIFECYCLE_PROXIES)) {
  if (!manifest.proxies[key]) die(`missing OAP lifecycle proxy after merge: ${key}`);
}
if (!manifest.proxies['de.bmw.infotainment.telematic.oapcontroller.OAPController']) {
  die('OAPController proxy missing — OnlineApp will not open');
}

// Race owns its screens + raceTree/raceBrand widgets (not cardata Engine/Fuel).
// Source of truth: apps/kingkong_race/renderer/{screens.json,race-widgets.js}
const SCREEN_META = {
  drag: { title: 'Drag', entry: true },
  race: { title: 'Race', entry: false },
  online: { title: 'Online', entry: false },
  settings: { title: 'Settings', entry: false }
};
const RACE_NAMES = Object.keys(SCREEN_META);
const CARDATA_SCREEN_NAMES = ['engine', 'fuel', 'trips', 'transmission', 'dpf', 'details'];
const screensSrc = path.join(APP, 'renderer', 'screens.json');
const raceWidgetsSrc = path.join(APP, 'renderer', 'race-widgets.js');
if (!fs.existsSync(screensSrc)) die('apps/kingkong_race/renderer/screens.json missing');
if (!fs.existsSync(raceWidgetsSrc)) die('apps/kingkong_race/renderer/race-widgets.js missing');

const rendererDir = path.join(pkgDir, 'renderer');
if (!fs.existsSync(rendererDir)) die('renderer/ missing in package');
fs.copyFileSync(screensSrc, path.join(rendererDir, 'screens.json'));
fs.copyFileSync(raceWidgetsSrc, path.join(rendererDir, 'race-widgets.js'));
const logoSrc = path.join(APP, 'renderer', 'logo.png');
if (!fs.existsSync(logoSrc)) die('apps/kingkong_race/renderer/logo.png missing (official Kingkong logo)');
fs.copyFileSync(logoSrc, path.join(rendererDir, 'logo.png'));

const telePath = path.join(rendererDir, 'tele-widgets.js');
let teleSrc = fs.readFileSync(telePath, 'utf8');
if (!teleSrc.includes("require('./race-widgets')")) {
  const hook =
    "\nC.tab = C.tab || C.dim;\n" +
    "(function () {\n" +
    "    const RW = require('./race-widgets');\n" +
    "    Object.assign(DRAW, RW.DRAW);\n" +
    "    Object.assign(TRY, RW.TRY || {});\n" +
    "})();\n";
  if (!teleSrc.includes('module.exports')) die('tele-widgets.js missing module.exports');
  teleSrc = teleSrc.replace('module.exports', hook + 'module.exports');
  fs.writeFileSync(telePath, teleSrc);
}

const gpuElPath = path.join(rendererDir, 'public', 'gpu-elements.js');
let gpuElSrc = fs.readFileSync(gpuElPath, 'utf8');
if (!gpuElSrc.includes('raceTree:')) {
  const elInject =
    "        raceTree: { label: 'Race tree', icon: '●', tele: true, box: [240, 520], fields: [" +
    "F('amber', 'Ambers', 'text', '0,0,0'), F('green', 'Green', 'bool', false), " +
    "F('foul', 'Foul', 'bool', false), F('staged', 'Staged', 'bool', true)] },\n" +
    "        raceBrand: { label: 'Race brand', icon: 'K', tele: true, box: [900, 110], fields: [" +
    "F('title', 'Title', 'text', 'KINGKONG'), F('sub', 'Sub', 'text', 'TUNING'), " +
    "F('align', 'Align', 'select', 'left', ['left', 'center'])] },\n";
  const anchor = "        teleTabBar: { label: 'T Bottom tabs'";
  if (!gpuElSrc.includes(anchor)) die('gpu-elements.js teleTabBar anchor missing');
  gpuElSrc = gpuElSrc.replace(anchor, elInject + anchor);
  fs.writeFileSync(gpuElPath, gpuElSrc);
}

const screensPath = path.join(rendererDir, 'screens.json');
const screensDoc = readJson(screensPath);
if (!Array.isArray(screensDoc.screens) || !screensDoc.screens.length) {
  die('renderer/screens.json has no screens');
}
const packedNames = screensDoc.screens.map((s) => s.name);
for (const bad of CARDATA_SCREEN_NAMES) {
  if (packedNames.includes(bad)) die(`Race screens must not include cardata screen "${bad}"`);
}
for (const need of RACE_NAMES) {
  if (!packedNames.includes(need)) die(`Race screens missing "${need}"`);
}
for (const st of screensDoc.screens) {
  const meta = SCREEN_META[st.name] || { title: st.name, entry: false };
  st.kind = 'gpu';
  st.title = meta.title;
  st.entry = !!meta.entry;
  st.bg = st.bg || '#050505';
  st.bgArea = st.bgArea || 'app';
  st.theme = st.theme || 'kingkong';
}
writeJson(screensPath, screensDoc);
for (const st of screensDoc.screens) {
  if (st.kind !== 'gpu') die(`screen ${st.name} missing kind:gpu after patch`);
}
if (!screensDoc.screens.some((s) => s.name === 'drag' && s.entry === true)) {
  die('drag screen must be entry:true');
}
const raceScreen = screensDoc.screens.find((s) => s.name === 'race');
if (!raceScreen.components.some((c) => c.gpu === 'raceTree' || c.name === 'raceTree')) {
  die('race screen must include raceTree christmas-tree element');
}
const dragScreen = screensDoc.screens.find((s) => s.name === 'drag');
if (dragScreen.components.some((c) => /engine|fuel|rpm|boost/i.test(c.name || ''))) {
  die('drag screen looks like cardata Engine/Fuel');
}
if (!fs.readFileSync(telePath, 'utf8').includes("require('./race-widgets')")) {
  die('tele-widgets.js missing race-widgets hook');
}
if (!fs.readFileSync(gpuElPath, 'utf8').includes('raceTree:')) {
  die('gpu-elements.js missing raceTree');
}

const pkg = readJson(path.join(pkgDir, 'package.json'));
pkg.name = 'kingkong_race';
pkg.version = version;
pkg.dependencies = { 'oap-sdk': '24.10.2' };
pkg.mguLocalOnly = true;
pkg.productName = 'KingKong Race';
pkg.author = 'Kingkong Tuning';
pkg.store = {
  description:
    'KingKong Race for BMW iDrive 8: drag timer and christmas-tree practice. Vehicle speed and optional g only — never talks to the DME. Closed-course use.'
};
writeJson(path.join(pkgDir, 'package.json'), pkg);
writeJson(path.join(pkgDir, 'npm-shrinkwrap.json'), {
  name: 'kingkong_race',
  version,
  lockfileVersion: 1,
  requires: true,
  dependencies: {}
});

const repoSrc = path.join(APP, 'src');
// Match cardata: modules live only in outer tgz `src/`, not inside the versioned package tree.
const strayPkgSrc = path.join(pkgDir, 'src');
if (fs.existsSync(strayPkgSrc)) {
  execFileSync('rm', ['-rf', strayPkgSrc]);
}

const mgu = {
  schema: 1,
  id: 'kingkong_race',
  version,
  tree: `kingkong_race@${version}`,
  modules: [
    'src/main.js',
    'src/timer.js',
    'src/race.js',
    'src/qrcodegen.js',
    'src/online-host.js'
  ],
  sdk: [
    'oap-sdk/src/core/OnlineApp.js',
    'oap-sdk/src/logging/logging',
    'oap-sdk/src/someip/someipBuilders'
  ],
  mguHmi: ['ID8']
};
writeJson(path.join(extract, 'mgu-app.json'), mgu);
writeJson(path.join(APP, 'mgu-app.json'), mgu);

const outerSrc = path.join(extract, 'src');
fs.mkdirSync(outerSrc, { recursive: true });
for (const f of fs.readdirSync(repoSrc)) {
  const src = path.join(repoSrc, f);
  if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(outerSrc, f));
}

const strayIcon = path.join(extract, 'icon.png');
if (fs.existsSync(strayIcon)) fs.unlinkSync(strayIcon);

// Collision guards — never ship a cardata clone
if (app.appletId === forbidden.appletId) die('appletId collides with cardata');
if (ep.uuid === forbidden.entryPoint) die('entryPoint uuid collides with cardata');
if (app.stringBundleUuid === forbidden.stringBundleUuid) die('stringBundleUuid collides');
if (app.resourceBundleUuid === forbidden.resourceBundleUuid) die('resourceBundleUuid collides');
if (ep.icon === forbidden.icon) die('icon still points at cardata');
if (ep.icon !== IDENTITY.icon) die('icon mismatch');
if (strings.SID_7 !== 'KingKong Race') die('SID_7 missing');

appMeta.version = version;
writeJson(path.join(APP, 'app.json'), appMeta);

const outTgz = path.join(APP, `kingkong_race@${version}.tgz`);
const staging = path.join(work, 'stage');
fs.mkdirSync(staging);
execFileSync('cp', ['-a', pkgDir, path.join(staging, `kingkong_race@${version}`)]);
fs.copyFileSync(path.join(extract, 'mgu-app.json'), path.join(staging, 'mgu-app.json'));
fs.mkdirSync(path.join(staging, 'src'));
for (const f of fs.readdirSync(outerSrc)) {
  fs.copyFileSync(path.join(outerSrc, f), path.join(staging, 'src', f));
}

if (fs.existsSync(outTgz)) fs.unlinkSync(outTgz);
execFileSync('tar', ['-czf', outTgz, '-C', staging, `kingkong_race@${version}`, 'mgu-app.json', 'src']);

// Keep current only (match cardata convention)
for (const f of fs.readdirSync(APP)) {
  if (/^kingkong_race@\d+\.\d+\.\d+\.tgz$/.test(f) && f !== `kingkong_race@${version}.tgz`) {
    fs.unlinkSync(path.join(APP, f));
  }
}

console.log(`packed ${outTgz}`);
console.log(`appletId ${IDENTITY.appletId} (cardata forbidden ${forbidden.appletId})`);
console.log(
  `someip proxies ${Object.keys(manifest.proxies).length} (incl. OAPController + AppStatus)`
);
