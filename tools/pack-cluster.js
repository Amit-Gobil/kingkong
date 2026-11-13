#!/usr/bin/env node
/**
 * Rebuild apps/kingkong_cluster/kingkong_cluster@VERSION.tgz.
 * Bases on the latest kingkong_race@*.tgz RHMI/renderer skeleton, then applies
 * Cluster's own identity, screens, and modules. Does not touch cardata or race.
 *
 * Usage: node tools/pack-cluster.js [version]
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const APP = path.join(REPO, 'apps', 'kingkong_cluster');
const RACE = path.join(REPO, 'apps', 'kingkong_race');
const IDENTITY = JSON.parse(fs.readFileSync(path.join(APP, 'rhmi-identity.json'), 'utf8'));

const OAP_LIFECYCLE_PROXIES = {
  'de.bmw.infotainment.personalization.SessionManager': '*',
  'de.bmw.infotainment.personalization.UserAccountManager': '*',
  'de.bmw.infotainment.telematic.oap.AppBookmarks': {
    instances: ['${userId}'],
    methods: ['registerBookmark'],
  },
  'de.bmw.infotainment.telematic.oap.AppStatus': '*',
  'de.bmw.infotainment.telematic.oap.WakeUpOnDemand': {
    instances: ['${userId}'],
    methods: ['registerParticipant', 'unregisterParticipant'],
  },
  'de.bmw.infotainment.telematic.oap.WodControl': {
    instances: '${userId}',
    methods: ['offerService', 'stopOfferingService'],
  },
  'de.bmw.infotainment.telematic.oapcontroller.OAPController': '*',
  'de.bmw.infotainment.telematic.provisioning.Provisioning': {
    instances: '1',
    broadcasts: ['provisioningDataJSON'],
    methods: ['getValueJSON', 'setFilterForProvisioningData'],
  },
  'org.genivi.nodestatemanager.Consumer': {
    instances: 'NSMConsumer',
    broadcasts: ['ShutdownEvents', 'SessionStateChanged'],
    methods: [
      'LifecycleRequestComplete',
      'RegisterShutdownClient',
      'UnRegisterShutdownClient',
    ],
  },
};

const CLUSTER_PROXIES = {
  'de.bmw.infotainment.drivingexcitement.FES': '*',
  'de.bmw.infotainment.misc.MDrive': '*',
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

const raceTgz = fs
  .readdirSync(RACE)
  .filter((f) => /^kingkong_race@\d+\.\d+\.\d+\.tgz$/.test(f))
  .sort()
  .pop();
if (!raceTgz) die('no kingkong_race@*.tgz to base RHMI skeleton on');

const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-pack-cluster-'));
const extract = path.join(work, 'extract');
fs.mkdirSync(extract);
execFileSync('tar', ['-xzf', path.join(RACE, raceTgz), '-C', extract]);

const oldDir = fs.readdirSync(extract).find((n) => /^kingkong_race@\d+\.\d+\.\d+$/.test(n));
if (!oldDir) die('race package dir missing inside tgz');
const pkgDir = path.join(extract, `kingkong_cluster@${version}`);
fs.renameSync(path.join(extract, oldDir), pkgDir);

// RHMI identity
const appJsonPath = path.join(pkgDir, 'rhmiData', 'application.json');
const appj = readJson(appJsonPath);
const app = appj.application;
const forbidden = IDENTITY.forbiddenCollisions;

app.name = 'kingkong_cluster';
app.vendor = 'KingkongTuning';
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
  SID_0: 'Kingkong Cluster',
  SID_1: 'Status',
  SID_2: 'Settings',
  SID_3: 'Settings',
  SID_4: 'Kingkong Cluster',
  SID_7: 'Kingkong Cluster',
};
for (const lang of ['en_US', 'en_GB']) {
  writeJson(path.join(pkgDir, 'rhmiData', 'strings', `${lang}.json`), strings);
  writeJson(
    path.join(pkgDir, 'rhmiData', 'variantGroups', 'Common', 'texts', `${lang}.json`),
    strings
  );
}

// Icon resource rename
const resDir = path.join(pkgDir, 'rhmiData', 'resources');
const raceIcon = path.join(resDir, 'kingkong_race_icon.png');
const clusterIcon = path.join(resDir, IDENTITY.icon);
if (fs.existsSync(raceIcon)) {
  fs.copyFileSync(raceIcon, clusterIcon);
  try { fs.unlinkSync(raceIcon); } catch (e) { /* */ }
}
if (!fs.existsSync(clusterIcon)) {
  // fallback: app icon
  fs.copyFileSync(path.join(APP, 'icon.png'), clusterIcon);
}

const logoSrc = path.join(APP, 'renderer', 'logo.png');
if (fs.existsSync(logoSrc)) {
  fs.copyFileSync(logoSrc, path.join(pkgDir, 'renderer', 'logo.png'));
}

// SOME/IP
const manifestPath = path.join(pkgDir, 'manifest.json');
const manifest = readJson(manifestPath);
manifest.proxies = Object.assign({}, manifest.proxies, OAP_LIFECYCLE_PROXIES, CLUSTER_PROXIES);
if (!manifest.services) manifest.services = {};
manifest.services['de.bmw.infotainment.telematic.oap.AppStatus'] = {
  instances: ['${userId}'],
};
writeJson(manifestPath, manifest);
if (!manifest.proxies['de.bmw.infotainment.telematic.oapcontroller.OAPController']) {
  die('OAPController proxy missing');
}
if (!manifest.proxies['de.bmw.infotainment.drivingexcitement.FES']) {
  die('FES proxy missing');
}

// Screens
const screensSrc = path.join(APP, 'renderer', 'screens.json');
if (!fs.existsSync(screensSrc)) die('renderer/screens.json missing');
const rendererDir = path.join(pkgDir, 'renderer');
fs.copyFileSync(screensSrc, path.join(rendererDir, 'screens.json'));

// Race skeleton injects require('./race-widgets') into tele-widgets.js. Cluster
// screens do not use raceBrand/raceTree, so drop the file AND the require —
// leaving the require with no file crashes GPU init on CID open (blank/no-open).
const raceWidgets = path.join(rendererDir, 'race-widgets.js');
if (fs.existsSync(raceWidgets)) fs.unlinkSync(raceWidgets);
const telePath = path.join(rendererDir, 'tele-widgets.js');
if (fs.existsSync(telePath)) {
  let teleSrc = fs.readFileSync(telePath, 'utf8');
  const raceHook =
    /\nC\.tab = C\.tab \|\| C\.dim;\n\(function \(\) \{\n\s*const RW = require\('\.\/race-widgets'\);\n\s*Object\.assign\(DRAW, RW\.DRAW\);\n\s*Object\.assign\(TRY, RW\.TRY \|\| \{\}\);\n\}\)\(\);\n/;
  if (raceHook.test(teleSrc)) {
    teleSrc = teleSrc.replace(raceHook, '\n');
    fs.writeFileSync(telePath, teleSrc);
  }
  if (teleSrc.includes("require('./race-widgets')") || teleSrc.includes('require("./race-widgets")')) {
    die('tele-widgets.js still requires race-widgets — CID open would crash');
  }
}

const screensDoc = readJson(path.join(rendererDir, 'screens.json'));
for (const st of screensDoc.screens) {
  st.kind = 'gpu';
  st.bg = st.bg || '#050505';
  st.bgArea = st.bgArea || 'app';
  st.theme = st.theme || 'kingkong';
}
writeJson(path.join(rendererDir, 'screens.json'), screensDoc);
if (!screensDoc.screens.some((s) => s.name === 'drag' && s.entry === true)) {
  die('drag (Status) must be entry');
}
if (!screensDoc.screens.some((s) => s.name === 'settings')) die('settings screen missing');

const DESC =
  `Kingkong Cluster ${version}: Quiet Dials black/gold KOMBI status strip via Cluster renderer (boost / power% / torque%). English. G81 M Mode yield. Requires Cluster renderer from Store.`;

const pkg = readJson(path.join(pkgDir, 'package.json'));
pkg.name = 'kingkong_cluster';
pkg.version = version;
pkg.description = DESC;
pkg.dependencies = { 'oap-sdk': '24.10.2' };
pkg.mguLocalOnly = true;
pkg.productName = 'Kingkong Cluster';
pkg.author = 'Kingkong Tuning';
pkg.mguRequires = { 'mgu-deploy': '0.7.5' };
pkg.oapAppSettings = Object.assign({}, pkg.oapAppSettings, { loggingId: 'OA9C' });
pkg.store = {
  description:
    'Kingkong Tuning KOMBI status strip for BMW iDrive 8: thin black/gold overlay (boost, power%, torque%) via Cluster renderer widget/map. English. Install Cluster renderer first. G81-aware hide in M Mode.',
};
writeJson(path.join(pkgDir, 'package.json'), pkg);
writeJson(path.join(pkgDir, 'npm-shrinkwrap.json'), {
  name: 'kingkong_cluster',
  version,
  lockfileVersion: 1,
  requires: true,
  dependencies: {},
});

// Top-level package icon
fs.copyFileSync(path.join(APP, 'icon.png'), path.join(pkgDir, 'icon.png'));

const modules = [
  'src/main.js',
  'src/strip.js',
  'src/cluster_render_client.js',
  'src/online-host.js',
];
const mgu = {
  schema: 1,
  id: 'kingkong_cluster',
  version,
  tree: `kingkong_cluster@${version}`,
  modules,
  sdk: [
    'oap-sdk/src/core/OnlineApp.js',
    'oap-sdk/src/logging/logging',
    'oap-sdk/src/someip/someipBuilders',
  ],
  mguHmi: ['ID8'],
};
writeJson(path.join(extract, 'mgu-app.json'), mgu);
writeJson(path.join(APP, 'mgu-app.json'), mgu);

const repoSrc = path.join(APP, 'src');
const strayPkgSrc = path.join(pkgDir, 'src');
if (fs.existsSync(strayPkgSrc)) execFileSync('rm', ['-rf', strayPkgSrc]);

const outerSrc = path.join(extract, 'src');
// Race tgz leaves race-only modules in outer src/; replace with Cluster's own set.
if (fs.existsSync(outerSrc)) execFileSync('rm', ['-rf', outerSrc]);
fs.mkdirSync(outerSrc, { recursive: true });
for (const f of fs.readdirSync(repoSrc)) {
  const src = path.join(repoSrc, f);
  if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(outerSrc, f));
}

const ALLOWED_SRC = new Set(['main.js', 'strip.js', 'cluster_render_client.js', 'online-host.js']);
for (const f of fs.readdirSync(outerSrc)) {
  if (!ALLOWED_SRC.has(f)) die(`unexpected src/${f} in cluster package (race leftover?)`);
}
for (const need of ALLOWED_SRC) {
  if (!fs.existsSync(path.join(outerSrc, need))) die(`src/${need} missing`);
}
if (!fs.readFileSync(path.join(outerSrc, 'cluster_render_client.js'), 'utf8').includes('MPL-2.0')) {
  die('cluster_render_client.js missing MPL-2.0 header');
}
if (!fs.readFileSync(path.join(outerSrc, 'main.js'), 'utf8').includes('ClusterRender')) {
  die('main.js missing ClusterRender');
}

// Collision guards
if (app.appletId === forbidden.cardataAppletId || app.appletId === forbidden.raceAppletId) {
  die('appletId collides');
}
if (ep.uuid === forbidden.cardataEntryPoint || ep.uuid === forbidden.raceEntryPoint) {
  die('entryPoint uuid collides');
}
if (ep.icon === forbidden.cardataIcon || ep.icon === forbidden.raceIcon) die('icon collision');
if (ep.icon !== IDENTITY.icon) die('icon mismatch');
if (strings.SID_7 !== 'Kingkong Cluster') die('SID_7 wrong');

appMeta.version = version;
appMeta.description = DESC;
writeJson(path.join(APP, 'app.json'), appMeta);

const outTgz = path.join(APP, `kingkong_cluster@${version}.tgz`);
const staging = path.join(work, 'stage');
fs.mkdirSync(staging);
execFileSync('cp', ['-a', pkgDir, path.join(staging, `kingkong_cluster@${version}`)]);
fs.copyFileSync(path.join(extract, 'mgu-app.json'), path.join(staging, 'mgu-app.json'));
fs.mkdirSync(path.join(staging, 'src'));
for (const f of fs.readdirSync(outerSrc)) {
  fs.copyFileSync(path.join(outerSrc, f), path.join(staging, 'src', f));
}

if (fs.existsSync(outTgz)) fs.unlinkSync(outTgz);
execFileSync('tar', ['-czf', outTgz, '-C', staging, `kingkong_cluster@${version}`, 'mgu-app.json', 'src']);

for (const f of fs.readdirSync(APP)) {
  if (/^kingkong_cluster@\d+\.\d+\.\d+\.tgz$/.test(f) && f !== `kingkong_cluster@${version}.tgz`) {
    fs.unlinkSync(path.join(APP, f));
  }
}

// sanity extract
const check = path.join(work, 'check');
fs.mkdirSync(check);
execFileSync('tar', ['-xzf', outTgz, '-C', check]);
const checkApp = readJson(
  path.join(check, `kingkong_cluster@${version}`, 'rhmiData', 'application.json')
).application;
if (checkApp.appletId !== IDENTITY.appletId) die('packed appletId wrong');
if (checkApp.entryPoints[0].icon !== IDENTITY.icon) die('packed icon wrong');
if (!fs.existsSync(path.join(check, 'src', 'cluster_render_client.js'))) die('client missing in tgz');
if (!fs.existsSync(path.join(check, 'src', 'strip.js'))) die('strip.js missing in tgz');
const checkScreens = readJson(
  path.join(check, `kingkong_cluster@${version}`, 'renderer', 'screens.json')
);
if (!checkScreens.screens.every((s) => s.kind === 'gpu')) die('screens missing kind:gpu');
const checkTele = fs.readFileSync(
  path.join(check, `kingkong_cluster@${version}`, 'renderer', 'tele-widgets.js'),
  'utf8'
);
if (checkTele.includes('race-widgets')) die('packed tele-widgets still references race-widgets');
if (fs.existsSync(path.join(check, `kingkong_cluster@${version}`, 'renderer', 'race-widgets.js'))) {
  die('race-widgets.js should not ship in cluster');
}
for (const leak of ['qrcodegen.js', 'race.js', 'timer.js']) {
  if (fs.existsSync(path.join(check, 'src', leak))) die(`race src leak: ${leak}`);
}

console.log(`packed ${outTgz}`);
console.log(`appletId ${IDENTITY.appletId}; based on ${raceTgz}`);
console.log(`modules ${modules.join(', ')}`);
