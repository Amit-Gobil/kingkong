# Kingkong

**Kingkong Tuning** live-data app for BMW **iDrive 8** / MGU — built for an **M3 G81**.

Package id: `kingkong_cardata`  
Look: black + gold + Kingkong Tuning logo  
Tabs: **Engine** · **Fuel** · **Transmission** · **Adjust** · **Settings** (Trips/Details hidden via flag)

Live values: RPM, boost, power, torque, oil / coolant / intake temps, battery; Engine sport glance chips (FES %). English-only UI.

> Unofficial. Not affiliated with BMW AG. Use parked or on a closed track.

## Install on the car (MGU Store)

You already need **[MGU Store](https://github.com/robertnisipeanu/mgu-store)** and its **renderer** on the head unit.

1. In the car, open **Store → Settings → Add source** (or edit the existing `Amit-Gobil/kingkong` source).
2. Enter GitHub source: **`Amit-Gobil/kingkong`**
3. Channel: **Gren / Branches → `main`** (always install from `main`).
4. **Kontrollera nu** (Check now). Kingkong (`kingkong_cardata`) should list.
5. Install / update **Kingkong**, then on **iDrive 8** restart the head unit (Store → Settings → **Restart head unit**).
6. Open **Kingkong** from All apps.

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

## Notes
- **Signals:** RPM / temps / torque from SOME/IP; boost and some fuel values may fall back to OBD/DME. Adjust Settings bar ends on the G81 if needed.
- **ID8 only** in this release.
- Behaviour adapted from Car Data–class live apps; visuals are Kingkong Tuning black/gold (not IterioDev’s look).

## License
See `LICENSE` and `NOTICE.md`.
