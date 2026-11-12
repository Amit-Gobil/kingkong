#!/usr/bin/env node
/**
 * Rebuild apps/kingkong_race/kingkong_race@VERSION.tgz with Race's own RHMI identity.
 * Source of truth for IDs: apps/kingkong_race/rhmi-identity.json
 * Does not copy cardata appletId / entryPoint / bundle UUIDs / icon name.
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
const pkgSrc = path.join(pkgDir, 'src');
fs.mkdirSync(pkgSrc, { recursive: true });
for (const f of fs.readdirSync(repoSrc)) {
  const src = path.join(repoSrc, f);
  if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(pkgSrc, f));
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
