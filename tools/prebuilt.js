// Packages are committed as apps/<id>/<id>@<version>.tgz (mgu-repo.json build output).
// MGU Store runs this as a shared build step for every app — keep it a true no-op.
// Do not extract tarballs, validate RHMI, or process.exit(1) here; the car build
// environment is minimal and any failure aborts install with "the build failed".
//
// KingKong Race RHMI identity is NOT copied from cardata. Source of truth:
//   apps/kingkong_race/rhmi-identity.json
// Rebuild Race locally / in CI with:
//   node tools/pack-race.js
// which applies unique appletId / UUIDs / SID_7 / kingkong_race_icon.png and
// refuses cardata collisions (appletId 20973, shared entry/bundle UUIDs, cardata icon).
