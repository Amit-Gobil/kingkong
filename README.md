# Kingkong

**Kingkong Tuning** live-data app for BMW **iDrive 8** / MGU — built for an **M3 G81**.

Package id: `kingkong_cardata`  
Look: black + gold + Kingkong Tuning logo  
Tabs: **Engine** · **Fuel** · **Trips** · **Settings**

Live values: RPM, boost, effekt, vridmoment, oil / coolant / intake temps, battery.

> Unofficial. Not affiliated with BMW AG. Use parked or on a closed track.

## Install on the car (MGU Store)

You already need **[MGU Store](https://github.com/robertnisipeanu/mgu-store)** and its **renderer** on the head unit.

1. In the car, open **Store → Settings → Add source**.
2. Enter GitHub source: **`Amit-Gobil/kingkong`**
3. Pick channel **Branches** → **`main`** (or this PR’s branch while testing), or **Tags** once a `x.y.z` tag exists.
4. Install **Kingkong** (`kingkong_cardata`).
5. On **iDrive 8**, restart the head unit (Store → Settings → **Restart head unit**) so the install takes effect.
6. Open **Kingkong** from All apps.

The Store builds/installs from this repo’s `mgu-repo.json` (committed package under `apps/kingkong_cardata/`).

### Requirements
- iDrive 8 MGU (ID8 first; ID7 later)
- MGU Store with deploy tool **0.7.5+**
- An installed **renderer** (`needs: ["renderer"]`)

## What’s in the box

| Path | Role |
|---|---|
| `apps/kingkong_cardata/` | App metadata, icon, source modules, committed `@.tgz` |
| `mgu-repo.json` | MGU Store source layout |
| `assets/kingkong-tuning-logo.png` | Brand logo |
| `tools/prebuilt.js` | No-op build (package already packed) |

## Notes / blockers
- **Signals:** RPM / temps / torque from SOME/IP; boost and some fuel values may fall back to OBD/DME like other live apps. Scaling can differ per car — use Settings bar ends and demo mode to check.
- **Logo:** Official Kingkong Tuning logo is in `assets/` and used as the app tile icon.
- **ID8 vs ID7:** This release targets **ID8 only** (`mguHmi: ["ID7"]` not declared). ID7 can come later.
- **Design:** Behaviour adapted from Car Data–class live apps; visuals are Kingkong Tuning black/gold, not IterioDev’s UI.

## License
See `LICENSE` and `NOTICE.md`.
