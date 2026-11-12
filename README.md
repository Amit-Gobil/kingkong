# Kingkong

**Kingkong Tuning** live-data app for BMW **iDrive 8** / MGU — built for an **M3 G81**.

Packages:
- `kingkong_cardata` — CID Quiet Dials live data (Engine sport glance chips in **1.2.8**)
- `kingkong_race` — drag / christmas-tree practice
- `kingkong_cluster` — thin **KOMBI** black/gold status strip via Store **Cluster renderer**

Look: black + gold + Kingkong Tuning logo · English-only UI.

> Unofficial. Not affiliated with BMW AG. Use parked or on a closed track.

## Install on the car (MGU Store)

You already need **[MGU Store](https://github.com/robertnisipeanu/mgu-store)** and its **renderer** on the head unit.

1. In the car, open **Store → Settings → Add source** (or edit the existing `Amit-Gobil/kingkong` source).
2. Enter GitHub source: **`Amit-Gobil/kingkong`**
3. Channel: **Gren / Branches → `main`** (always install from `main`).
4. **Kontrollera nu** (Check now). Kingkong (`kingkong_cardata`) should list.
5. Install / update **Kingkong** (cardata), optional **KingKong Race**, optional **Kingkong Cluster**, then restart the head unit if needed (Store → Settings → **Restart head unit**).
6. Open apps from All apps.

### Kingkong Cluster (KOMBI strip)
1. Install Store tool **Cluster renderer** first (if missing).
2. Install **Kingkong Cluster** `1.0.0` from this source/`main`.
3. Open the app once; on the cluster **widget menu**, pick Kingkong Cluster.
4. See `apps/kingkong_cluster/README.md` for limits (G81 M Mode yield, widget vs map).

### Requirements
- iDrive 8 MGU (ID8 first; ID7 later)
- MGU Store with deploy tool **0.7.5+**
- An installed **renderer** (`needs: ["renderer"]`)
- For KOMBI strip: Store **Cluster renderer** (`cluster-render`)

## What’s in the box

| Path | Role |
|---|---|
| `apps/kingkong_cardata/` | CID live-data app + committed `@.tgz` |
| `apps/kingkong_race/` | Race timer app |
| `apps/kingkong_cluster/` | KOMBI status strip client |
| `mgu-repo.json` | MGU Store source layout |
| `assets/kingkong-tuning-logo.png` | Brand logo |
| `tools/prebuilt.js` | No-op build (packages already packed) |
| `tools/pack-cluster.js` | Rebuild cluster `.tgz` locally |

## Notes
- **Signals:** RPM / temps / torque from SOME/IP; boost and some fuel values may fall back to OBD/DME. Adjust Settings bar ends on the G81 if needed.
- **ID8 only** in this release.
- Behaviour adapted from Car Data–class live apps; visuals are Kingkong Tuning black/gold (not IterioDev’s look).

## License
See `LICENSE` and `NOTICE.md`.
