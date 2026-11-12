# KingKong Race (`kingkong_race`)

Separate BMW iDrive 8 app for drag timing and christmas-tree practice. **Never talks to the DME** — only Vehicle2 speed and optional CDS2 longitudinal g.

## Tabs
- **Drag** — arm after 1 s standstill, splits 60 ft / 0–100 / 100–200 / 201 m + trap, bests, Reset, QR to inspect.kingkongtuning.se
- **Race** — solo christmas tree (ready → ambers → green → reaction / foul), same splits
- **Online** — stub for future H2H (hooks only)
- **Settings** — 1-ft rollout, clear records, QR

## RHMI identity
Unique from Kingkong live-data (`kingkong_cardata`). See `rhmi-identity.json`.

| Field | Value |
|---|---|
| appletId | **21974** (cardata uses 20973 — never reuse) |
| entry icon | `kingkong_race_icon.png` |
| tile label | SID_7 = "KingKong Race" |

Rebuild the committed package (does not copy cardata IDs):

```bash
node tools/pack-race.js
```

## Reuse
`timer.js` and `race.js` from `Amit-Gobil/kingkong-idrive-app` @ `67311b4`.

## Install
1. MGU Store → source `Amit-Gobil/kingkong` → branch **main**
2. Install **KingKong Race** `1.0.4` (separate from Kingkong live-data)
3. Restart HU if the tile does not appear or an older Race build was installed

`1.0.0`–`1.0.2` could install a tile but fail to open: SOME/IP `manifest.json` lacked OnlineApp lifecycle proxies (`OAPController`, `AppStatus`, NSM, …). `pack-race.js` now merges those in.

`1.0.3` opened (title bar) but showed a blank blue content area: `renderer/screens.json` screens lacked `"kind": "gpu"`, so `ScreenApp._find` never opened the GPU layer. `1.0.4` patches that in `pack-race.js`.
