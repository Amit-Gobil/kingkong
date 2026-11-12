# Notices

## Kingkong Tuning
App brand **Kingkong**, package id `kingkong_cardata`, black + gold UI and logo
(`assets/kingkong-tuning-logo.png`). Target: BMW M3 G81, iDrive 8 / MGU.

## Adapted logic
Live-data behaviour for iDrive 8 (tabs, SOME/IP polling, OBD via TASU, trips,
fuel traces, settings) was adapted from IterioDev **Car Data**
(`IterioDev/car-apps`, package `iteriodev_cardash`) for how the app works.
**Design is not copied** — Kingkong Tuning black/gold only.

## MIT ports (idrive7-apps)
Trips / engine-group decoding paths include code originally ported from
[cauliflowermossgrape/idrive7-apps](https://github.com/cauliflowermossgrape/idrive7-apps)
(MIT). See `renderer/kit/NOTICE` inside the app package.

## MGU Store
Install path: [robertnisipeanu/mgu-store](https://github.com/robertnisipeanu/mgu-store).
This repository is an MGU Store **source** (`mgu-repo.json`).
The car needs the Store + a GPU **renderer** already installed (Kingkong declares
`needs: ["renderer"]`).

## Disclaimer
Unofficial hobby / tuning tool. Not affiliated with BMW AG. Use parked or on a
closed track; keep your eyes on the road. Read-only diagnostic access only.
