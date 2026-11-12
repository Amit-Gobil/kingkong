// Packages are committed as apps/<id>/<id>@<version>.tgz (mgu-repo.json build output).
// Store runs this as a no-op build step.
//
// KingKong Race RHMI identity is NOT copied from cardata. Source of truth:
//   apps/kingkong_race/rhmi-identity.json
// Rebuild Race with:
//   node tools/pack-race.js
// which applies unique appletId / UUIDs / SID_7 / kingkong_race_icon.png and
// refuses cardata collisions (appletId 20973, shared entry/bundle UUIDs, cardata icon).

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const os = require('os');

const REPO = path.resolve(__dirname, '..');
const RACE_APP = path.join(REPO, 'apps', 'kingkong_race');
const identityPath = path.join(RACE_APP, 'rhmi-identity.json');

if (fs.existsSync(identityPath)) {
  const identity = JSON.parse(fs.readFileSync(identityPath, 'utf8'));
  const forbidden = identity.forbiddenCardataCollisions;
  const tgz = fs
    .readdirSync(RACE_APP)
    .filter((f) => /^kingkong_race@\d+\.\d+\.\d+\.tgz$/.test(f))
    .sort()
    .pop();
  if (tgz) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kk-prebuilt-race-'));
    try {
      execFileSync('tar', ['-xzf', path.join(RACE_APP, tgz), '-C', tmp]);
      const dir = fs.readdirSync(tmp).find((n) => /^kingkong_race@/.test(n));
      const appj = JSON.parse(
        fs.readFileSync(path.join(tmp, dir, 'rhmiData', 'application.json'), 'utf8')
      ).application;
      const ep = appj.entryPoints[0];
      const strings = JSON.parse(
        fs.readFileSync(path.join(tmp, dir, 'rhmiData', 'strings', 'en_US.json'), 'utf8')
      );
      const fails = [];
      if (appj.appletId === forbidden.appletId) fails.push('appletId==cardata');
      if (ep.uuid === forbidden.entryPoint) fails.push('entryPoint==cardata');
      if (appj.stringBundleUuid === forbidden.stringBundleUuid) fails.push('stringBundle==cardata');
      if (appj.resourceBundleUuid === forbidden.resourceBundleUuid) fails.push('resourceBundle==cardata');
      if (ep.icon === forbidden.icon) fails.push('icon==cardata');
      if (ep.icon !== identity.icon) fails.push('icon name mismatch');
      if (strings.SID_7 !== 'KingKong Race') fails.push('SID_7 missing');
      if (appj.appletId !== identity.appletId) fails.push('appletId!=rhmi-identity.json');
      if (fails.length) {
        console.error('kingkong_race RHMI identity invalid:', fails.join(', '));
        console.error('Fix with: node tools/pack-race.js');
        process.exit(1);
      }
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
}
