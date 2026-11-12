#!/usr/bin/env node
/**
 * Rebuild apps/kingkong_cardata/kingkong_cardata@VERSION.tgz from the latest
 * committed tarball + apps/kingkong_cardata/src (+ Adjust screen / RHMI host).
 *
 * Usage: node tools/pack-cardata.js [version]
 * Default version: apps/kingkong_cardata/app.json → version
 */
'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const REPO = path.resolve(__dirname, '..');
const APP = path.join(REPO, 'apps', 'kingkong_cardata');

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
  .filter((f) => /^kingkong_cardata@\d+\.\d+\.\d+\.tgz$/.test(f))
  .sort();
if (!existing.length) die('no existing kingkong_cardata@*.tgz to base on');

const baseTgz = path.join(APP, existing[existing.length - 1]);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-pack-cardata-'));
const extract = path.join(work, 'extract');
fs.mkdirSync(extract);
execFileSync('tar', ['-xzf', baseTgz, '-C', extract]);

const pkgName = fs.readdirSync(extract).find((n) => n.startsWith('kingkong_cardata@'));
if (!pkgName) die('tarball missing kingkong_cardata@* tree');
const pkgDir = path.join(extract, pkgName);
const renamed = path.join(extract, `kingkong_cardata@${version}`);
if (pkgDir !== renamed) {
  fs.renameSync(pkgDir, renamed);
}
const tree = path.join(extract, `kingkong_cardata@${version}`);

// Flip to true to restore Trips / Details tabs. Keep in sync with apps/kingkong_cardata/src/main.js.
const SHOW_TRIPS_DETAILS = false;
const TABS = SHOW_TRIPS_DETAILS
  ? 'Engine, Fuel, Trips, Transmission, Adjust, Details, Settings'
  : 'Engine, Fuel, Transmission, Adjust, Settings';
const TAB_SEL = SHOW_TRIPS_DETAILS
  ? {
      engine: 0,
      fuel: 1,
      trips: 2,
      transmission: 3,
      adjust: 4,
      details: 5,
      settings: 6,
      dpf: 0,
    }
  : {
      engine: 0,
      fuel: 1,
      trips: 0, // hidden: screens remain; sel unused in tab bar
      transmission: 2,
      adjust: 3,
      details: 0,
      settings: 4,
      dpf: 0,
    };

// ---- screens.json: inject Adjust + refresh tab bars on every page ----
const screensPath = path.join(tree, 'renderer', 'screens.json');
const design = readJson(screensPath);
const adjustScreen = readJson(path.join(APP, 'renderer', 'adjust-screen.json'));
design.screens = design.screens.filter((s) => s.name !== 'adjust');
const detailsIdx = design.screens.findIndex((s) => s.name === 'details');
if (detailsIdx < 0) die('details screen missing');
design.screens.splice(detailsIdx, 0, adjustScreen);

// Static placeholder copy in screens.json (English-only UI).
const EN_TEXT = {
  Effekt: 'Power',
  Vridmoment: 'Torque',
  Etanol: 'Ethanol',
  ETANOL: 'ETHANOL',
  'Effekt peak': 'Power peak',
  'Vridmoment peak': 'Torque peak',
  'väntar på DME…': 'waiting for DME…',
  'Skicka-logg': 'Send log',
  SUPPORTLOGG: 'SUPPORT LOG',
  'Ringbuffer · 30 min lokalt': 'Ringbuffer · 30 min local',
};

function enify(str) {
  if (typeof str !== 'string') return str;
  let out = str;
  // Longer keys first so peak rows replace before bare labels.
  Object.keys(EN_TEXT)
    .sort((a, b) => b.length - a.length)
    .forEach((sv) => {
      if (out.indexOf(sv) >= 0) out = out.split(sv).join(EN_TEXT[sv]);
    });
  return out;
}

for (const s of design.screens) {
  if (!s.kind) s.kind = 'gpu';
  if (!s.theme) s.theme = 'kingkong';
  if (!s.bg) s.bg = '#050505';
  const sel = Object.prototype.hasOwnProperty.call(TAB_SEL, s.name) ? TAB_SEL[s.name] : 0;
  for (const c of s.components || []) {
    if (c.gpu === 'teleTabBar' && c.opts) {
      c.opts.tabs = TABS;
      c.opts.sel = sel;
      c.y = 748;
    }
    if (c.gpu === 'teleShell' && c.opts) {
      c.opts.tabs = TABS;
      c.opts.sel = sel;
      c.opts.hideTabs = true;
      c.opts.app = 'Kingkong';
      c.opts.credit = 'Kingkong Tuning';
    }
    // Engine shell: static preview of FES sport glance chips (runtime overwrites via main.js).
    if (s.name === 'engine' && c.name === 'engineMenu' && c.opts) {
      c.opts.chips = 'Boost 1.12|accent; Power 45%|accent; Torque 62%|accent';
      c.opts.sub = 'Quiet Dials · sport';
    }
    if (c.opts) {
      ['label', 'text', 'rows', 'sub', 'foot', 'caption'].forEach((k) => {
        if (typeof c.opts[k] === 'string') c.opts[k] = enify(c.opts[k]);
      });
      // Settings bar-end sliders: power ≤1500 hp, torque ≤1700 Nm (matches RANGES in main.js).
      if (c.name === 'powerMax') c.opts.max = 1500;
      if (c.name === 'torqueMax') c.opts.max = 1700;
    }
  }
}
writeJson(screensPath, design);

// ---- RHMI host state for Adjust (id 10000 / SID_8) ----
const uiPath = path.join(tree, 'rhmiData', 'uiDescriptions', 'ID8', 'uiDescription.json');
const ui = readJson(uiPath);
ui.containers['10000'] = {
  type: 'state',
  name: 'adjust',
  components: {
    '10220': {
      type: 'title',
      name: 'adjustTitle',
      rows: [{ Text: { value: 'SID_8', type: 'StringId' } }],
    },
  },
};
writeJson(uiPath, ui);

const xmlPath = path.join(tree, 'rhmiData', 'uiDescriptions', 'ID8', 'application.xml');
let xml = fs.readFileSync(xmlPath, 'utf8');
if (!xml.includes('id="10000"')) {
  const block = `    <container id="10000" type="state" widget="LT_State_Wide_List">
        <layoutGroup id="10200" name="Titlebar">
            <component id="10220" type="title">
                <property id="2" value="1"/>
            </component>
        </layoutGroup>
        <layoutGroup id="10400" name="List">
            <property id="3" value="1"/>
        </layoutGroup>
    </container>
`;
  xml = xml.replace('</application>', `${block}</application>`);
  fs.writeFileSync(xmlPath, xml);
}

const stringFiles = [
  path.join(tree, 'rhmiData', 'strings', 'en_US.json'),
  path.join(tree, 'rhmiData', 'strings', 'en_GB.json'),
  path.join(tree, 'rhmiData', 'variantGroups', 'Common', 'texts', 'en_US.json'),
  path.join(tree, 'rhmiData', 'variantGroups', 'Common', 'texts', 'en_GB.json'),
];
for (const p of stringFiles) {
  const s = readJson(p);
  s.SID_8 = 'Adjust';
  writeJson(p, s);
}

// ---- package metadata ----
const DESC =
  'Kingkong Quiet Dials 1.2.8: Engine sport glance chips (FES boost / power % / torque %). English UI. Power/Torque maxima 1500 hp / 1700 Nm. Ethanol, Send log.';
const pkg = readJson(path.join(tree, 'package.json'));
pkg.name = 'kingkong_cardata';
pkg.version = version;
pkg.description = DESC;
pkg.productName = 'Kingkong';
pkg.author = 'Kingkong Tuning';
pkg.store = {
  description:
    'Kingkong Tuning Quiet Dials for BMW iDrive 8: Engine sport glance chips (boost / power% / torque%), Fuel, Transmission, Adjust, Settings. MHD Adjust, ethanol, Send log. Black and gold. English UI.',
};
writeJson(path.join(tree, 'package.json'), pkg);
writeJson(path.join(tree, 'npm-shrinkwrap.json'), {
  name: 'kingkong_cardata',
  version,
  lockfileVersion: 1,
  requires: true,
  dependencies: {},
});

const repoSrc = path.join(APP, 'src');
const strayPkgSrc = path.join(tree, 'src');
if (fs.existsSync(strayPkgSrc)) execFileSync('rm', ['-rf', strayPkgSrc]);

const modules = [
  'src/main.js',
  'src/obd.js',
  'src/trips.js',
  'src/engine-groups.js',
  'src/engine-groups-catalog.js',
  'src/transmission.js',
  'src/tabs.js',
  'src/dpf.js',
  'src/tasu-guard.js',
  'src/online-host.js',
  'src/logbuf.js',
  'src/ethanol.js',
  'src/flap.js',
  'src/adjust.js',
];
const mgu = {
  schema: 1,
  id: 'kingkong_cardata',
  version,
  tree: `kingkong_cardata@${version}`,
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

const outerSrc = path.join(extract, 'src');
fs.mkdirSync(outerSrc, { recursive: true });
for (const f of fs.readdirSync(repoSrc)) {
  const src = path.join(repoSrc, f);
  if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(outerSrc, f));
}

appMeta.version = version;
appMeta.description = DESC;
writeJson(path.join(APP, 'app.json'), appMeta);

const outTgz = path.join(APP, `kingkong_cardata@${version}.tgz`);
const staging = path.join(work, 'stage');
fs.mkdirSync(staging);
execFileSync('cp', ['-a', tree, path.join(staging, `kingkong_cardata@${version}`)]);
fs.copyFileSync(path.join(extract, 'mgu-app.json'), path.join(staging, 'mgu-app.json'));
fs.mkdirSync(path.join(staging, 'src'));
for (const f of fs.readdirSync(outerSrc)) {
  fs.copyFileSync(path.join(outerSrc, f), path.join(staging, 'src', f));
}

if (fs.existsSync(outTgz)) fs.unlinkSync(outTgz);
execFileSync('tar', ['-czf', outTgz, '-C', staging, `kingkong_cardata@${version}`, 'mgu-app.json', 'src']);

for (const f of fs.readdirSync(APP)) {
  if (/^kingkong_cardata@\d+\.\d+\.\d+\.tgz$/.test(f) && f !== `kingkong_cardata@${version}.tgz`) {
    fs.unlinkSync(path.join(APP, f));
  }
}

// sanity
const check = path.join(work, 'check');
fs.mkdirSync(check);
execFileSync('tar', ['-xzf', outTgz, '-C', check]);
const checkUi = readJson(
  path.join(check, `kingkong_cardata@${version}`, 'rhmiData', 'uiDescriptions', 'ID8', 'uiDescription.json')
);
if (!checkUi.containers['10000'] || checkUi.containers['10000'].name !== 'adjust') {
  die('packed tarball missing adjust RHMI state');
}
const checkScreens = readJson(
  path.join(check, `kingkong_cardata@${version}`, 'renderer', 'screens.json')
);
if (!checkScreens.screens.some((s) => s.name === 'adjust')) die('packed screens.json missing adjust');
const adj = checkScreens.screens.find((s) => s.name === 'adjust');
const tab = (adj.components || []).find((c) => c.gpu === 'teleTabBar');
if (!tab || tab.y !== 748) die('adjust teleTabBar not at y=748');
if (tab.opts.tabs !== TABS) die(`tab bar mismatch: ${tab.opts.tabs}`);
if (!SHOW_TRIPS_DETAILS && /Trips|Details/.test(tab.opts.tabs)) die('Trips/Details still in tab bar');
if (!fs.existsSync(path.join(check, 'src', 'adjust.js'))) die('outer src/adjust.js missing');
if (!fs.existsSync(path.join(check, 'src', 'flap.js'))) die('outer src/flap.js missing');
const checkMain = fs.readFileSync(path.join(check, 'src', 'main.js'), 'utf8');
if (!/SHOW_TRIPS_DETAILS\s*=\s*false/.test(checkMain) && !SHOW_TRIPS_DETAILS) {
  die('packed main.js missing SHOW_TRIPS_DETAILS = false');
}
if (!/power:\s*\[[^\]]*?1500/.test(checkMain) || !/torque:\s*\[[^\]]*?1700/.test(checkMain)) {
  die('packed main.js missing power/torque RANGES maxima 1500/1700');
}
if (!/function sportGlanceChips/.test(checkMain) || !/sportPowerPct/.test(checkMain)) {
  die('packed main.js missing sport glance chips');
}
const engMenu = (checkScreens.screens.find((s) => s.name === 'engine').components || []).find(
  (c) => c.name === 'engineMenu'
);
if (!engMenu || !/Boost|Power|Torque/.test(String(engMenu.opts && engMenu.opts.chips))) {
  die('packed engineMenu missing sport glance chip preview');
}
const screensBlob = JSON.stringify(checkScreens);
if (/Effekt|Vridmoment|Etanol|Skicka-logg|väntar på DME|SUPPORTLOGG|lokalt/.test(screensBlob)) {
  die('packed screens.json still has Swedish UI copy');
}
const settings = checkScreens.screens.find((s) => s.name === 'settings');
const powerMax = (settings.components || []).find((c) => c.name === 'powerMax');
const torqueMax = (settings.components || []).find((c) => c.name === 'torqueMax');
if (!powerMax || powerMax.opts.max !== 1500) die('settings powerMax max != 1500');
if (!torqueMax || torqueMax.opts.max !== 1700) die('settings torqueMax max != 1700');
const checkEth = fs.readFileSync(path.join(check, 'src', 'ethanol.js'), 'utf8');
if (!/return 'Ethanol'/.test(checkEth)) die('packed ethanol.js label not English');

console.log(`packed ${outTgz}`);
console.log(
  `modules ${modules.length}; adjust RHMI 10000; tabs y=748; SHOW_TRIPS_DETAILS=${SHOW_TRIPS_DETAILS}; EN UI; sport chips; power/torque max 1500/1700`
);
