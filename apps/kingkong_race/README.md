# KingKong Race (`kingkong_race`)

Separate BMW iDrive 8 app for drag timing and christmas-tree practice. **Never talks to the DME** — only Vehicle2 speed and optional CDS2 longitudinal g.

## Tabs
- **Drag** — arm after 1 s standstill, splits 60 ft / 0–100 / 100–200 / 201 m + trap, bests, Reset, QR to inspect.kingkongtuning.se
- **Race** — solo christmas tree (ready → ambers → green → reaction / foul), same splits
- **Online** — stub for future H2H (hooks only)
- **Settings** — 1-ft rollout, clear records, QR

## Reuse
`timer.js` and `race.js` from `Amit-Gobil/kingkong-idrive-app` @ `67311b4`.

## Install
1. MGU Store → source `Amit-Gobil/kingkong` → branch **main**
2. Install **KingKong Race** `1.0.0` (separate from Kingkong live-data)
3. Restart HU if the tile does not appear
