# Kingkong Cluster (`kingkong_cluster`)

Thin **Quiet Dials** black/gold status strip on the **ID8 instrument cluster (KOMBI)** via Store **Cluster renderer** (`cluster-render`).

Shows **Boost · Power % · Torque %** (FES sport display family — same signals as `kingkong_cardata` 1.2.8 CID chips). English only. Separate app so cardata / Race stay untouched.

## Install (car)

1. MGU Store → install **Cluster renderer** (tool from robertnisipeanu / Store catalog) if not already present.
2. Source `Amit-Gobil/kingkong` → branch **`main`** → Check now.
3. Install **Kingkong Cluster** `1.0.2` (and keep **Kingkong** cardata `1.2.8` as-is).
4. Restart head unit if the tile is missing.
5. Open **Kingkong Cluster** once (starts the client). Status tab shows renderer connect state.
6. On the **cluster widget menu**, pick the Kingkong / Cluster entry so the `widget` target is shown.
7. Settings: enable strip, optional **Hide in M Mode** (default on — turn **off** while testing if the strip stays hidden), Cycle target `widget` ↔ `map`.

## Limits (honest MVP)

- Needs **Cluster renderer** socket (`/dev/shm/cluster-render/render.sock`). Without it the CID UI still opens and says so — no crash.
- ID8 draws on **`widget`** (preferred) or **`map`** — not a full-face `panel` (ID7-only).
- Image layers are strip-sized (≤1920×720). Full widget canvas (2240×896) is **not** a valid image buffer — 1.0.0/1.0.1 silently created no layer.
- Strip process runs with the OAP app; keep the app started (hidden is OK). Closing/shutdown drops layers.
- **G81:** default hide when M Mode / Sport+ looks active so we do not fight stock shift lights. Heuristic — tune on car if needed.
- Ethanol / Adjust map name on the strip: **not in 1.0.2** (cardata still owns those on CID).
- Does not write DisplayData / DKOMBI coding.

## Rebuild package

```bash
node tools/pack-cluster.js
```

RHMI identity: `rhmi-identity.json` (appletId **22975** — never reuse cardata 20973 / race 21974).

## Launch fix (1.0.1)
`1.0.0` could install a tile but fail to open: packing deleted `renderer/race-widgets.js` while the Race-based `tele-widgets.js` still `require('./race-widgets')`, so GPU init crashed on CID open. `pack-cluster.js` now strips that hook and refuses to ship the require.

`tools/prebuilt.js` stays a no-op; Store installs the committed `.tgz`.

## License note

Vendors `src/cluster_render_client.js` from [robertnisipeanu/idrive-apps](https://github.com/robertnisipeanu/idrive-apps) `native/cluster-render` (**MPL-2.0**).
